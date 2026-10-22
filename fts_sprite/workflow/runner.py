# -*- coding: utf-8 -*-
"""
FTS 精灵工作流编排（对应 RAGFlow 画布「FTS游戏精灵0.5」）。

画布执行顺序（全部串行）：
  begin → 7×Invoke(Mock Game Server) → Intent Resolver(LLM) → 路由
    ├─ decision : Build_Decision_Context → Knowledge_Scope_Filter → Option_Selection
    ├─ knowledge: Knowledge_Lore_Router
    └─ unknown  : 固定回复，结束
  → Build_Lore_Queries → Iteration[ RAGFlow 检索 → Merge_Lore_Result ]
  → Build_Response_Context → Sprite Response(主 LLM)

本实现的并行点：
  1. 7 个 Mock Server 请求在开始时一次性并发发出；意图识别只等待它需要的
     missions / planets / player / creatures，其余请求与意图识别 LLM 并行进行。
  2. knowledge 路径一般不需要游戏数据，确定路由后立即取消剩余请求；
     问题指向当前对象（use_current_context）或询问生物时，保留玩家状态和
     发现程度请求，用于解析指代和过滤未发现生物的 Lore（steps/current_context.py）。
  3. 每个 lore_key 的 RAGFlow 检索并发执行，结果按原优先级顺序合并，
     与画布 Iteration 逐条合并的结果一致。

主 LLM（Sprite Response）不在这里调用：本模块返回 system_prompt / user_prompt，
由 Node 交给 AnythingLLM 原生 streamChatWithWorkspace 流式生成并落库。
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from clients.game_server import GameServerClient
from clients.llm import GatewayInfo, LLMClient, LLMError
from clients.ragflow import RagflowClient
from settings import Settings
from steps import (
    build_decision_context,
    build_lore_queries,
    build_response_context,
    current_context,
    knowledge_lore_router,
    knowledge_scope_filter,
    merge_lore_result,
    option_selection,
    route_intent,
)
from workflow import prompts

log = logging.getLogger("fts_sprite.workflow")

# 展示给玩家的进度文案
STATUS_TEXT = {
    "intent": "正在理解你的问题…",
    "decision": "正在查看你当前的状态、基因和装备…",
    "knowledge": "正在整理相关的游戏知识…",
    "lore": "正在查阅星球资料库…",
    "answer": "正在组织回答…",
}


class WorkflowError(RuntimeError):
    """工作流无法继续；message 会展示给玩家。"""


@dataclass
class RunRequest:
    request_id: str
    message: str
    history: list[dict] = field(default_factory=list)
    gateway: GatewayInfo | None = None
    debug: bool = False


@dataclass
class Deps:
    settings: Settings
    llm: LLMClient
    ragflow: RagflowClient
    game: GameServerClient
    executor: ThreadPoolExecutor


Emit = Callable[[dict], Awaitable[None]]


class Trace:
    """记录耗时、告警和调试数据（只在内存中，随请求结束丢弃）。"""

    def __init__(self, request_id: str, debug: bool):
        self.request_id = request_id
        self.debug = debug
        self.started = time.perf_counter()
        self.timings: dict[str, int] = {}
        self.warnings: list[str] = []
        self.data: dict[str, Any] = {}

    def timer(self, name: str):
        trace = self

        class _T:
            def __enter__(self):
                self.t = time.perf_counter()

            def __exit__(self, *exc):
                trace.timings[name] = int((time.perf_counter() - self.t) * 1000)

        return _T()

    def put(self, key: str, value: Any) -> None:
        if self.debug:
            self.data[key] = value

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)
        log.warning("[%s] %s", self.request_id, msg)

    def summary(self) -> dict:
        self.timings["total"] = int((time.perf_counter() - self.started) * 1000)
        return {"timings_ms": self.timings, "warnings": self.warnings}


def _try_json(text: Any) -> Any:
    """调试面板展示用：能解析成 JSON 就解析，否则原样返回。"""
    if not isinstance(text, str):
        return text
    try:
        return json.loads(text)
    except Exception:  # noqa: BLE001
        return text


async def _run_code(deps: Deps, trace: Trace, name: str, fn: Callable, *args, default: Any = ""):
    """在线程池中执行人工编写的同步代码节点；异常时记录告警并返回默认值。"""
    loop = asyncio.get_running_loop()
    try:
        with trace.timer(name):
            return await loop.run_in_executor(deps.executor, fn, *args)
    except Exception as e:  # noqa: BLE001
        trace.warn(f"step {name} failed: {e!r}")
        log.exception("[%s] step %s failed", trace.request_id, name)
        return default


def _cancel(tasks: dict[str, asyncio.Task]) -> None:
    for t in tasks.values():
        if not t.done():
            t.cancel()


async def run_workflow(req: RunRequest, deps: Deps, emit: Emit) -> dict:
    s = deps.settings
    trace = Trace(req.request_id, req.debug)

    async def status(stage: str) -> None:
        await emit({"type": "status", "stage": stage, "text": STATUS_TEXT[stage]})

    # ------------------------------------------------------------
    # 1. 并发拉取游戏数据（对应 7 个 Invoke 节点）
    # ------------------------------------------------------------
    game_started = time.perf_counter()
    game_tasks = deps.game.start_fetch_all(s.player_id, req.request_id)

    try:
        # --------------------------------------------------------
        # 2. 意图识别（Intent Resolver，依赖 missions / planets / player / creatures）
        # --------------------------------------------------------
        await status("intent")
        missions_raw, planets_raw, player_raw, creatures_raw = await asyncio.gather(
            game_tasks["missions"], game_tasks["planets"], game_tasks["player"], game_tasks["creatures"]
        )
        player_context_json, creatures_json = await _run_code(
            deps, trace, "intent_snapshot", current_context.intent_snapshot,
            player_raw, missions_raw, planets_raw, creatures_raw, default=("{}", "[]"),
        )

        history = req.history[-s.intent_history_messages:] if s.intent_history_messages > 0 else []
        messages = prompts.intent_messages(
            req.message, missions_raw, planets_raw, history,
            player_context=player_context_json, creatures=creatures_json,
        )
        try:
            with trace.timer("intent_llm"):
                intent_json = await deps.llm.chat(
                    s.llm_intent, messages, gateway=req.gateway, request_id=req.request_id
                )
        except LLMError as e:
            trace.warn(str(e))
            raise WorkflowError("精灵暂时无法理解你的问题，请稍后再试。") from e

        trace.put("intent", _try_json(intent_json))

        route = await _run_code(deps, trace, "route_intent", route_intent.main, intent_json, default="unknown")
        trace.put("route", route)

        # --------------------------------------------------------
        # 3a. unknown：固定回复（Message:MajorTiesAdd）
        # --------------------------------------------------------
        if route not in ("decision", "knowledge"):
            _cancel(game_tasks)
            return {
                "mode": "direct",
                "text": prompts.unknown_reply(),
                "meta": {"route": route, **trace.summary()},
                "debug": trace.data or None,
            }

        decision_context_json = ""
        knowledge_context_json = ""
        current_ctx: dict | None = None

        # --------------------------------------------------------
        # 3b. decision 路径
        # --------------------------------------------------------
        if route == "decision":
            await status("decision")
            raw = dict(zip(game_tasks.keys(), await asyncio.gather(*game_tasks.values())))
            trace.timings["game_data"] = int((time.perf_counter() - game_started) * 1000)
            missing = [k for k, v in raw.items() if not v]
            if missing:
                trace.warn(f"game data missing: {missing}")

            ctx = await _run_code(
                deps, trace, "build_decision_context", build_decision_context.main,
                intent_json, raw["player"], raw["missions"], raw["planets"], raw["genes"],
                raw["equipment"], raw["creatures"], raw["discoveries"],
            )
            ctx = await _run_code(deps, trace, "knowledge_scope_filter", knowledge_scope_filter.main, ctx)
            decision_context_json = await _run_code(
                deps, trace, "option_selection", option_selection.main, ctx
            )
            trace.put("decision_context", _try_json(decision_context_json))

        # --------------------------------------------------------
        # 3c. knowledge 路径
        # --------------------------------------------------------
        else:
            await status("knowledge")
            if current_context.needs_game_context(intent_json):
                # 只保留解析指代 / 发现程度需要的数据
                _cancel({k: t for k, t in game_tasks.items() if k in ("genes", "equipment")})
                discoveries_raw = await game_tasks["discoveries"]
                intent_json, current_ctx = await _run_code(
                    deps, trace, "resolve_current_context", current_context.resolve_knowledge_context,
                    intent_json, player_raw, missions_raw, planets_raw, creatures_raw,
                    discoveries_raw, s.player_id, default=(intent_json, None),
                )
                trace.put("intent_resolved", _try_json(intent_json))
                trace.put("current_context", current_ctx)
            else:
                _cancel(game_tasks)

            knowledge_context_json = await _run_code(
                deps, trace, "knowledge_lore_router", knowledge_lore_router.main, intent_json
            )
            if current_ctx is not None:
                knowledge_context_json = await _run_code(
                    deps, trace, "filter_lore_by_discovery", current_context.filter_lore_requests,
                    knowledge_context_json, current_ctx, default=knowledge_context_json,
                )
            trace.put("knowledge_context", _try_json(knowledge_context_json))

        # --------------------------------------------------------
        # 4. Lore 检索（Iteration：并发检索 + 按优先级顺序合并）
        # --------------------------------------------------------
        queries = await _run_code(
            deps, trace, "build_lore_queries", build_lore_queries.main,
            intent_json, decision_context_json, knowledge_context_json, default=[],
        )
        if not isinstance(queries, list):
            queries = []
        trace.put("lore_queries", queries)

        lore_context = ""
        if queries:
            await status("lore")
            with trace.timer("lore_retrieval"):
                contents = await asyncio.gather(
                    *(deps.ragflow.retrieve_formalized(q, req.request_id) for q in queries)
                )
            hits = []
            for q, content in zip(queries, contents):
                merged = merge_lore_result.main(q, content, lore_context)
                hits.append({"query": q, "retrieved": bool(content), "merged": merged != lore_context})
                lore_context = merged
            trace.put("lore_hits", hits)
            missed = [h["query"] for h in hits if not h["merged"]]
            if missed:
                trace.warn(f"lore not merged: {missed}")
        trace.put("lore_context", lore_context)

        # --------------------------------------------------------
        # 5. Response Context + 主 LLM 提示词
        # --------------------------------------------------------
        response_context = await _run_code(
            deps, trace, "build_response_context", build_response_context.main,
            intent_json, decision_context_json, knowledge_context_json,
        )
        response_context = current_context.attach_current_context(response_context, current_ctx)
        trace.put("response_context", _try_json(response_context))

        await status("answer")
        return {
            "mode": "llm",
            "system_prompt": prompts.response_system(),
            "user_prompt": prompts.response_user(req.message, response_context, lore_context),
            "meta": {"route": route, "lore_count": len(queries), **trace.summary()},
            "debug": trace.data or None,
        }
    finally:
        _cancel(game_tasks)

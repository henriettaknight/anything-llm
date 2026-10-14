# -*- coding: utf-8 -*-
"""
工作流测试：用 httpx.MockTransport 模拟 Mock Game Server / RAGFlow / Node LLM 网关。

运行：
  cd fts_sprite && python -m pytest -q tests
"""

from __future__ import annotations

import asyncio
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from clients.game_server import GameServerClient  # noqa: E402
from clients.llm import GatewayInfo, LLMClient  # noqa: E402
from clients.ragflow import RagflowClient  # noqa: E402
from settings import settings as base_settings  # noqa: E402
from steps import (  # noqa: E402
    build_decision_context,
    build_lore_queries,
    build_response_context,
    knowledge_lore_router,
    knowledge_scope_filter,
    merge_lore_result,
    option_selection,
    route_intent,
)
from workflow.runner import Deps, RunRequest, WorkflowError, run_workflow  # noqa: E402

# ----------------------------------------------------------------------
# 测试数据（字段取自 Build_Decision_Context 实际读取的字段）
# ----------------------------------------------------------------------
PLAYERS = [
    {"player_id": "P000", "player_name": "其他玩家", "heat_resistance": 99},
    {
        "player_id": "P001",
        "player_name": "测试玩家",
        "level": 10,
        "hp": 100,
        "energy": 80,
        "active_mission_id": "MS002",
        "current_planet_id": "PL001",
        "heat_resistance": 20,
        "cold_resistance": 10,
        "radiation_resistance": 5,
        "strength": 30,
    },
]
MISSIONS = [
    {
        "mission_id": "MS002",
        "mission_name": "焰核样本采集",
        "target_planet_id": "PL001",
        "target_creature_id": "CR003",
        "required_stat": "heat_resistance",
        "required_value": 40,
        "recommended_value": 60,
    }
]
PLANETS = [
    {
        "planet_id": "PL001",
        "planet_name": "赤曜火山星",
        "primary_hazard": "heat",
        "required_stat": "heat_resistance",
        "required_value": 30,
        "recommended_value": 50,
        "lore_key": "planet_pyra_01",
    }
]
GENES = [
    {"gene_id": "GN001", "gene_name": "赤甲耐热基因", "gene_type": "heat_resistance", "bonus": 45,
     "stock": 2, "available": True, "source_species_id": "CR002", "rarity": "rare",
     "side_effect_type": "energy_drain", "side_effect_value": 10},
    {"gene_id": "GN003", "gene_name": "焰核耐热基因", "gene_type": "heat_resistance", "bonus": 65,
     "stock": 1, "available": True, "source_species_id": "CR003", "rarity": "epic",
     "side_effect_type": "none", "side_effect_value": 0},
]
EQUIPMENT = [
    {"equipment_id": "EQ001", "equipment_name": "重型隔热盾", "effect_type": "heat_resistance",
     "effect_bonus": 15, "energy_cost": 10, "stock": 1, "rarity": "common"},
]
CREATURES = [
    {"creature_id": "CR002", "species_name": "赤甲龙蜥", "lore_key": "creature_redscale_drake"},
    {"creature_id": "CR003", "species_name": "焰核巨兽", "lore_key": "creature_core_behemoth"},
]
DISCOVERIES = [
    {"player_id": "P001", "entity_type": "creature", "entity_id": "CR002", "discovery_state": "analyzed"},
    {"player_id": "P001", "entity_type": "creature", "entity_id": "CR003", "discovery_state": "scanned"},
]

MOCK_ROUTES = {
    "/players/": PLAYERS,
    "/missions": MISSIONS,
    "/planets": PLANETS,
    "/gene_samples": GENES,
    "/equipment": EQUIPMENT,
    "/creatures": CREATURES,
    "/player_discoveries": DISCOVERIES,
}

INTENTS = {
    "我现在能去赤曜火山星吗？": {
        "intent_family": "decision", "intent": "planet_preparation", "domain": None, "topic": None,
        "target_mission_id": None, "target_planet_id": "PL001", "target_creature_id": None,
        "target_effect_type": None, "requested_stat": None, "use_active_mission": False,
        "confidence": 0.9, "warnings": [],
    },
    "基因怎么采集？": {
        "intent_family": "knowledge", "intent": "gameplay_help", "domain": "gene", "topic": "collection",
        "target_mission_id": None, "target_planet_id": None, "target_creature_id": None,
        "target_effect_type": None, "requested_stat": None, "use_active_mission": False,
        "confidence": 0.95, "warnings": [],
    },
    "今天天气怎么样？": {
        "intent_family": "unknown", "intent": "unknown", "domain": None, "topic": None,
        "target_mission_id": None, "target_planet_id": None, "target_creature_id": None,
        "target_effect_type": None, "requested_stat": None, "use_active_mission": False,
        "confidence": 0.2, "warnings": [],
    },
}


class Recorder:
    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.gateway_bodies: list[dict] = []
        self.ragflow_bodies: list[dict] = []
        self.fail_gateway = False


def make_handler(rec: Recorder):
    def handler(request: httpx.Request) -> httpx.Response:
        rec.requests.append(request)
        url = urlparse(str(request.url))
        if url.netloc == "mock":
            if url.path == "/player_discoveries":
                assert parse_qs(url.query)["player_id"] == ["P001"]
            return httpx.Response(200, json=MOCK_ROUTES[url.path])
        if url.netloc == "ragflow":
            body = json.loads(request.content)
            rec.ragflow_bodies.append(body)
            assert request.headers["Authorization"] == "Bearer rf-key"
            key = body["question"].split()[0]
            return httpx.Response(200, json={"code": 0, "data": {"chunks": [
                {"content": f"lore_key: {key}\n关于 {key} 的资料正文。", "similarity": 0.8,
                 "document_keyword": "lore.xlsx"}
            ]}})
        if url.netloc == "node":
            assert request.headers["X-FTS-Sprite-Token"] == "tok"
            if rec.fail_gateway:
                return httpx.Response(500, text="boom")
            body = json.loads(request.content)
            rec.gateway_bodies.append(body)
            question = body["messages"][-1]["content"].split("\n")[1]
            # 模拟 LLM 偶尔带 ```json 包裹与 <think>
            text = "<think>思考</think>```json\n" + json.dumps(INTENTS[question], ensure_ascii=False) + "\n```"
            return httpx.Response(200, json={"text": text})
        return httpx.Response(404)

    return handler


def make_deps(rec: Recorder) -> Deps:
    s = replace(
        base_settings,
        mock_server_url="http://mock",
        ragflow_base_url="http://ragflow",
        ragflow_api_key="rf-key",
        ragflow_dataset_id="ds1",
        player_id="P001",
        llm_intent=replace(base_settings.llm_intent, base_url="", provider="", model="", retry_delay=0),
    )
    http = httpx.AsyncClient(transport=httpx.MockTransport(make_handler(rec)))
    return Deps(
        settings=s,
        llm=LLMClient(http),
        ragflow=RagflowClient(http, s),
        game=GameServerClient(http, s),
        executor=ThreadPoolExecutor(4),
    )


async def run(question: str, rec: Recorder | None = None, debug=True):
    rec = rec or Recorder()
    deps = make_deps(rec)
    events = []

    async def emit(e):
        events.append(e)

    req = RunRequest(
        request_id="t1",
        message=question,
        history=[{"role": "user", "content": "你好"}, {"role": "assistant", "content": "你好！"}],
        gateway=GatewayInfo("http://node/api/fts_sprite/internal/llm", "tok"),
        debug=debug,
    )
    result = await run_workflow(req, deps, emit)
    return result, events, rec


# ----------------------------------------------------------------------
# 画布顺序的参考实现：完全按 RAGFlow 画布串行调用各 Code 节点
# ----------------------------------------------------------------------
def canvas_reference(question: str) -> tuple[str, str]:
    intent_json = json.dumps(INTENTS[question], ensure_ascii=False)
    route = route_intent.main(intent_json)
    dec, kn = "", ""
    if route == "decision":
        player = json.dumps(PLAYERS[1], ensure_ascii=False)
        raw = {k: json.dumps(v, ensure_ascii=False) for k, v in MOCK_ROUTES.items()}
        ctx = build_decision_context.main(
            intent_json, player, raw["/missions"], raw["/planets"], raw["/gene_samples"],
            raw["/equipment"], raw["/creatures"], raw["/player_discoveries"],
        )
        dec = option_selection.main(knowledge_scope_filter.main(ctx))
    elif route == "knowledge":
        kn = knowledge_lore_router.main(intent_json)
    lore = ""
    for q in build_lore_queries.main(intent_json, dec, kn):
        key = q.split()[0]
        lore = merge_lore_result.main(q, f"lore_key: {key}\n关于 {key} 的资料正文。", lore)
    return build_response_context.main(intent_json, dec, kn), lore


# ----------------------------------------------------------------------
# Tests
# ----------------------------------------------------------------------
def test_decision_path_matches_canvas():
    q = "我现在能去赤曜火山星吗？"
    result, events, rec = asyncio.run(run(q))
    assert result["mode"] == "llm"
    ref_ctx, ref_lore = canvas_reference(q)
    assert ref_ctx in result["user_prompt"]
    assert ref_lore and ref_lore in result["user_prompt"]
    assert q in result["user_prompt"]
    assert "AI 精灵" in result["system_prompt"]
    assert [e["stage"] for e in events] == ["intent", "decision", "lore", "answer"]
    ctx = json.loads(ref_ctx)
    assert ctx["response_mode"] == "decision"
    # 选中了 P001，而不是列表第一个玩家
    assert result["debug"]["decision_context"]["player_state"]
    assert "P000" not in json.dumps(result["debug"]["decision_context"], ensure_ascii=False)
    # 每个 lore 检索一次，使用画布参数
    assert len(rec.ragflow_bodies) == len(result["debug"]["lore_queries"]) > 0
    assert rec.ragflow_bodies[0]["page_size"] == 1
    assert rec.ragflow_bodies[0]["similarity_threshold"] == 0.3
    # 意图识别：历史 + 系统提示词 + 任务/星球数据
    msgs = rec.gateway_bodies[0]["messages"]
    assert msgs[0]["role"] == "system" and "Intent Resolver" in msgs[0]["content"]
    assert msgs[1]["content"] == "你好"
    assert "焰核样本采集" in msgs[-1]["content"] and "赤曜火山星" in msgs[-1]["content"]


def test_knowledge_path_matches_canvas_and_skips_game_data():
    q = "基因怎么采集？"
    result, events, rec = asyncio.run(run(q))
    assert result["mode"] == "llm"
    ref_ctx, ref_lore = canvas_reference(q)
    assert ref_ctx in result["user_prompt"]
    assert "[[LORE:gene_gameplay_collection]]" in ref_lore
    assert ref_lore in result["user_prompt"]
    assert [e["stage"] for e in events] == ["intent", "knowledge", "lore", "answer"]
    assert result["debug"]["lore_queries"] == ["gene_gameplay_collection 生物样本采集 GS_GENE_COLLECTION"]


def test_unknown_path_direct_reply():
    result, events, _ = asyncio.run(run("今天天气怎么样？"))
    assert result["mode"] == "direct"
    assert result["text"] == "我只了解和FTS游戏有关的问题，还不能回答你当前的提问~"
    assert [e["stage"] for e in events] == ["intent"]


def test_debug_off_has_no_debug_payload():
    result, _, _ = asyncio.run(run("基因怎么采集？", debug=False))
    assert result["debug"] is None
    assert "timings_ms" in result["meta"]


def test_intent_llm_failure_raises_workflow_error():
    rec = Recorder()
    rec.fail_gateway = True
    with pytest.raises(WorkflowError):
        asyncio.run(run("基因怎么采集？", rec))


def test_lore_with_wrong_chunk_is_not_merged():
    # Merge_Lore_Result 只合并 lore_key 与 query 对应的 chunk
    assert merge_lore_result.main("planet_pyra_01 赤曜火山星 PL001", "lore_key: other\nxx", "") == ""


def test_http_ndjson_stream():
    from fastapi.testclient import TestClient

    import main as service

    rec = Recorder()
    with TestClient(service.app) as client:
        service.app.state.deps = make_deps(rec)
        resp = client.post("/workflow/run", json={
            "request_id": "h1",
            "message": "基因怎么采集？",
            "history": [],
            "gateway": {"url": "http://node/api/fts_sprite/internal/llm", "token": "tok"},
            "debug": False,
        })
        lines = [json.loads(x) for x in resp.text.strip().split("\n")]
        assert lines[0] == {"type": "status", "stage": "intent", "text": "正在理解你的问题…"}
        assert lines[-1]["type"] == "result" and lines[-1]["mode"] == "llm"
        assert client.get("/health").json()["status"] == "ok"

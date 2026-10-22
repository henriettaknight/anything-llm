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
    current_context,
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
    {"creature_id": "CR001", "species_name": "熔岩甲虫", "lore_key": "creature_lava_beetle"},
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
    # 指代当前对象：意图识别不猜 ID，交给 current_context 解析
    "这个动物是什么？": {
        "intent_family": "knowledge", "intent": "entity_info", "domain": "world", "topic": "creature",
        "target_mission_id": None, "target_planet_id": None, "target_creature_id": None,
        "target_effect_type": None, "requested_stat": None, "use_active_mission": False,
        "use_current_context": True, "confidence": 0.8, "warnings": [],
    },
    # 点名了一个玩家从未发现过的生物（CR001 没有 discovery 记录）
    "熔岩甲虫是什么？": {
        "intent_family": "knowledge", "intent": "entity_info", "domain": "world", "topic": "creature",
        "target_mission_id": None, "target_planet_id": None, "target_creature_id": "CR001",
        "target_effect_type": None, "requested_stat": None, "use_active_mission": False,
        "use_current_context": False, "confidence": 0.9, "warnings": [],
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
    # 与玩家状态无关的知识问题，不附带 current_context
    assert "current_context" not in result["user_prompt"]
    assert "current_context" not in result["debug"]


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


# ----------------------------------------------------------------------
# 指代当前对象 / 发现程度过滤（steps/current_context.py）
# ----------------------------------------------------------------------
def test_intent_llm_receives_player_state_and_creatures():
    _, _, rec = asyncio.run(run("这个动物是什么？"))
    user_msg = rec.gateway_bodies[0]["messages"][-1]["content"]
    assert '"current_planet_id": "PL001"' in user_msg
    assert '"active_mission_id": "MS002"' in user_msg
    assert "焰核巨兽" in user_msg and "CR003" in user_msg


def test_this_creature_resolves_from_active_mission():
    result, events, _ = asyncio.run(run("这个动物是什么？"))
    assert result["mode"] == "llm"
    assert [e["stage"] for e in events] == ["intent", "knowledge", "lore", "answer"]
    cc = result["debug"]["current_context"]
    # 玩家在 PL001，当前任务 MS002 的目标是 PL001 上的 CR003（已 scanned）
    assert cc["reference_status"] == "resolved"
    assert cc["current_planet"]["planet_name"] == "赤曜火山星"
    assert cc["target_creature"] == {
        "creature_id": "CR003", "resolved_from": "active_mission",
        "discovery_state": "scanned", "details_allowed": True, "species_name": "焰核巨兽",
    }
    assert result["debug"]["intent_resolved"]["target_creature_id"] == "CR003"
    assert any(q.startswith("creature_core_behemoth") for q in result["debug"]["lore_queries"])
    # 主 LLM 能看到 current_context
    ctx = result["debug"]["response_context"]
    assert ctx["response_mode"] == "knowledge"
    assert ctx["current_context"]["target_creature"]["creature_id"] == "CR003"
    assert "[[LORE:creature_core_behemoth]]" in result["user_prompt"]


def test_undiscovered_creature_lore_is_hidden():
    result, _, rec = asyncio.run(run("熔岩甲虫是什么？"))
    cc = result["debug"]["current_context"]
    assert cc["target_creature"]["discovery_state"] == "unknown"
    assert cc["target_creature"]["details_allowed"] is False
    assert "species_name" not in cc["target_creature"]
    assert result["debug"]["lore_queries"] == []
    assert rec.ragflow_bodies == []
    assert "creature_lore_hidden_by_discovery" in result["debug"]["knowledge_context"]["warnings"]


def _resolve(player, creatures, intent_extra=None, missions=None, discoveries=None):
    intent = {**INTENTS["这个动物是什么？"], **(intent_extra or {})}
    _, cc = current_context.resolve_knowledge_context(
        json.dumps(intent, ensure_ascii=False),
        json.dumps(player), json.dumps(MISSIONS if missions is None else missions), json.dumps(PLANETS),
        json.dumps(creatures, ensure_ascii=False),
        json.dumps(DISCOVERIES if discoveries is None else discoveries), "P001",
    )
    return cc


def test_resolve_by_current_planet_when_no_mission():
    player = {"player_id": "P001", "current_planet_id": "PL001"}
    creatures = [
        {"creature_id": "CR002", "species_name": "赤甲龙蜥", "planet_id": "PL001"},
        {"creature_id": "CR004", "species_name": "霜脊鳐", "planet_id": "PL002"},
    ]
    cc = _resolve(player, creatures, discoveries=[])
    assert cc["target_creature"]["creature_id"] == "CR002"
    assert cc["target_creature"]["resolved_from"] == "current_planet"


def test_resolve_ambiguous_when_several_creatures_on_planet():
    player = {"player_id": "P001", "current_planet_id": "PL001"}
    creatures = [
        {"creature_id": "CR002", "species_name": "赤甲龙蜥", "planet_id": "PL001"},
        {"creature_id": "CR003", "species_name": "焰核巨兽", "planet_ids": ["PL001"]},
    ]
    cc = _resolve(player, creatures)
    assert cc["target_creature"] is None
    assert cc["reference_status"] == "ambiguous"
    # CR002 analyzed、CR003 scanned 都可以给出名称，供主 LLM 反问
    assert [c["species_name"] for c in cc["candidate_creatures"]] == ["赤甲龙蜥", "焰核巨兽"]


def test_mission_on_other_planet_is_not_used():
    # 玩家不在任务目标星球上，不能把任务目标生物当成“这个动物”
    player = {"player_id": "P001", "current_planet_id": "PL002", "active_mission_id": "MS002"}
    cc = _resolve(player, CREATURES)
    assert cc["target_creature"] is None
    assert cc["reference_status"] == "unresolved"


def test_explicit_creature_from_history_wins():
    player = {"player_id": "P001", "current_planet_id": "PL001", "active_mission_id": "MS002"}
    cc = _resolve(player, CREATURES, {"target_creature_id": "CR002"})
    assert cc["target_creature"]["creature_id"] == "CR002"
    assert cc["target_creature"]["resolved_from"] == "intent"


def test_route_intent_legacy_environment_preparation():
    assert route_intent.main(json.dumps({"intent": "environment_preparation"})) == "decision"


def test_real_mock_data_encountered_creature():
    # 取自 Mock Server db.json：P001 在 PL001，当前任务 MS001 没有目标生物，
    # PL001 有 3 种生物（home_planet_id），玩家只 encountered 过 CR001
    player = {"player_id": "P001", "current_planet_id": "PL001", "active_mission_id": "MS001"}
    missions = [{"mission_id": "MS001", "mission_name": "火山带调查",
                 "target_planet_id": "PL001", "target_creature_id": None}]
    creatures = [
        {"creature_id": "CR001", "species_name": "熔岩甲虫", "home_planet_id": "PL001"},
        {"creature_id": "CR002", "species_name": "赤甲龙蜥", "home_planet_id": "PL001"},
        {"creature_id": "CR003", "species_name": "焰核巨兽", "home_planet_id": "PL001"},
        {"creature_id": "CR004", "species_name": "冰脊鳐", "home_planet_id": "PL002"},
    ]
    discoveries = [{"player_id": "P001", "entity_type": "creature", "entity_id": "CR001",
                    "discovery_state": "encountered"}]
    cc = _resolve(player, creatures, missions=missions, discoveries=discoveries)
    assert cc["reference_status"] == "resolved"
    assert cc["target_creature"] == {
        "resolved_from": "current_planet_discovery", "creature_id": "CR001",
        "discovery_state": "encountered", "details_allowed": False,
    }

# -*- coding: utf-8 -*-
"""
Current Context：让意图识别和 knowledge 路径能使用玩家当前状态。

本文件不是画布节点的迁移，是 Python 服务新增的步骤，画布同步时不会被覆盖。

解决的问题：
  玩家问“这个动物是什么？”时，问题里没有具体对象。原流程中：
    1. 意图识别只看到 missions / planets，无法知道“这个”指谁；
    2. knowledge 路径取消全部游戏数据请求，后续拿不到玩家状态；
    3. knowledge 路径不经过 Knowledge_Scope_Filter，未扫描的生物也会被检索 Lore。

提供三个函数：
  intent_snapshot()          给意图识别 LLM 的精简上下文（玩家当前状态 + 生物列表）
  needs_game_context()       knowledge 路径是否需要游戏数据
  resolve_knowledge_context()确定性解析指代对象、按发现程度过滤 Lore，
                             返回补全后的 intent 和 current_context
  attach_current_context()   把 current_context 写入 RESPONSE CONTEXT
"""

from __future__ import annotations

import json
import re
from typing import Any

# 与 Build_Decision_Context / Knowledge_Scope_Filter 保持一致：
# encountered < scanned < sampled < analyzed，scanned 及以上才允许披露生物详情
DISCOVERY_RANK = {"encountered": 1, "scanned": 2, "sampled": 3, "analyzed": 4}
DETAILS_MIN_RANK = DISCOVERY_RANK["scanned"]

# 生物所在星球的候选字段（Mock Server 字段名尚未固定，按顺序尝试）
CREATURE_PLANET_FIELDS = ("home_planet_id", "planet_id", "habitat_planet_id", "planet_ids", "habitat_planet_ids", "planets")


# ----------------------------------------------------------------------
# 解析工具
# ----------------------------------------------------------------------
def _parse(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value
    if not isinstance(value, str) or not value.strip():
        return None
    text = re.sub(r"^```(?:json)?\s*", "", value.strip(), flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except Exception:  # noqa: BLE001
        return None


def _as_list(value: Any) -> list[dict]:
    data = _parse(value)
    if isinstance(data, dict):
        # 兼容 {"data": [...]} / {"items": [...]} 包装
        for key in ("data", "items", "results"):
            if isinstance(data.get(key), list):
                data = data[key]
                break
        else:
            data = [data]
    if not isinstance(data, list):
        return []
    return [x for x in data if isinstance(x, dict)]


def _as_dict(value: Any) -> dict:
    data = _parse(value)
    if isinstance(data, list):
        data = next((x for x in data if isinstance(x, dict)), None)
    return data if isinstance(data, dict) else {}


def _index(items: list[dict], id_key: str) -> dict[str, dict]:
    return {str(x[id_key]): x for x in items if x.get(id_key) is not None}


def _creature_planets(creature: dict) -> set[str]:
    for field in CREATURE_PLANET_FIELDS:
        value = creature.get(field)
        if value is None:
            continue
        if isinstance(value, (list, tuple, set)):
            return {str(v) for v in value if v is not None}
        return {str(value)}
    return set()


def _discovery_state(discoveries: list[dict], player_id: str, creature_id: str) -> str:
    best = 0
    for d in discoveries:
        if d.get("entity_type", "creature") != "creature":
            continue
        if str(d.get("entity_id")) != creature_id:
            continue
        pid = d.get("player_id")
        if pid is not None and player_id and str(pid) != str(player_id):
            continue
        best = max(best, DISCOVERY_RANK.get(d.get("discovery_state"), 0))
    return next((k for k, v in DISCOVERY_RANK.items() if v == best), "unknown")


def _details_allowed(state: str) -> bool:
    return DISCOVERY_RANK.get(state, 0) >= DETAILS_MIN_RANK


def _to_bool(value: Any) -> bool:
    if isinstance(value, str):
        return value.strip().lower() == "true"
    return bool(value)


# ----------------------------------------------------------------------
# 1. 意图识别的上下文
# ----------------------------------------------------------------------
def intent_snapshot(player_raw: str, missions_raw: str, planets_raw: str, creatures_raw: str) -> tuple[str, str]:
    """
    返回 (player_context, creatures) 两段 JSON 文本，用于 intent_user.md。

    只给意图识别“解析指代”所需的最少信息，不含属性数值和库存，
    避免意图识别 LLM 越权做决策计算。
    """
    player = _as_dict(player_raw)
    missions = _index(_as_list(missions_raw), "mission_id")
    planets = _index(_as_list(planets_raw), "planet_id")

    planet_id = player.get("current_planet_id")
    mission_id = player.get("active_mission_id")
    mission = missions.get(str(mission_id)) if mission_id else None

    player_context = {
        "current_planet_id": planet_id,
        "current_planet_name": (planets.get(str(planet_id)) or {}).get("planet_name") if planet_id else None,
        "active_mission_id": mission_id,
        "active_mission_name": (mission or {}).get("mission_name"),
    }

    creatures = []
    for c in _as_list(creatures_raw):
        if c.get("creature_id") is None:
            continue
        item = {"creature_id": c.get("creature_id"), "species_name": c.get("species_name")}
        planets_of = _creature_planets(c)
        if planets_of:
            item["planet_ids"] = sorted(planets_of)
        creatures.append(item)

    return (
        json.dumps(player_context, ensure_ascii=False),
        json.dumps(creatures, ensure_ascii=False),
    )


# ----------------------------------------------------------------------
# 2. knowledge 路径是否需要游戏数据
# ----------------------------------------------------------------------
def needs_game_context(intent_json: str) -> bool:
    """
    - use_current_context = true：问题指向玩家当前所见 / 所在；
    - 询问生物（entity_info / creature）：需要发现程度决定能否披露详情。
    """
    intent = _as_dict(intent_json)
    if _to_bool(intent.get("use_current_context")):
        return True
    return intent.get("intent") == "entity_info" and intent.get("topic") == "creature"


# ----------------------------------------------------------------------
# 3. 解析指代 + 发现程度过滤
# ----------------------------------------------------------------------
def resolve_target_creature(
    intent: dict,
    player: dict,
    missions: dict,
    creatures: dict,
    discoveries: list[dict] | None = None,
    player_id: str = "",
) -> tuple[str | None, str, list[str]]:
    """
    返回 (creature_id, source, candidates)。

    优先级：
      1. 意图识别已给出（问题或对话历史里点名）              → intent
      2. 当前任务的目标生物，且玩家就在任务目标星球           → active_mission
      3. 当前星球上玩家唯一发现过（encountered 及以上）的生物 → current_planet_discovery
      4. 当前星球上唯一的生物                                 → current_planet
      5. 有多个候选                                           → ambiguous（返回候选）
      6. 无法确定                                             → unresolved
    """
    explicit = intent.get("target_creature_id")
    if explicit and str(explicit) in creatures:
        return str(explicit), "intent", []

    if not _to_bool(intent.get("use_current_context")):
        return None, "unresolved", []

    planet_id = player.get("current_planet_id")
    mission = missions.get(str(player.get("active_mission_id"))) if player.get("active_mission_id") else None
    if mission and mission.get("target_creature_id"):
        mission_planet = mission.get("target_planet_id")
        if not mission_planet or not planet_id or str(mission_planet) == str(planet_id):
            cid = str(mission["target_creature_id"])
            if cid in creatures:
                return cid, "active_mission", []

    if not planet_id:
        return None, "unresolved", []

    on_planet = [cid for cid, c in creatures.items() if str(planet_id) in _creature_planets(c)]
    discovered = [
        cid for cid in on_planet
        if _discovery_state(discoveries or [], player_id, cid) != "unknown"
    ]
    if len(discovered) == 1:
        return discovered[0], "current_planet_discovery", []
    if len(discovered) > 1:
        return None, "ambiguous", discovered
    if len(on_planet) == 1:
        return on_planet[0], "current_planet", []
    return None, ("ambiguous" if on_planet else "unresolved"), []


def resolve_knowledge_context(
    intent_json: str,
    player_raw: str,
    missions_raw: str,
    planets_raw: str,
    creatures_raw: str,
    discoveries_raw: str,
    player_id: str = "",
) -> tuple[str, dict]:
    """
    返回 (补全 target_creature_id 后的 intent_json, current_context)。

    补全后的 intent 交给原画布节点 Knowledge_Lore_Router，
    其输出再用 filter_lore_requests() 按发现程度过滤。
    """
    intent = _as_dict(intent_json)
    player = _as_dict(player_raw)
    missions = _index(_as_list(missions_raw), "mission_id")
    planets = _index(_as_list(planets_raw), "planet_id")
    creatures = _index(_as_list(creatures_raw), "creature_id")
    discoveries = _as_list(discoveries_raw)
    pid = str(player.get("player_id") or player.get("id") or player_id or "")

    creature_id, source, candidate_ids = resolve_target_creature(
        intent, player, missions, creatures, discoveries, pid
    )

    warnings = list(intent.get("warnings") or [])
    if creature_id and not intent.get("target_creature_id"):
        intent["target_creature_id"] = creature_id
        warnings.append(f"target_creature_from_{source}")
    elif not creature_id and _to_bool(intent.get("use_current_context")) and intent.get("topic") == "creature":
        warnings.append("creature_reference_" + source)
    intent["warnings"] = warnings

    planet_id = player.get("current_planet_id")
    planet = planets.get(str(planet_id)) if planet_id else None
    mission_id = player.get("active_mission_id")
    mission = missions.get(str(mission_id)) if mission_id else None

    def describe(cid: str) -> dict:
        state = _discovery_state(discoveries, pid, cid)
        allowed = _details_allowed(state)
        item = {"creature_id": cid, "discovery_state": state, "details_allowed": allowed}
        if allowed:
            item["species_name"] = creatures[cid].get("species_name")
        return item

    target_creature = None
    if creature_id:
        target_creature = {"resolved_from": source, **describe(creature_id)}

    current_context = {
        "current_planet": {
            "planet_id": planet_id,
            "planet_name": (planet or {}).get("planet_name"),
            "primary_hazard": (planet or {}).get("primary_hazard"),
        } if planet_id else None,
        "active_mission": {
            "mission_id": mission_id,
            "mission_name": (mission or {}).get("mission_name"),
        } if mission_id else None,
        "target_creature": target_creature,
        "reference_status": "resolved" if creature_id else source,
    }
    if candidate_ids:
        # 多个候选时给主 LLM 用来反问玩家；未扫描的候选同样不带名称
        current_context["candidate_creatures"] = [describe(cid) for cid in candidate_ids]
    return json.dumps(intent, ensure_ascii=False), current_context


def filter_lore_requests(knowledge_context_json: str, current_context: dict) -> str:
    """
    去掉玩家尚未扫描的生物 Lore（与 Knowledge_Scope_Filter 的披露阈值一致）。
    只处理 knowledge 路径的 creature Lore，其他 Lore 原样保留。
    """
    ctx = _as_dict(knowledge_context_json)
    if not ctx:
        return knowledge_context_json
    target = (current_context or {}).get("target_creature") or {}
    allowed_ids = {target["creature_id"]} if target.get("details_allowed") else set()

    kept, dropped = [], []
    for item in ctx.get("lore_requests") or []:
        key = str(item.get("lore_key") or "")
        entity_id = str(item.get("entity_id") or "")
        if key.startswith("creature_") and entity_id not in allowed_ids:
            dropped.append(key)
            continue
        kept.append(item)

    if dropped:
        ctx["lore_requests"] = kept
        ctx["lore_keys"] = [x.get("lore_key") for x in kept]
        ctx.setdefault("warnings", []).append("creature_lore_hidden_by_discovery")
        if not kept:
            ctx["status"] = "needs_clarification"
    return json.dumps(ctx, ensure_ascii=False)


# ----------------------------------------------------------------------
# 4. 写入 RESPONSE CONTEXT
# ----------------------------------------------------------------------
def attach_current_context(response_context_json: str, current_context: dict | None) -> str:
    if not current_context:
        return response_context_json
    ctx = _as_dict(response_context_json)
    if not ctx:
        return response_context_json
    ctx["current_context"] = current_context
    return json.dumps(ctx, ensure_ascii=False)

# -*- coding: utf-8 -*-
"""
Mock Game Server 连通性与数据检查（不需要 LLM、RAGFlow，不需要启动精灵服务）。

用法（在仓库根目录）：
  ~/.venvs/fts_sprite/bin/python fts_sprite/scripts/check_game_server.py
  ~/.venvs/fts_sprite/bin/python fts_sprite/scripts/check_game_server.py --planet PL001
  ~/.venvs/fts_sprite/bin/python fts_sprite/scripts/check_game_server.py --mission MS002 --show-context

检查内容：
  1. 7 个接口逐个请求：HTTP 状态、耗时、返回条数、示例 ID、是否是合法 JSON
  2. /players/ 中能否找到当前 Demo 玩家（FTS_SPRITE_PLAYER_ID，默认 P001）
  3. 用真实数据离线跑一遍决策路径（Build_Decision_Context → Knowledge_Scope_Filter
     → Option_Selection），确认数据能被画布代码正确使用

配置读取与 dev.sh 一致：server/.env.development 优先，其次 server/.env。
退出码：0 = 全部正常，1 = 有问题。
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER_DIR = ROOT.parent / "server"
if not os.getenv("FTS_SPRITE_ENV_FILE"):
    os.environ["FTS_SPRITE_ENV_FILE"] = os.pathsep.join(
        [str(SERVER_DIR / ".env.development"), str(SERVER_DIR / ".env")]
    )
sys.path.insert(0, str(ROOT))

import httpx  # noqa: E402

from clients.game_server import GameServerClient  # noqa: E402
from settings import settings  # noqa: E402
from steps import build_decision_context, knowledge_scope_filter, option_selection  # noqa: E402

ID_FIELDS = ("entity_id", "player_id", "mission_id", "planet_id", "gene_id", "equipment_id",
             "creature_id", "id")

OK, WARN, FAIL = "✅", "⚠️ ", "❌"
problems: list[str] = []


def sample_ids(data) -> str:
    items = data if isinstance(data, list) else [data]
    ids = []
    for item in items[:5]:
        if isinstance(item, dict):
            for f in ID_FIELDS:
                if item.get(f):
                    ids.append(str(item[f]))
                    break
    more = "…" if isinstance(data, list) and len(data) > 5 else ""
    return ", ".join(ids) + more if ids else "-"


async def check_endpoints() -> dict[str, str]:
    s = settings
    print(f"Mock Server : {s.mock_server_url or '(未配置 FTS_SPRITE_MOCK_SERVER_URL)'}")
    print(f"认证 Header : {'已设置 ' + s.mock_api_key_header if s.mock_api_key else '不发送'}")
    print(f"Demo 玩家   : {s.player_id}")
    print(f"超时        : {s.mock_timeout}s\n")
    if not s.mock_server_url:
        problems.append("FTS_SPRITE_MOCK_SERVER_URL 未配置")
        return {}

    raw: dict[str, str] = {}
    async with httpx.AsyncClient() as http:
        client = GameServerClient(http, s)
        headers = client._headers()
        print(f"{'接口':<12} {'状态':<6} {'耗时':>7}  {'条数':>4}  示例 ID")
        print("-" * 72)
        for key, (path, params) in client._endpoints(s.player_id).items():
            url = f"{s.mock_server_url}{path}"
            t = time.perf_counter()
            try:
                resp = await http.get(url, params=params or None, headers=headers, timeout=s.mock_timeout)
                ms = int((time.perf_counter() - t) * 1000)
            except Exception as e:  # noqa: BLE001
                print(f"{FAIL} {key:<10} 连接失败: {e!r}")
                problems.append(f"{key}: 连接失败 {e!r}")
                raw[key] = ""
                continue
            text = resp.text
            try:
                data = json.loads(text)
            except Exception:  # noqa: BLE001
                print(f"{FAIL} {key:<10} {resp.status_code:<6} {ms:>5}ms  返回不是 JSON：{text[:60]!r}")
                problems.append(f"{key}: 返回不是 JSON")
                raw[key] = ""
                continue
            count = len(data) if isinstance(data, list) else 1
            mark = OK
            if resp.status_code != 200:
                mark = FAIL
                problems.append(f"{key}: HTTP {resp.status_code}")
            elif isinstance(data, list) and not data:
                mark = WARN
                problems.append(f"{key}: 返回空数组")
            print(f"{mark} {key:<10} {resp.status_code:<6} {ms:>5}ms  {count:>4}  {sample_ids(data)}")
            raw[key] = text if resp.status_code == 200 else ""

    # Demo 玩家
    selected = GameServerClient.select_player(raw.get("player", ""), s.player_id)
    try:
        player = json.loads(selected) if selected else None
    except Exception:  # noqa: BLE001
        player = None
    print()
    if isinstance(player, dict) and s.player_id in (player.get("player_id"), player.get("id")):
        print(f"{OK} 找到玩家 {s.player_id}：当前星球={player.get('current_planet_id')}，"
              f"当前任务={player.get('active_mission_id')}，"
              f"heat/cold/radiation/strength="
              f"{player.get('heat_resistance')}/{player.get('cold_resistance')}/"
              f"{player.get('radiation_resistance')}/{player.get('strength')}")
    else:
        print(f"{FAIL} /players/ 中找不到玩家 {s.player_id}（画布逻辑会退回取第一个玩家）")
        problems.append(f"找不到玩家 {s.player_id}")
    raw["player"] = selected
    return raw


def check_decision(raw: dict[str, str], args) -> None:
    if not raw:
        return
    intent = {
        "intent_family": "decision",
        "intent": "current_mission_preparation",
        "domain": None, "topic": None,
        "target_mission_id": None, "target_planet_id": None,
        "target_creature_id": None, "target_effect_type": None,
        "requested_stat": None, "use_active_mission": True,
        "confidence": 0.9, "warnings": [],
    }
    label = "当前任务"
    if args.mission:
        intent.update(intent="mission_preparation", target_mission_id=args.mission, use_active_mission=False)
        label = f"任务 {args.mission}"
    elif args.planet:
        intent.update(intent="planet_preparation", target_planet_id=args.planet, use_active_mission=False)
        label = f"星球 {args.planet}"

    print(f"\n离线决策测试（{label}，不调用 LLM）")
    print("-" * 72)
    intent_json = json.dumps(intent, ensure_ascii=False)
    ctx = build_decision_context.main(
        intent_json, raw["player"], raw["missions"], raw["planets"], raw["genes"],
        raw["equipment"], raw["creatures"], raw["discoveries"],
    )
    ctx = knowledge_scope_filter.main(ctx)
    result = option_selection.main(ctx)
    data = json.loads(result)

    status = data.get("status")
    mark = OK if status == "success" else FAIL
    print(f"{mark} status = {status}" + (f"（{data.get('error_code')}: {data.get('message')}）" if status != "success" else ""))
    if status != "success":
        problems.append(f"决策测试 status={status}")
    target = data.get("target_context") or {}
    player_state = data.get("player_state") or {}
    decision = data.get("decision") or {}
    print(f"   目标：{target.get('mission_name') or '-'} / {target.get('planet_name') or '-'}，"
          f"属性 {player_state.get('required_stat')} 当前 {player_state.get('current_stat_value')}，"
          f"要求 {target.get('required_value')} / 推荐 {target.get('recommended_value')}")
    print(f"   判断：{decision.get('current_status') or decision.get('status') or '-'}")
    options = data.get("decision_options") or []
    print(f"   代表方案：{len(options)} 个")
    for opt in options[:6]:
        parts = [x for x in (opt.get("gene_name"), opt.get("equipment_name")) if x]
        print(f"     - {opt.get('role')}: {' + '.join(parts) or opt.get('option_type')} "
              f"→ {opt.get('effective_value')}（{opt.get('status')}）")
    lore = data.get("lore_requests") or []
    print(f"   需要检索的 Lore：{', '.join(x.get('lore_key', '') for x in lore) or '-'}")
    warnings = (data.get("intent_resolution") or {}).get("warnings") or []
    if warnings:
        print(f"{WARN} warnings: {warnings}")
    if args.show_context:
        print("\n完整决策上下文：")
        print(json.dumps(data, ensure_ascii=False, indent=2))


def main() -> int:
    parser = argparse.ArgumentParser(description="检查 Mock Game Server 连通性与数据")
    parser.add_argument("--mission", help="按指定任务做离线决策测试，如 MS002")
    parser.add_argument("--planet", help="按指定星球做离线决策测试，如 PL001")
    parser.add_argument("--show-context", action="store_true", help="打印完整决策上下文 JSON")
    args = parser.parse_args()

    raw = asyncio.run(check_endpoints())
    check_decision(raw, args)

    print()
    if problems:
        print(f"{FAIL} 发现 {len(problems)} 个问题：")
        for p in problems:
            print(f"   - {p}")
        return 1
    print(f"{OK} Mock Game Server 连通且数据可被决策代码使用")
    return 0


if __name__ == "__main__":
    sys.exit(main())

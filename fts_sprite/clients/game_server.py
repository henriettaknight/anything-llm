# -*- coding: utf-8 -*-
"""
Mock Game Server（JSON Server）客户端。

对应画布中 7 个串行的 Invoke 节点，这里改为并发请求：

  player       GET /players/                              Invoke:SunnyMonkeysBuild
  missions     GET /missions                              Invoke:HugeBusesDraw
  planets      GET /planets                               Invoke:ShyViewsRoll
  genes        GET /gene_samples                          Invoke:FuzzyFrogsGive
  equipment    GET /equipment                             Invoke:DirtyTurkeysCheer
  creatures    GET /creatures                             Invoke:SharpBoxesFold
  discoveries  GET /player_discoveries?player_id=<玩家ID>  Invoke:ChillyMelonsDo

返回值保持与 Invoke 节点一致：原始响应文本（字符串），失败时为空字符串。
"""

from __future__ import annotations

import asyncio
import json
import logging

import httpx

from settings import Settings

log = logging.getLogger("fts_sprite.game_server")

GAME_DATA_KEYS = ("player", "missions", "planets", "genes", "equipment", "creatures", "discoveries")


class GameServerClient:
    def __init__(self, http: httpx.AsyncClient, settings: Settings):
        self._http = http
        self._s = settings

    def _headers(self) -> dict:
        s = self._s
        if not s.mock_api_key:
            return {}
        return {s.mock_api_key_header: f"{s.mock_api_key_prefix}{s.mock_api_key}"}

    def _endpoints(self, player_id: str) -> dict[str, tuple[str, dict]]:
        return {
            "player": ("/players/", {}),
            "missions": ("/missions", {}),
            "planets": ("/planets", {}),
            "genes": ("/gene_samples", {}),
            "equipment": ("/equipment", {}),
            "creatures": ("/creatures", {}),
            "discoveries": ("/player_discoveries", {"player_id": player_id}),
        }

    async def _get(self, key: str, path: str, params: dict, request_id: str) -> str:
        if not self._s.mock_server_url:
            log.warning("[%s] MOCK_SERVER_URL not configured, skip %s", request_id, key)
            return ""
        try:
            resp = await self._http.get(
                f"{self._s.mock_server_url}{path}",
                params=params or None,
                headers=self._headers(),
                timeout=self._s.mock_timeout,
            )
            if resp.status_code != 200:
                log.error("[%s] GET %s -> HTTP %s", request_id, path, resp.status_code)
                return ""
            return resp.text
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            log.error("[%s] GET %s failed: %s", request_id, path, e)
            return ""

    @staticmethod
    def select_player(raw: str, player_id: str) -> str:
        """
        画布中 /players/ 返回数组时，Build_Decision_Context 直接取第一个玩家。
        这里先按 player_id 精确挑出当前 Demo 玩家（找不到时保持原样，交给原逻辑处理）。
        """
        if not raw or not player_id:
            return raw
        try:
            data = json.loads(raw)
        except Exception:  # noqa: BLE001
            return raw
        if isinstance(data, list):
            for p in data:
                if isinstance(p, dict) and player_id in (p.get("player_id"), p.get("id")):
                    return json.dumps(p, ensure_ascii=False)
        return raw

    def start_fetch_all(self, player_id: str, request_id: str = "") -> dict[str, asyncio.Task]:
        """立即并发发起全部请求，返回 {key: Task}，调用方按需 await。"""
        tasks: dict[str, asyncio.Task] = {}
        for key, (path, params) in self._endpoints(player_id).items():
            coro = self._get(key, path, params, request_id)
            if key == "player":
                coro = self._player(coro, player_id)
            tasks[key] = asyncio.create_task(coro, name=f"game:{key}")
        return tasks

    async def _player(self, coro, player_id: str) -> str:
        return self.select_player(await coro, player_id)

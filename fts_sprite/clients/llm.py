# -*- coding: utf-8 -*-
"""
按角色调用中间 LLM。

两种调用路径（由 LLMRoleConfig.mode 决定）：
  - gateway：POST Node 的 /api/fts_sprite/internal/llm，
             由 AnythingLLM 的 getLLMProvider 调用 workspace 模型（或指定 provider/model）。
             这样任何 AnythingLLM 支持的 provider 都能直接用，并统一记录 usage_logs。
  - direct ：Python 直连 OpenAI 兼容的 /chat/completions。
"""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass

import httpx

from settings import LLMRoleConfig

log = logging.getLogger("fts_sprite.llm")

_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)


class LLMError(RuntimeError):
    pass


@dataclass(frozen=True)
class GatewayInfo:
    """Node 在每次请求时下发的网关地址与一次性 token。"""

    url: str
    token: str


def strip_think(text: str) -> str:
    return _THINK_RE.sub("", text or "").strip()


class LLMClient:
    def __init__(self, http: httpx.AsyncClient):
        self._http = http

    async def chat(
        self,
        cfg: LLMRoleConfig,
        messages: list[dict],
        *,
        gateway: GatewayInfo | None,
        request_id: str = "",
    ) -> str:
        last_error: Exception | None = None
        attempts = max(1, cfg.max_retries)
        for attempt in range(1, attempts + 1):
            try:
                if cfg.mode == "direct":
                    text = await self._direct(cfg, messages)
                else:
                    if gateway is None:
                        raise LLMError("gateway info missing")
                    text = await self._gateway(cfg, messages, gateway, request_id)
                return strip_think(text)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                last_error = e
                log.warning(
                    "[%s] llm role=%s attempt %d/%d failed: %s",
                    request_id, cfg.role, attempt, attempts, e,
                )
                if attempt < attempts:
                    await asyncio.sleep(cfg.retry_delay)
        raise LLMError(f"llm role={cfg.role} failed: {last_error}")

    async def _gateway(
        self,
        cfg: LLMRoleConfig,
        messages: list[dict],
        gateway: GatewayInfo,
        request_id: str,
    ) -> str:
        body = {
            "role": cfg.role,
            "messages": messages,
            "temperature": cfg.temperature,
        }
        if cfg.provider:
            body["provider"] = cfg.provider
        if cfg.model:
            body["model"] = cfg.model
        resp = await self._http.post(
            gateway.url,
            json=body,
            headers={"X-FTS-Sprite-Token": gateway.token, "X-Request-Id": request_id},
            timeout=cfg.timeout,
        )
        if resp.status_code != 200:
            raise LLMError(f"gateway HTTP {resp.status_code}: {resp.text[:200]}")
        data = resp.json()
        if data.get("error"):
            raise LLMError(f"gateway error: {data['error']}")
        return data.get("text") or ""

    async def _direct(self, cfg: LLMRoleConfig, messages: list[dict]) -> str:
        body: dict = {
            "model": cfg.model,
            "messages": messages,
            "stream": False,
            "temperature": cfg.temperature,
        }
        if cfg.top_p is not None:
            body["top_p"] = cfg.top_p
        if cfg.frequency_penalty is not None:
            body["frequency_penalty"] = cfg.frequency_penalty
        if cfg.presence_penalty is not None:
            body["presence_penalty"] = cfg.presence_penalty
        headers = {"Content-Type": "application/json"}
        if cfg.api_key:
            headers["Authorization"] = f"Bearer {cfg.api_key}"
        resp = await self._http.post(
            f"{cfg.base_url}/chat/completions",
            json=body,
            headers=headers,
            timeout=cfg.timeout,
        )
        if resp.status_code != 200:
            raise LLMError(f"HTTP {resp.status_code}: {resp.text[:200]}")
        data = resp.json()
        return (data.get("choices") or [{}])[0].get("message", {}).get("content") or ""

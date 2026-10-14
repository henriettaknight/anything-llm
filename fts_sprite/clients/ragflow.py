# -*- coding: utf-8 -*-
"""
RAGFlow 检索客户端（POST /api/v1/retrieval）。

对应画布 Retrieval 节点（Retrieval:MetalBerriesSell）：
  top_n=1, top_k=1024, similarity_threshold=0.3, keywords_similarity_weight=0.3

画布里 formalized_content 会带上 "ID: x / Title: 文件名" 等行；
主 LLM 的系统提示词要求不得暴露文档 ID / 文件名，因此这里只拼接 chunk 正文。
Merge_Lore_Result 只依赖正文中的 "lore_key: xxx" 标记，不受影响。

失败降级：任何异常都返回空字符串，不阻塞主流程。
"""

from __future__ import annotations

import asyncio
import logging

import httpx

from settings import Settings

log = logging.getLogger("fts_sprite.ragflow")


class RagflowClient:
    def __init__(self, http: httpx.AsyncClient, settings: Settings):
        self._http = http
        self._s = settings

    @property
    def configured(self) -> bool:
        s = self._s
        return bool(s.ragflow_base_url and s.ragflow_api_key and s.ragflow_dataset_id)

    async def retrieve(self, question: str, request_id: str = "") -> list[dict]:
        """返回标准化 chunk 列表：[{content, score, document}]"""
        if not question or not question.strip():
            return []
        if not self.configured:
            log.warning("[%s] RAGFlow not configured, skip retrieval", request_id)
            return []
        s = self._s
        body = {
            "question": question,
            "dataset_ids": [s.ragflow_dataset_id],
            "page": 1,
            "page_size": s.ragflow_top_n,
            "top_k": s.ragflow_top_k,
            "similarity_threshold": s.ragflow_similarity_threshold,
            "vector_similarity_weight": s.ragflow_vector_similarity_weight,
            "keyword": False,
            "highlight": False,
        }
        try:
            resp = await self._http.post(
                f"{s.ragflow_base_url}/api/v1/retrieval",
                json=body,
                headers={"Authorization": f"Bearer {s.ragflow_api_key}"},
                timeout=s.ragflow_timeout,
            )
            if resp.status_code != 200:
                log.error("[%s] retrieval HTTP %s: %s", request_id, resp.status_code, resp.text[:200])
                return []
            data = resp.json()
            if isinstance(data, dict) and data.get("code") not in (None, 0):
                log.error("[%s] retrieval error: %s", request_id, data.get("message"))
                return []
            payload = data.get("data") if isinstance(data, dict) else None
            chunks = []
            if isinstance(payload, dict) and isinstance(payload.get("chunks"), list):
                chunks = payload["chunks"]
            elif isinstance(payload, list):
                chunks = payload
            out = []
            for c in chunks[: s.ragflow_top_n]:
                content = c.get("content") or c.get("content_with_weight") or c.get("text") or ""
                if not content:
                    continue
                out.append(
                    {
                        "content": content,
                        "score": c.get("similarity", c.get("score", 0)),
                        "document": c.get("document_keyword") or c.get("document_name") or "",
                    }
                )
            return out
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            log.error("[%s] retrieval failed: %s", request_id, e)
            return []

    async def retrieve_formalized(self, question: str, request_id: str = "") -> str:
        chunks = await self.retrieve(question, request_id)
        return "\n\n".join(c["content"].strip() for c in chunks)

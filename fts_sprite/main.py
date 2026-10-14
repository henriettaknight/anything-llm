# -*- coding: utf-8 -*-
"""
FTS 精灵 Python 服务入口（常驻进程，只监听 127.0.0.1）。

启动：
  cd fts_sprite && python -m uvicorn main:app --host 127.0.0.1 --port 8890

接口：
  GET  /health        健康检查与配置摘要（不含密钥）
  POST /workflow/run  执行一次精灵工作流，响应为 NDJSON 流：
       {"type":"status","stage":"intent","text":"正在理解你的问题…"}
       {"type":"result","mode":"llm","system_prompt":"…","user_prompt":"…","meta":{…},"debug":{…}|null}
       {"type":"result","mode":"direct","text":"…","meta":{…},"debug":{…}|null}
       {"type":"error","message":"…"}
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from clients.game_server import GameServerClient
from clients.llm import GatewayInfo, LLMClient
from clients.ragflow import RagflowClient
from settings import settings
from workflow import prompts
from workflow.runner import Deps, RunRequest, WorkflowError, run_workflow

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s [fts_sprite] %(levelname)s %(name)s: %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("fts_sprite")


class HistoryMessage(BaseModel):
    role: str
    content: str


class GatewayModel(BaseModel):
    url: str
    token: str


class RunBody(BaseModel):
    request_id: str = ""
    message: str
    history: list[HistoryMessage] = Field(default_factory=list)
    gateway: GatewayModel | None = None
    debug: bool = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    http = httpx.AsyncClient(limits=httpx.Limits(max_connections=100, max_keepalive_connections=20))
    executor = ThreadPoolExecutor(max_workers=settings.worker_threads, thread_name_prefix="fts_sprite")
    # 预加载提示词，启动时就能发现缺失文件
    for name in ("intent_system", "intent_user", "response_system", "response_user", "unknown_reply"):
        prompts.load(name)
    app.state.deps = Deps(
        settings=settings,
        llm=LLMClient(http),
        ragflow=RagflowClient(http, settings),
        game=GameServerClient(http, settings),
        executor=executor,
    )
    log.info("service ready: %s", json.dumps(settings.describe(), ensure_ascii=False))
    try:
        yield
    finally:
        await http.aclose()
        executor.shutdown(wait=False, cancel_futures=True)


app = FastAPI(title="FTS Sprite", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok", "config": settings.describe()}


@app.post("/workflow/run")
async def workflow_run(body: RunBody, request: Request):
    deps: Deps = request.app.state.deps
    req = RunRequest(
        request_id=body.request_id,
        message=body.message,
        history=[m.model_dump() for m in body.history],
        gateway=GatewayInfo(body.gateway.url, body.gateway.token) if body.gateway else None,
        debug=body.debug,
    )
    queue: asyncio.Queue = asyncio.Queue()

    async def emit(event: dict) -> None:
        await queue.put(event)

    async def worker() -> None:
        try:
            result = await run_workflow(req, deps, emit)
            await queue.put({"type": "result", **result})
        except asyncio.CancelledError:
            log.info("[%s] cancelled (client disconnected)", req.request_id)
            raise
        except WorkflowError as e:
            await queue.put({"type": "error", "message": str(e)})
        except Exception as e:  # noqa: BLE001
            log.exception("[%s] workflow failed", req.request_id)
            await queue.put({"type": "error", "message": f"workflow failed: {e}"})
        finally:
            queue.put_nowait(None)

    task = asyncio.create_task(worker())

    async def stream():
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield json.dumps(item, ensure_ascii=False) + "\n"
        finally:
            # Node 断开（玩家停止生成）时取消工作流
            if not task.done():
                task.cancel()

    return StreamingResponse(stream(), media_type="application/x-ndjson")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=settings.host, port=settings.port)

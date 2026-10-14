// server/utils/fts_sprite/serviceClient.js
//
// 调用 Python 精灵服务 POST /workflow/run，逐行解析 NDJSON 事件。
//
// 事件：
//   {"type":"status","stage":"…","text":"…"}     进度（转发给前端）
//   {"type":"result","mode":"llm"|"direct",…}    工作流结果
//   {"type":"error","message":"…"}               工作流失败

class FtsSpriteServiceError extends Error {
  /**
   * @param {string} message - 展示给玩家的信息
   * @param {string} [detail] - 只写日志的详细原因
   */
  constructor(message, detail = "") {
    super(message);
    this.name = "FtsSpriteServiceError";
    this.detail = detail;
  }
}

/**
 * @param {Object} opts
 * @param {string} opts.serviceUrl
 * @param {Object} opts.payload - { request_id, message, history, gateway, debug }
 * @param {AbortSignal} [opts.signal] - 玩家断开 / 停止生成时中断
 * @param {number} opts.timeoutMs
 * @param {(event: Object) => void} [opts.onEvent] - 收到 status 事件时回调
 * @returns {Promise<Object>} result 事件
 */
async function runFtsSpriteWorkflow({
  serviceUrl,
  payload,
  signal = null,
  timeoutMs,
  onEvent = () => {},
}) {
  // Node 18 没有 AbortSignal.any，手动合并「外部中断」与「超时」
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    let resp;
    try {
      resp = await fetch(`${serviceUrl}/workflow/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (e) {
      if (timedOut) throw new FtsSpriteServiceError("精灵思考超时，请稍后再试。", "timeout");
      if (signal?.aborted) throw e;
      throw new FtsSpriteServiceError(
        "精灵服务暂时不可用，请稍后再试。",
        `connect ${serviceUrl} failed: ${e?.cause?.code || e?.message}`
      );
    }
    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => "");
      throw new FtsSpriteServiceError(
        "精灵服务暂时不可用，请稍后再试。",
        `HTTP ${resp.status}: ${text.slice(0, 300)}`
      );
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let result = null;

    const handleLine = (line) => {
      if (!line.trim()) return;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        console.error("[fts_sprite] bad NDJSON line:", line.slice(0, 200));
        return;
      }
      if (event.type === "result") result = event;
      else if (event.type === "error")
        throw new FtsSpriteServiceError(
          event.message?.startsWith("workflow failed")
            ? "精灵暂时无法回答，请稍后再试。"
            : event.message || "精灵暂时无法回答，请稍后再试。",
          event.message
        );
      else onEvent(event);
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) handleLine(line);
      }
      buffer += decoder.decode();
      handleLine(buffer);
    } catch (e) {
      if (e instanceof FtsSpriteServiceError) throw e;
      if (timedOut) throw new FtsSpriteServiceError("精灵思考超时，请稍后再试。", "timeout");
      throw e;
    }

    if (!result)
      throw new FtsSpriteServiceError(
        "精灵暂时无法回答，请稍后再试。",
        "stream ended without result"
      );
    return result;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

/** GET /health，供 /api/fts_sprite/health 使用 */
async function getFtsSpriteHealth(serviceUrl) {
  const resp = await fetch(`${serviceUrl}/health`, {
    signal: AbortSignal.timeout(5000),
  });
  return resp.json();
}

module.exports = { runFtsSpriteWorkflow, getFtsSpriteHealth, FtsSpriteServiceError };

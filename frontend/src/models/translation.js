/**
 * Translation API client
 * 封装 /api/translation/* 调用，特别是 SSE 流式 translate
 */

const BASE = "/api/translation";

export async function listGlossaries() {
  const resp = await fetch(`${BASE}/glossaries`);
  if (!resp.ok) throw new Error(`listGlossaries HTTP ${resp.status}`);
  return resp.json();
}

export async function getHealth() {
  const resp = await fetch(`${BASE}/health`);
  if (!resp.ok) throw new Error(`getHealth HTTP ${resp.status}`);
  return resp.json();
}

/**
 * 流式翻译。封装 SSE 解析。
 * @param {Object} opts
 * @param {string} opts.sourceText
 * @param {string} [opts.glossaryId="default"]
 * @param {string} [opts.targetLang="English"]
 * @param {(hits: Array) => void} [opts.onTerms]
 * @param {(hits: Array) => void} [opts.onChunks]
 * @param {(token: string) => void} [opts.onToken]
 * @param {() => void} [opts.onDone]
 * @param {(err: Error) => void} [opts.onError]
 * @returns {Promise<void>}
 */
export async function streamTranslate({
  sourceText,
  glossaryId = "default",
  targetLang = "English",
  onTerms,
  onChunks,
  onToken,
  onDone,
  onError,
}) {
  try {
    const resp = await fetch(`${BASE}/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceText, glossaryId, targetLang }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`translate HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }
    if (!resp.body) throw new Error("no response body");

    const reader = resp.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE 事件按双换行分隔
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const rawEvent of events) {
        const lines = rawEvent.split("\n");
        let event = "message";
        let data = "";
        for (const line of lines) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (!data) continue;
        let json;
        try {
          json = JSON.parse(data);
        } catch (_) {
          continue;
        }
        switch (event) {
          case "terms":
            onTerms?.(json.hits || []);
            break;
          case "chunks":
            onChunks?.(json.hits || []);
            break;
          case "token":
            onToken?.(json.text || "");
            break;
          case "done":
            onDone?.();
            return;
          case "error":
            throw new Error(json.message || "server error");
        }
      }
    }
    onDone?.();
  } catch (err) {
    if (err?.name === "AbortError") return;
    onError?.(err);
  }
}

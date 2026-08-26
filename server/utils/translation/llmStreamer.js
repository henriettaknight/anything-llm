// server/utils/translation/llmStreamer.js
//
// 调 OpenAI 兼容 LLM 流式生成翻译。
// 从原 server/endpoints/translation.js 抽出，供 workspaceChatAdapter 复用。
//
// 配置（环境变量）：
//   TRANSLATION_LLM_BASE_URL  - OpenAI 兼容 endpoint（含 /v1）
//   TRANSLATION_LLM_API_KEY  - API Key（本地 Ollama 可空）
//   TRANSLATION_LLM_MODEL    - 模型名

/**
 * 调 OpenAI 兼容 LLM 流式生成翻译。
 * @param {string} prompt - 完整 prompt
 * @param {(token: string) => void} onToken - 收到 token 的回调
 * @returns {Promise<string>} 完整译文
 */
async function streamLlmTranslation(prompt, onToken) {
  const baseUrl = (process.env.TRANSLATION_LLM_BASE_URL || "").replace(/\/+$/, "");
  const apiKey = process.env.TRANSLATION_LLM_API_KEY || "";
  const model = process.env.TRANSLATION_LLM_MODEL || "gemma4-26b";
  let fullTranslation = "";

  if (!baseUrl) {
    throw new Error("TRANSLATION_LLM_BASE_URL not configured");
  }

  // 有 key 才送 Authorization 头（本地 Ollama 不需要，外部 OpenAI 兼容服务必填）
  const headers = { "Content-Type": "application/json" };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: prompt }],
      stream: true,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(5 * 60_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`LLM HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }

  if (!resp.body) {
    // 非 stream 响应兜底
    const data = await resp.json();
    fullTranslation = data?.choices?.[0]?.message?.content || "";
    if (fullTranslation) onToken(fullTranslation);
    return fullTranslation;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const raw of lines) {
      const line = raw.trim();
      if (!line || !line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return fullTranslation;
      try {
        const json = JSON.parse(payload);
        const token = json?.choices?.[0]?.delta?.content || "";
        if (token) {
          fullTranslation += token;
          onToken(token);
        }
      } catch (_) {
        // 单行解析失败不中断流
      }
    }
  }
  return fullTranslation;
}

module.exports = { streamLlmTranslation };

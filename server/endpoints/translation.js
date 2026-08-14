// server/endpoints/translation.js
//
// 智能翻译端点
// ===========
// POST /translation/translate  - SSE 流式翻译
//   1. 抽术语（spawn Python wrapper）→ event: terms
//   2. 检索 RAGFlow            → event: chunks
//   3. 流式调 LLM 翻译         → event: token (多次)
//   4. 结束                     → event: done
//
// GET  /translation/glossaries  - 词库列表
// GET  /translation/health      - 健康检查

const { reqBody } = require("../utils/http");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const { extractTerms } = require("../utils/translation/pythonBridge");
const { retrieval } = require("../utils/translation/ragflowClient");
const { buildTranslationPrompt } = require("../utils/translation/promptBuilder");

function translationEndpoints(app) {
  if (!app) return;

  // 词库列表。当前只有 Python 脚本内联的默认词库，后续可扩展扫描
  // server/storage/glossaries/*.jsonl
  app.get("/translation/glossaries", [validatedRequest], (_req, response) => {
    response.json({
      glossaries: [
        {
          id: "default",
          name: "仙侠小说术语库 v1",
          termCount: 968,
          source: "ragflow_code_组件_术语抽取.py (内置)",
        },
      ],
      defaultId: "default",
    });
  });

  // 健康检查：确认 Python + RAGFlow 是否就绪
  app.get("/translation/health", [validatedRequest], async (_req, response) => {
    const pythonBin = process.env.TRANSLATION_PYTHON_BIN || "python";
    const ragflowUrl = process.env.RAGFLOW_BASE_URL || "";
    const llmUrl = process.env.TRANSLATION_LLM_BASE_URL || "";
    response.json({
      python: { bin: pythonBin, configured: true },
      ragflow: { baseUrl: ragflowUrl, configured: !!ragflowUrl },
      llm: { baseUrl: llmUrl, configured: !!llmUrl },
    });
  });

  // 翻译主流程
  app.post(
    "/translation/translate",
    [validatedRequest],
    async (request, response) => {
      const { sourceText, glossaryId = "default", targetLang = "English" } =
        reqBody(request) || {};

      if (!sourceText || !sourceText.trim()) {
        response.status(400).json({ error: "sourceText is required" });
        return;
      }

      // 配 SSE 头
      response.setHeader("Cache-Control", "no-cache");
      response.setHeader("Content-Type", "text/event-stream");
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader("Connection", "keep-alive");
      response.flushHeaders();

      const sse = (event, data) => {
        response.write(`event: ${event}\n`);
        response.write(`data: ${JSON.stringify(data)}\n\n`);
      };
      const safe = (fn) => {
        try {
          return fn();
        } catch (e) {
          console.error("[translation.endpoint] sse write failed:", e?.message || e);
        }
      };

      try {
        // 步骤 1：抽术语
        const termsResult = await extractTerms(sourceText);
        safe(() =>
          sse("terms", {
            glossaryId,
            termTotal: termsResult.term_total,
            mandatoryCount: termsResult.mandatory_count,
            preferredCount: termsResult.preferred_count,
            hits: termsResult.hits,
          })
        );

        // 步骤 2：RAGFlow 检索（与术语抽取并行做以节省时间）
        const datasetId = process.env.RAGFLOW_DATASET_ID || "";
        const datasetIds = datasetId ? [datasetId] : [];
        const chunks = await retrieval(sourceText, datasetIds, 5);
        safe(() =>
          sse("chunks", {
            count: chunks.length,
            hits: chunks,
          })
        );

        // 步骤 3：拼 prompt + 流式调 LLM
        const prompt = buildTranslationPrompt({
          glossaryText: termsResult.glossary,
          chunks,
          sourceText,
          targetLang,
        });

        safe(() => sse("start", { glossaryId, chunkCount: chunks.length }));

        await streamLlmTranslation(prompt, (token) => {
          safe(() => sse("token", { text: token }));
        });

        safe(() => sse("done", {}));
      } catch (err) {
        console.error("[translation.endpoint] error:", err?.message || err);
        safe(() => sse("error", { message: err?.message || "unknown error" }));
      } finally {
        try {
          response.end();
        } catch (_) {}
      }
    }
  );
}

/**
 * 调 OpenAI 兼容 LLM 流式生成翻译
 * @param {string} prompt - 完整 prompt
 * @param {(token: string) => void} onToken - 收到 token 的回调
 */
async function streamLlmTranslation(prompt, onToken) {
  const baseUrl = (process.env.TRANSLATION_LLM_BASE_URL || "").replace(/\/+$/, "");
  const apiKey = process.env.TRANSLATION_LLM_API_KEY || "";
  const model = process.env.TRANSLATION_LLM_MODEL || "gemma4-26b";

  if (!baseUrl || !apiKey) {
    throw new Error(
      "TRANSLATION_LLM_BASE_URL / TRANSLATION_LLM_API_KEY not configured"
    );
  }

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
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
    onToken(data?.choices?.[0]?.message?.content || "");
    return;
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
      if (payload === "[DONE]") return;
      try {
        const json = JSON.parse(payload);
        const token = json?.choices?.[0]?.delta?.content || "";
        if (token) onToken(token);
      } catch (_) {
        // 单行解析失败不中断流
      }
    }
  }
}

module.exports = { translationEndpoints };

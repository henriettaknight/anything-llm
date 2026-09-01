/**
 * Direct AI Proxy Endpoint
 * Proxies requests from frontend to Ollama to avoid CORS and Mixed Content issues
 *
 * Key design:
 * 1. In Docker bridge network, containers cannot reach each other via
 *    127.0.0.1 or public IP (Docker DNAT skips localhost). We probe multiple
 *    candidate addresses and cache the one that works.
 * 2. Node.js undici default headersTimeout (~300s) is too short for large
 *    models like gemma4-31b with OLLAMA_NUM_PARALLEL=1. We use a custom
 *    undici Agent with extended timeouts.
 */

const { Agent } = require("undici");
const { userFromSession } = require("../utils/http");
const { recordUsage } = require("../utils/usageLogs");
const { resolveThink } = require("../utils/helpers/chat/think");

const PROXY_TIMEOUT = 10 * 60 * 1000;
const proxyAgent = new Agent({
  headersTimeout: PROXY_TIMEOUT,
  bodyTimeout: PROXY_TIMEOUT,
  connectTimeout: 30_000,
});

let _cachedOllamaAddr = null;

async function _probeOllamaAddress(port) {
  const candidates = [];

  if (process.env.OLLAMA_PROXY_URL) {
    const base = process.env.OLLAMA_PROXY_URL.replace(/\/$/, '');
    candidates.push({ label: 'OLLAMA_PROXY_URL', url: `${base}/api/chat` });
  }

  candidates.push({ label: 'ollama-dns',     url: `http://ollama:${port}/api/chat` });
  candidates.push({ label: 'docker-bridge',  url: `http://172.17.0.1:${port}/api/chat` });
  candidates.push({ label: 'docker-br0',     url: `http://172.18.0.1:${port}/api/chat` });
  candidates.push({ label: 'localhost',      url: `http://localhost:${port}/api/chat` });
  candidates.push({ label: '127.0.0.1',      url: `http://127.0.0.1:${port}/api/chat` });

  for (const c of candidates) {
    try {
      console.log(`[DirectAIProxy] Probing ${c.label}: ${c.url} ...`);
      const resp = await fetch(c.url, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
        dispatcher: proxyAgent,
      });
      console.log(`[DirectAIProxy]   ✓ ${c.label} responded: ${resp.status}`);
      return c.url;
    } catch (e) {
      const reason = e.cause?.code || e.cause?.message || e.message;
      console.log(`[DirectAIProxy]   ✗ ${c.label} failed: ${reason}`);
    }
  }
  return null;
}

async function _resolveOllamaUrl(originalUrl) {
  if (_cachedOllamaAddr) return _cachedOllamaAddr;

  let port = '11434';
  try {
    port = new URL(originalUrl).port || '11434';
  } catch (_) { /* keep default */ }

  console.log('[DirectAIProxy] No cached Ollama address, probing candidates...');
  const found = await _probeOllamaAddress(port);

  if (found) {
    _cachedOllamaAddr = found;
    console.log('[DirectAIProxy] ✔ Cached Ollama address:', _cachedOllamaAddr);
    return _cachedOllamaAddr;
  }

  console.warn('[DirectAIProxy] ⚠ All probes failed, falling back to original URL');
  return originalUrl.replace('/v1/chat/completions', '/api/chat');
}

function directAiProxyEndpoints(app) {
  if (!app) return;

  app.get(
    "/direct-ai-proxy/health",
    async (_req, res) => {
      const results = {};
      const port = '11434';
      const candidates = [
        { label: 'ollama-dns',    url: `http://ollama:${port}` },
        { label: 'docker-bridge', url: `http://172.17.0.1:${port}` },
        { label: 'docker-br0',    url: `http://172.18.0.1:${port}` },
        { label: 'localhost',     url: `http://localhost:${port}` },
        { label: '127.0.0.1',     url: `http://127.0.0.1:${port}` },
      ];

      for (const c of candidates) {
        try {
          const r = await fetch(c.url, {
            method: 'GET',
            signal: AbortSignal.timeout(3000),
            dispatcher: proxyAgent,
          });
          results[c.label] = { ok: true, status: r.status };
        } catch (e) {
          results[c.label] = { ok: false, error: e.cause?.code || e.cause?.message || e.message };
        }
      }

      results.cachedAddr = _cachedOllamaAddr || 'not cached yet';
      res.json(results);
    }
  );

  app.post(
    "/direct-ai-proxy",
    async (request, response) => {
      try {
        const { url, body, apiKey, feature, authToken } = request.body;

        // 优先从 Authorization 头取登录态；代理请求可能把 JWT 放在 body.authToken 兜底
        let user = await userFromSession(request, response);
        if (!user && authToken) {
          try {
            const valid = require("jsonwebtoken").verify(authToken, process.env.JWT_SECRET);
            if (valid?.id) {
              const { User } = require("../models/user");
              user = await User.get({ id: valid.id });
            }
          } catch (_) { /* 无效 token 忽略，userId 留空 */ }
        }
        const userId = user?.id || null;

        const requestStartedAt = Date.now();

        if (!url || !body) {
          return response.status(400).json({
            error: "Missing required fields: url and body"
          });
        }

        // Resolve API key: frontend-passed > server env > none
        const resolvedApiKey = apiKey || null;

        console.log('[DirectAIProxy] Proxying request to:', url);
        console.log('[DirectAIProxy] Has API Key:', !!resolvedApiKey);
        console.log('[DirectAIProxy] Request body (first 200):', JSON.stringify(body).substring(0, 200));
        if (body && body.messages) {
          console.log('[DirectAIProxy] Messages received:', body.messages.length);
          body.messages.forEach((m, i) => {
            const len = typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length;
            console.log(`[DirectAIProxy]   [${i}] role=${m.role}, content_length=${len}`);
          });
        } else {
          console.warn('[DirectAIProxy] ⚠️ No messages in request body!');
        }

        // 通过 URL 路径判断 API 格式，避免模型名误判
        const isOllama = url && url.includes('/api/chat');
        const isOpenAI = url && url.includes('/v1/chat/completions');

        let targetUrl = url;
        let transformedBody = body;

        if (isOllama) {
          // Ollama 格式：需要转换请求体
          targetUrl = await _resolveOllamaUrl(url);
          console.log('[DirectAIProxy] Resolved Ollama target:', targetUrl);

          transformedBody = {
            model: body.model,
            messages: body.messages,
            stream: body.stream !== false,
            temperature: typeof body.temperature === 'number' ? body.temperature : 0.7,
            options: {
              num_ctx: body.options?.num_ctx || 32768
            },
            // 代码检测默认开启思考（OLLAMA_THINK_CODEREVIEW），关闭前需先用
            // gui.h 等样本做 A/B 验证召回率，避免思维链缺失导致漏报。
            think: resolveThink('codereview')
          };
          console.log('[DirectAIProxy] Transformed to Ollama format');
        } else if (isOpenAI) {
          // OpenAI-compatible 格式：无需转换，保持原样
          console.log('[DirectAIProxy] OpenAI format detected, no transformation needed');
        } else {
          // 未知格式：尝试通过端口判断（兼容旧逻辑）
          const isOllamaPort = url && url.includes(':11434');
          if (isOllamaPort) {
            targetUrl = await _resolveOllamaUrl(url);
            console.log('[DirectAIProxy] Fallback: resolved Ollama target:', targetUrl);
            transformedBody = {
              model: body.model,
              messages: body.messages,
              stream: body.stream !== false,
              temperature: typeof body.temperature === 'number' ? body.temperature : 0.7,
              options: {
                num_ctx: body.options?.num_ctx || 32768
              },
              think: resolveThink('codereview')
            };
          }
        }

        if (transformedBody.messages) {
          console.log('[DirectAIProxy] Sending to Ollama, messages:', transformedBody.messages.length);
          transformedBody.messages.forEach((m, i) => {
            const len = typeof m.content === 'string' ? m.content.length : 0;
            console.log(`[DirectAIProxy]   [${i}] role=${m.role}, content_length=${len}`);
          });
        }

        const proxyHeaders = {
          'Content-Type': 'application/json',
        };
        if (resolvedApiKey) {
          proxyHeaders['Authorization'] = `Bearer ${resolvedApiKey}`;
        }

        const backendResponse = await fetch(targetUrl, {
          method: 'POST',
          headers: proxyHeaders,
          body: JSON.stringify(transformedBody),
          signal: AbortSignal.timeout(PROXY_TIMEOUT),
          dispatcher: proxyAgent,
        });

        if (!backendResponse.ok) {
          const errorText = await backendResponse.text();
          console.error('[DirectAIProxy] Backend error:', backendResponse.status, errorText);

          // Provide actionable error message for 401 Unauthorized
          if (backendResponse.status === 401) {
            const hint = !resolvedApiKey
              ? 'API key is not configured. Set it in your docker-compose environment or .env file and restart the web container.'
              : 'The provided API key was rejected by the backend.';
            console.error('[DirectAIProxy] Auth hint:', hint);
            return response.status(401).json({
              error: `Authentication failed (401): ${hint}`,
              hint
            });
          }

          return response.status(backendResponse.status).json({
            error: `Backend error: ${backendResponse.status} - ${errorText}`
          });
        }

        response.setHeader('Content-Type', 'text/event-stream');
        response.setHeader('Cache-Control', 'no-cache');
        response.setHeader('Connection', 'keep-alive');
        response.setHeader('X-Accel-Buffering', 'no');
        response.flushHeaders();

        const reader = backendResponse.body.getReader();
        const decoder = new TextDecoder();

        // 累积用量统计（ollama 末尾 chunk 带 prompt_eval_count / eval_count）
        let promptTokens = 0;
        let completionTokens = 0;

        // 跨 read 的行缓冲：NDJSON 流可能把一行 JSON 拆在两次 read 之间，
        // 直接 split("\n") 会解析到半行 JSON 而漏掉 usage（导致用量永为 0、不落库）。
        let lineBuffer = "";
        const flushUsageLine = (rawLine) => {
          const line = rawLine.trim();
          if (!line) return;
          const jsonStr = line.startsWith("data:") ? line.slice(5).trim() : line;
          if (jsonStr === "[DONE]") return;
          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed?.usage) {
              promptTokens = Number(parsed.usage.prompt_tokens) ||
                Number(parsed.usage.prompt_eval_count) || promptTokens;
              completionTokens = Number(parsed.usage.completion_tokens) ||
                Number(parsed.usage.eval_count) || completionTokens;
            }
            if (typeof parsed?.prompt_eval_count === "number") {
              promptTokens = parsed.prompt_eval_count;
            }
            if (typeof parsed?.eval_count === "number") {
              completionTokens = parsed.eval_count;
            }
          } catch (_) { /* 非 JSON 行忽略 */ }
        };

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            response.write(chunk);

            // 按行解析，未完成的行留在 lineBuffer 等待下次拼接
            lineBuffer += chunk;
            let nlIdx;
            while ((nlIdx = lineBuffer.indexOf("\n")) !== -1) {
              const completeLine = lineBuffer.slice(0, nlIdx);
              lineBuffer = lineBuffer.slice(nlIdx + 1);
              flushUsageLine(completeLine);
            }
          }
          // 循环结束后 flush 残留（ollama 末帧常无尾随换行）
          flushUsageLine(lineBuffer);
          lineBuffer = "";
        } finally {
          reader.releaseLock();
          response.end();
        }

        console.log('[DirectAIProxy] Stream completed successfully');

        // 代码检测（code_review）用量落库：仅在请求显式带 feature 标记时写 usage_logs
        if (feature === "code_review" && (promptTokens > 0 || completionTokens > 0)) {
          const durationMs = Date.now() - requestStartedAt;
          await recordUsage({
            userId,
            feature: "code_review",
            provider: isOllama ? "ollama" : (isOpenAI ? "openai" : null),
            model: body?.model || null,
            durationMs,
            metrics: {
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
              total_tokens: promptTokens + completionTokens,
            },
          });
        }
      } catch (error) {
        const cause = error.cause;
        console.error('[DirectAIProxy] Error:', error.message);
        if (cause) {
          console.error('[DirectAIProxy]   cause.code:', cause.code);
          console.error('[DirectAIProxy]   cause.message:', cause.message);
          console.error('[DirectAIProxy]   cause.errno:', cause.errno);
        }
        if (!response.headersSent) {
          response.status(500).json({
            error: error.message,
            cause: cause ? { code: cause.code, message: cause.message } : undefined
          });
        }
      }
    }
  );
}

module.exports = { directAiProxyEndpoints };

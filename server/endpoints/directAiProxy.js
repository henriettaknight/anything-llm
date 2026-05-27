/**
 * Direct AI Proxy Endpoint
 * Proxies requests from frontend to vLLM or Ollama to avoid CORS and Mixed Content issues
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
        const { url, body } = request.body;

        if (!url || !body) {
          return response.status(400).json({
            error: "Missing required fields: url and body"
          });
        }

        console.log('[DirectAIProxy] Proxying request to:', url);
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

        const isOllamaPort = url && url.includes(':11434');
        const isOllama = isOllamaPort || (body.model && (
          body.model.includes('gemma') ||
          body.model.includes('ollama') ||
          body.model.includes('llama') ||
          body.model.includes('mistral') ||
          body.model.includes('qwen') ||
          body.model.includes('phi')
        ));

        let targetUrl = url;
        let transformedBody = body;

        if (isOllama) {
          targetUrl = await _resolveOllamaUrl(url);
          console.log('[DirectAIProxy] Resolved Ollama target:', targetUrl);

          transformedBody = {
            model: body.model,
            messages: body.messages,
            stream: body.stream !== false,
            temperature: typeof body.temperature === 'number' ? body.temperature : 0.7,
            options: {
              num_ctx: body.options?.num_ctx || 32768
            }
          };
          console.log('[DirectAIProxy] Transformed to Ollama format');
          if (transformedBody.messages) {
            console.log('[DirectAIProxy] Sending to Ollama, messages:', transformedBody.messages.length);
            transformedBody.messages.forEach((m, i) => {
              const len = typeof m.content === 'string' ? m.content.length : 0;
              console.log(`[DirectAIProxy]   [${i}] role=${m.role}, content_length=${len}`);
            });
          }
        }

        const backendResponse = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(transformedBody),
          signal: AbortSignal.timeout(PROXY_TIMEOUT),
          dispatcher: proxyAgent,
        });

        if (!backendResponse.ok) {
          const errorText = await backendResponse.text();
          console.error('[DirectAIProxy] Backend error:', backendResponse.status, errorText);
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

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            response.write(chunk);
          }
        } finally {
          reader.releaseLock();
          response.end();
        }

        console.log('[DirectAIProxy] Stream completed successfully');
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

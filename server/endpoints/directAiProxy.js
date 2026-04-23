/**
 * Direct AI Proxy Endpoint
 * Proxies requests from frontend to vLLM or Ollama to avoid CORS and Mixed Content issues
 */

function directAiProxyEndpoints(app) {
  if (!app) return;

  /**
   * Proxy streaming chat requests to vLLM or Ollama
   * This allows HTTPS frontend to communicate with HTTP backend
   * Note: This endpoint requires authentication
   */
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
        // Log messages structure to confirm they arrived intact
        if (body && body.messages) {
          console.log('[DirectAIProxy] Messages received:', body.messages.length);
          body.messages.forEach((m, i) => {
            const len = typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length;
            console.log(`[DirectAIProxy]   [${i}] role=${m.role}, content_length=${len}`);
          });
        } else {
          console.warn('[DirectAIProxy] ⚠️ No messages in request body!');
        }

        // Detect if this is Ollama based on model name instead of URL
        // Also detect by port 11434 (default Ollama port)
        const isOllamaPort = url && url.includes(':11434');
        const isOllama = isOllamaPort || (body.model && (
          body.model.includes('gemma') ||
          body.model.includes('ollama') ||
          body.model.includes('llama') ||
          body.model.includes('mistral') ||
          body.model.includes('qwen') ||
          body.model.includes('phi')
        ));
        
        // Determine the correct URL based on model type
        let targetUrl = url;
        let transformedBody = body;
        
        if (isOllama) {
          // Convert OpenAI format URL to Ollama format
          targetUrl = url.replace('/v1/chat/completions', '/api/chat');
          console.log('[DirectAIProxy] Detected Ollama model, converting URL to:', targetUrl);
          
          // Ollama uses different format
          transformedBody = {
            model: body.model,
            messages: body.messages,
            stream: body.stream !== false,
            // Use body.temperature exactly; avoid `|| 0.7` because 0 is falsy but valid
            temperature: typeof body.temperature === 'number' ? body.temperature : 0.7,
            options: {
              // Explicitly set context window to avoid Ollama truncating input prompt.
              // Without this, Ollama defaults to KvSize=8192 which truncates long code prompts.
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

        // Forward the request to backend
        const backendResponse = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(transformedBody),
          signal: AbortSignal.timeout(600000), // 600 秒超时（10分钟，适配大模型推理）
        });

        if (!backendResponse.ok) {
          const errorText = await backendResponse.text();
          console.error('[DirectAIProxy] Backend error:', backendResponse.status, errorText);
          return response.status(backendResponse.status).json({
            error: `Backend error: ${backendResponse.status} - ${errorText}`
          });
        }

        // Set headers for SSE streaming
        response.setHeader('Content-Type', 'text/event-stream');
        response.setHeader('Cache-Control', 'no-cache');
        response.setHeader('Connection', 'keep-alive');
        // Tell nginx NOT to buffer this response - critical for streaming through reverse proxy
        response.setHeader('X-Accel-Buffering', 'no');
        // Flush headers immediately so nginx sees the streaming headers before any data arrives
        response.flushHeaders();

        // Stream the response back to the client
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
        console.error('[DirectAIProxy] Error:', error);
        if (!response.headersSent) {
          response.status(500).json({
            error: error.message
          });
        }
      }
    }
  );
}

module.exports = { directAiProxyEndpoints };

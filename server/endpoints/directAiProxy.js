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
        console.log('[DirectAIProxy] Request body:', JSON.stringify(body).substring(0, 200));

        // Detect if this is Ollama based on model name instead of URL
        const isOllama = body.model && (
          body.model.includes('gemma') || 
          body.model.includes('ollama') ||
          body.model.includes('llama') ||
          body.model.includes('mistral')
        );
        
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
            temperature: body.temperature || 0.7
          };
          console.log('[DirectAIProxy] Transformed to Ollama format');
        }

        // Forward the request to backend
        const backendResponse = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(transformedBody),
          signal: AbortSignal.timeout(120000), // 120 秒超时
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

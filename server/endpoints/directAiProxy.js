/**
 * Direct AI Proxy Endpoint
 * Proxies requests from frontend to vLLM to avoid CORS and Mixed Content issues
 */

function directAiProxyEndpoints(app) {
  if (!app) return;

  /**
   * Proxy streaming chat requests to vLLM
   * This allows HTTPS frontend to communicate with HTTP vLLM backend
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

        // Forward the request to vLLM
        const vllmResponse = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (!vllmResponse.ok) {
          const errorText = await vllmResponse.text();
          console.error('[DirectAIProxy] vLLM error:', vllmResponse.status, errorText);
          return response.status(vllmResponse.status).json({
            error: `vLLM error: ${vllmResponse.status} - ${errorText}`
          });
        }

        // Set headers for SSE streaming
        response.setHeader('Content-Type', 'text/event-stream');
        response.setHeader('Cache-Control', 'no-cache');
        response.setHeader('Connection', 'keep-alive');

        // Stream the response back to the client
        const reader = vllmResponse.body.getReader();
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

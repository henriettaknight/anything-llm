/**
 * Dual Mode AI Adapter
 * Supports both direct AI mode (172.16.100.61) and LLM mode
 * 
 * Direct mode: Direct connection to local AI model
 * LLM mode: Connection through AnythingLLM backend
 */

import { AIAdapter } from './aiAdapter.js';
import { getAIMode, getAIConfig, AI_MODES } from '../config/aiModeConfig.js';
import { AUTH_TOKEN } from '../../../utils/constants.js';
import { isKeycloakEnabled, getToken } from '../../../utils/keycloak.js';

/**
 * 取当前登录用户的 JWT：keycloak 模式用 getToken()，否则用 localStorage 中的 AUTH_TOKEN。
 * 代理请求需要把登录态透传给后端 directAiProxy，用于 usage_logs 的 userId 统计。
 */
function getCurrentAuthToken() {
  try {
    if (isKeycloakEnabled && isKeycloakEnabled()) {
      const kc = getToken && getToken();
      if (kc) return kc;
    }
    const stored = typeof window !== "undefined" && window.localStorage.getItem(AUTH_TOKEN);
    return stored || null;
  } catch (_) {
    return null;
  }
}

/**
 * Direct AI Adapter - connects directly to 172.16.100.61:8000
 */
export class DirectAIAdapter {
  constructor(config) {
    this.url = config.url;
    this.model = config.model;
    this.temperature = config.temperature || 0;
    this.apiKey = config.apiKey || null;
  }

  /**
   * Determine the API endpoint based on service URL.
   * Ollama uses port 11434, vLLM/OpenAI use other ports.
   * @private
   * @returns {'/api/chat' | '/v1/chat/completions'}
   */
  _getApiEndpoint() {
    const isOllamaService = this.url && this.url.includes(':11434');
    return isOllamaService ? '/api/chat' : '/v1/chat/completions';
  }

  /**
   * Build request config (url, payload, proxy flag) shared by chat & streamChat.
   * @private
   * @param {Object} requestBody - The request body to send
   * @returns {{ useProxy: boolean, apiEndpoint: string, fullUrl: string, requestPayload: Object }}
   */
  _buildRequestConfig(requestBody) {
    const useProxy = window.location.protocol === 'https:' && this.url.startsWith('http://');
    const apiEndpoint = this._getApiEndpoint();
    const fullUrl = useProxy
      ? '/api/direct-ai-proxy'
      : `${this.url}${apiEndpoint}`;
    // 代理路径需要把登录态透传给后端，用于 usage_logs 的 userId 统计
    const authToken = useProxy ? getCurrentAuthToken() : null;
    const requestPayload = useProxy
      ? {
          url: `${this.url}${apiEndpoint}`,
          body: requestBody,
          apiKey: this.apiKey,
          feature: "code_review",
          authToken: authToken || undefined,
        }
      : requestBody;
    const headers = { 'Content-Type': 'application/json' };
    // Direct request (not proxy) needs Authorization header for the AI endpoint
    if (!useProxy && this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    // Proxy request needs the user's session JWT so backend can resolve userId
    if (useProxy && authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    return { useProxy, apiEndpoint, fullUrl, requestPayload, headers };
  }

  /**
   * Create an AbortController with timeout and optional external signal.
   * @private
   * @param {Object} options - Options containing optional signal
   * @param {number} [timeoutMs=600000] - Timeout in milliseconds
   * @returns {AbortController}
   */
  _createAbortController(options, timeoutMs = 600000) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const controller = new AbortController();
    if (options.signal) {
      options.signal.addEventListener('abort', () => controller.abort());
    }
    timeoutSignal.addEventListener('abort', () => controller.abort());
    return controller;
  }

  /**
   * Log common request diagnostics (messages, request body, endpoint info).
   * @private
   */
  _logRequestDiagnostics(messages, requestBody, { useProxy, apiEndpoint, fullUrl }) {
    const isOllamaService = apiEndpoint === '/api/chat';
    console.log('\n' + '='.repeat(80));
    console.log('🤖 DirectAIAdapter: Starting request');
    console.log('='.repeat(80));
    console.log('📍 Target URL:', this.url);
    console.log('📍 Model:', this.model);
    console.log('📍 Temperature:', this.temperature);
    console.log('📝 Messages count:', messages.length);

    const systemMessage = messages.find(m => m.role === 'system');
    if (systemMessage) {
      console.log('\n✓ System prompt found:');
      console.log('  - Length:', systemMessage.content.length, 'characters');
      console.log('  - First 500 chars:', systemMessage.content.substring(0, 500));
      console.log('  - Last 200 chars:', systemMessage.content.substring(systemMessage.content.length - 200));
      console.log('  - MD5 hash:', this._simpleHash(systemMessage.content));
    } else {
      console.warn('⚠️ No system prompt found in messages!');
    }

    const userMessage = messages.find(m => m.role === 'user');
    if (userMessage) {
      console.log('\n✓ User message found:');
      console.log('  - Length:', userMessage.content.length, 'characters');
      console.log('  - First 300 chars:', userMessage.content.substring(0, 300));
    }

    console.log('\n📤 Complete Request Body:');
    console.log('  - model:', requestBody.model);
    console.log('  - messagesCount:', requestBody.messages.length);
    console.log('  - stream:', requestBody.stream);
    console.log('  - temperature:', requestBody.temperature);
    console.log('\n📋 Full messages structure:');
    requestBody.messages.forEach((msg, idx) => {
      console.log(`  [${idx}] role: ${msg.role}, content length: ${msg.content.length}`);
    });

    console.log('\n🌐 Sending HTTP Request:');
    console.log('  - URL:', fullUrl);
    console.log('  - Using proxy:', useProxy);
    console.log('  - API endpoint:', apiEndpoint, isOllamaService ? '(Ollama)' : '(vLLM/OpenAI)');
    console.log('  - Method: POST');
    console.log('  - Has API Key:', !!this.apiKey);
    console.log('  - Body size:', JSON.stringify(requestBody).length, 'bytes');
  }

  /**
   * Simple hash function for comparing strings
   * @private
   */
  _simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
  }

  /**
   * Non-streaming chat with direct AI model (for accurate token statistics)
   * 
   * @param {Array<{role: string, content: string}>} messages - Chat messages
   * @param {Object} options - Additional options
   * @returns {Promise<{content: string, usage: Object}>} - Response with content and token usage
   */
  async chat(messages, options = {}) {
    try {
      // When using proxy, force stream:true to keep nginx alive (prevents 504 timeout).
      // When direct HTTP (no proxy), use stream:false for simple JSON response.
      const useProxy = window.location.protocol === 'https:' && this.url.startsWith('http://');
      const useStreaming = useProxy;

      const requestBody = {
        model: this.model,
        messages,
        stream: useStreaming,
        temperature: this.temperature,
      };

      const reqConfig = this._buildRequestConfig(requestBody);
      this._logRequestDiagnostics(messages, requestBody, reqConfig);

      const requestStartTime = Date.now();
      const controller = this._createAbortController(options);

      const response = await fetch(reqConfig.fullUrl, {
        method: 'POST',
        headers: reqConfig.headers,
        body: JSON.stringify(reqConfig.requestPayload),
        signal: controller.signal
      });

      console.log('\n📥 Response received:');
      console.log('  - Status:', response.status, response.statusText);
      console.log('  - Time taken:', Date.now() - requestStartTime, 'ms');
      console.log('  - Headers:', Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const errorText = await response.text();
        console.error('\n❌ Direct AI API error:');
        console.error('  - Status:', response.status);
        console.error('  - Error text:', errorText);
        throw new Error(`Direct AI API error: ${response.status} - ${errorText}`);
      }

      // Streaming path: collect full response from SSE stream (keeps nginx alive)
      if (useStreaming) {
        console.log('\n✅ Response OK, collecting streaming response...');
        const { fullContent, tokenUsage, chunkCount } = await this._collectStreamResponse(response);

        console.log('\n✅ Streaming response collected:');
        console.log('  - Total chunks:', chunkCount);
        console.log('  - Content length:', fullContent.length);
        console.log('  - First 500 chars:', fullContent.substring(0, 500));
        console.log('  - Last 200 chars:', fullContent.substring(fullContent.length - 200));
        if (tokenUsage) {
          console.log('  - Token usage:', JSON.stringify(tokenUsage));
        } else {
          console.warn('  - ⚠️ No token usage data in stream');
        }
        console.log('='.repeat(80) + '\n');

        return { content: fullContent, usage: tokenUsage, done: true, fullText: fullContent };
      }

      // Non-streaming path (direct HTTP, no proxy, no nginx)
      console.log('\n✅ Response OK, parsing JSON...');

      const data = await response.json();
      console.log('\n🔍 Raw response diagnostics:');
      console.log('  - Top-level keys:', Object.keys(data || {}));
      console.log('  - Has choices[0].message.content:', !!data?.choices?.[0]?.message?.content);
      console.log('  - Has message.content (Ollama):', !!data?.message?.content);
      console.log('  - usage:', data?.usage || null);
      console.log('  - prompt_eval_count:', data?.prompt_eval_count ?? null);
      console.log('  - eval_count:', data?.eval_count ?? null);

      const content = this._extractContentFromPayload(data);
      const usage = this._extractUsageFromPayload(data);

      console.log('\n✅ Response parsed:');
      console.log('  - Content length:', content.length);
      if (usage) console.log('  - Token usage:', JSON.stringify(usage));
      console.log('='.repeat(80) + '\n');

      return { content, usage, done: true, fullText: content };

    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('⚠️ Direct AI request was cancelled');
        throw new Error('Direct AI request was cancelled');
      }
      console.error('❌ DirectAIAdapter error:', error);
      throw error;
    }
  }

  /**
   * Collect a full response from an SSE stream (non-yielding, used by chat()).
   * @private
   * @param {Response} response - Fetch response with readable stream
   * @returns {Promise<{fullContent: string, tokenUsage: Object|null, chunkCount: number}>}
   */
  async _collectStreamResponse(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    let tokenUsage = null;
    let chunkCount = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;

          let rawData = trimmed;
          if (rawData.startsWith('data: ')) {
            rawData = rawData.slice(6);
          }
          if (rawData === '[DONE]') continue;

          const parsed = this._parseStreamChunk(rawData);
          if (!parsed) continue;

          if (parsed.content) {
            fullContent += parsed.content;
            chunkCount++;
          }
          if (parsed.usage) {
            tokenUsage = parsed.usage;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return { fullContent, tokenUsage, chunkCount };
  }

  /**
   * Parse a single SSE/NDJSON chunk from either Ollama or OpenAI/vLLM format.
   * @private
   * @param {string} rawData - Raw JSON string (after stripping "data: " prefix)
   * @returns {{content: string, usage: Object|null, done: boolean}|null}
   */
  _parseStreamChunk(rawData) {
    try {
      const parsed = JSON.parse(rawData);

      // Ollama signals end via done:true
      if (parsed.done === true) {
        let usage = null;
        if (typeof parsed.prompt_eval_count === 'number' || typeof parsed.eval_count === 'number') {
          const p = parsed.prompt_eval_count || 0;
          const c = parsed.eval_count || 0;
          usage = { prompt_tokens: p, completion_tokens: c, total_tokens: p + c };
        }
        return { content: '', usage, done: true };
      }

      // Content from both Ollama and OpenAI/vLLM formats
      const content = parsed.choices?.[0]?.delta?.content || parsed.message?.content || '';

      // Token usage (OpenAI/vLLM format, usually in last chunk)
      const usage = parsed.usage || null;

      return { content, usage, done: false };
    } catch {
      return null;
    }
  }

  /**
   * Stream chat with direct AI model
   * 
   * @param {Array<{role: string, content: string}>} messages - Chat messages
   * @param {Object} options - Additional options
   * @returns {AsyncGenerator<string>} - Async generator of response chunks
   */
  async *streamChat(messages, options = {}) {
    try {
      const requestBody = {
        model: this.model,
        messages,
        stream: true,
        temperature: this.temperature,
      };

      const reqConfig = this._buildRequestConfig(requestBody);
      this._logRequestDiagnostics(messages, requestBody, reqConfig);

      const requestStartTime = Date.now();
      const controller = this._createAbortController(options);

      const response = await fetch(reqConfig.fullUrl, {
        method: 'POST',
        headers: reqConfig.headers,
        body: JSON.stringify(reqConfig.requestPayload),
        signal: controller.signal
      });

      console.log('\n📥 Response received:');
      console.log('  - Status:', response.status, response.statusText);
      console.log('  - Time taken:', Date.now() - requestStartTime, 'ms');
      console.log('  - Headers:', Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const errorText = await response.text();
        console.error('\n❌ Direct AI API error:');
        console.error('  - Status:', response.status);
        console.error('  - Error text:', errorText);
        throw new Error(`Direct AI API error: ${response.status} - ${errorText}`);
      }

      console.log('\n✅ Response OK, starting to stream...');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let chunkCount = 0;
      let totalContent = '';
      let firstChunkReceived = false;
      let tokenUsage = null;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            console.log('\n✅ Stream completed:');
            console.log('  - Total chunks:', chunkCount);
            console.log('  - Total content length:', totalContent.length);
            console.log('  - First 500 chars of response:', totalContent.substring(0, 500));
            console.log('  - Last 200 chars of response:', totalContent.substring(totalContent.length - 200));
            if (tokenUsage) {
              console.log('  - Token usage:', JSON.stringify(tokenUsage));
            }
            console.log('='.repeat(80) + '\n');

            yield { content: '', done: true, fullText: totalContent, usage: tokenUsage };
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;

            let rawData;
            if (line.startsWith('data: ')) {
              rawData = line.slice(6);
            } else {
              rawData = line;
            }

            if (rawData === '[DONE]') {
              console.log('\n✓ Received [DONE] signal');
              if (tokenUsage) {
                console.log('  - Final token usage:', JSON.stringify(tokenUsage));
              }
              yield { content: '', done: true, fullText: totalContent, usage: tokenUsage };
              return;
            }

            const parsed = this._parseStreamChunk(rawData);
            if (!parsed) continue;

            // Update token usage if provided
            if (parsed.usage) {
              tokenUsage = parsed.usage;
              console.log('\n📊 Token usage received:', JSON.stringify(tokenUsage));
            }

            // Handle Ollama done signal
            if (parsed.done) {
              if (parsed.usage) {
                tokenUsage = parsed.usage;
                console.log('\n📊 Ollama token usage received:', JSON.stringify(tokenUsage));
              }
              yield { content: '', done: true, fullText: totalContent, usage: tokenUsage };
              return;
            }

            if (parsed.content) {
              chunkCount++;
              totalContent += parsed.content;

              if (!firstChunkReceived) {
                console.log('\n🎯 First chunk received:');
                console.log('  - Content:', JSON.stringify(parsed.content));
                firstChunkReceived = true;
              }

              if (chunkCount % 50 === 0) {
                console.log(`  📊 Progress: ${chunkCount} chunks, ${totalContent.length} chars`);
              }

              yield { content: parsed.content, done: false, fullText: totalContent, usage: tokenUsage };
            }
          }
        }
      } finally {
        reader.releaseLock();
        console.log('🔓 Reader lock released');
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('⚠️ Direct AI request was cancelled');
        throw new Error('Direct AI request was cancelled');
      }
      console.error('❌ DirectAIAdapter error:', error);
      throw error;
    }
  }

  /**
   * 从 OpenAI/vLLM/Ollama 的响应中提取文本内容
   * @private
   */
  _extractContentFromPayload(payload) {
    if (!payload || typeof payload !== 'object') return '';

    // OpenAI/vLLM non-streaming
    if (payload.choices?.[0]?.message?.content) {
      return payload.choices[0].message.content;
    }

    // OpenAI/vLLM streaming delta
    if (payload.choices?.[0]?.delta?.content) {
      return payload.choices[0].delta.content;
    }

    // Ollama chat response
    if (payload.message?.content) {
      return payload.message.content;
    }

    // 某些实现可能使用 response/content 直出
    if (typeof payload.response === 'string') {
      return payload.response;
    }
    if (typeof payload.content === 'string') {
      return payload.content;
    }

    return '';
  }

  /**
   * 从 OpenAI/vLLM/Ollama 的响应中提取 token 统计
   * @private
   */
  _extractUsageFromPayload(payload) {
    if (!payload || typeof payload !== 'object') return null;

    // OpenAI/vLLM usage
    if (payload.usage && typeof payload.usage === 'object') {
      return payload.usage;
    }

    // Ollama usage 字段
    const promptTokens = payload.prompt_eval_count;
    const completionTokens = payload.eval_count;
    if (typeof promptTokens === 'number' || typeof completionTokens === 'number') {
      const p = typeof promptTokens === 'number' ? promptTokens : 0;
      const c = typeof completionTokens === 'number' ? completionTokens : 0;
      return {
        prompt_tokens: p,
        completion_tokens: c,
        total_tokens: p + c
      };
    }

    return null;
  }
}

/**
 * Dual Mode AI Adapter - switches between direct and LLM modes
 */
export class DualModeAIAdapter {
  constructor() {
    this.config = getAIConfig();
    this.mode = getAIMode();
    this.adapter = null;
    this.initAdapter();
    
    console.log('🤖 AI Adapter initialized', {
      mode: this.mode,
      isDev: import.meta.env.DEV,
      isProd: import.meta.env.PROD
    });
  }

  /**
   * Initialize the appropriate adapter based on mode
   * 
   * @private
   */
  initAdapter() {
    if (this.mode === AI_MODES.DIRECT) {
      console.log('📡 Using Direct AI Adapter (172.16.100.61:8000)');
      this.adapter = new DirectAIAdapter(this.config);
    } else {
      console.log('🔗 Using LLM AI Adapter (AnythingLLM)');
      this.adapter = new AIAdapter(this.config.workspace);
    }
  }

  /**
   * Stream chat with the current adapter
   * 
   * @param {Array<{role: string, content: string}>} messages - Chat messages
   * @param {Object} options - Additional options
   * @returns {AsyncGenerator} - Async generator of response chunks
   */
  async *streamChat(messages, options = {}) {
    try {
      yield* this.adapter.streamChat(messages, options);
    } catch (error) {
      console.error(`AI Adapter error (${this.mode} mode):`, error);
      throw error;
    }
  }

  /**
   * Get current mode
   * 
   * @returns {string} Current AI mode
   */
  getMode() {
    return this.mode;
  }

  /**
   * Get current configuration
   * 
   * @returns {Object} Current AI configuration
   */
  getConfig() {
    return this.config;
  }

  /**
   * Switch AI mode at runtime (for testing)
   * 
   * @param {string} newMode - New mode ('direct' or 'llm')
   * @throws {Error} If invalid mode
   */
  switchMode(newMode) {
    if (newMode !== AI_MODES.DIRECT && newMode !== AI_MODES.LLM) {
      throw new Error(`Invalid AI mode: ${newMode}`);
    }

    console.log(`🔄 Switching AI mode from ${this.mode} to ${newMode}`);
    this.mode = newMode;
    this.config = getAIConfig();
    this.initAdapter();
  }

  /**
   * Get adapter info for debugging
   * 
   * @returns {Object} Adapter information
   */
  getInfo() {
    return {
      mode: this.mode,
      isDevelopment: import.meta.env.DEV,
      isProduction: import.meta.env.PROD,
      config: {
        ...this.config,
        apiKey: this.config.apiKey ? '***' : null // Hide API key
      },
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Create a dual mode AI adapter instance
 * 
 * @returns {DualModeAIAdapter}
 */
export function createDualModeAIAdapter() {
  return new DualModeAIAdapter();
}

export default DualModeAIAdapter;

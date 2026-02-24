/**
 * Dual Mode AI Adapter
 * Supports both direct AI mode (172.16.100.61) and LLM mode
 * 
 * Direct mode: Direct connection to local AI model
 * LLM mode: Connection through AnythingLLM backend
 */

import { AIAdapter } from './aiAdapter.js';
import { getAIMode, getAIConfig, AI_MODES } from '../config/aiModeConfig.js';

/**
 * Direct AI Adapter - connects directly to 172.16.100.61:8000
 */
export class DirectAIAdapter {
  constructor(config) {
    this.url = config.url;
    this.model = config.model;
    this.temperature = config.temperature || 0;
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
   * Stream chat with direct AI model
   * 
   * @param {Array<{role: string, content: string}>} messages - Chat messages
   * @param {Object} options - Additional options
   * @returns {AsyncGenerator<string>} - Async generator of response chunks
   */
  async *streamChat(messages, options = {}) {
    try {
      console.log('\n' + '='.repeat(80));
      console.log('🤖 DirectAIAdapter: Starting request');
      console.log('='.repeat(80));
      console.log('📍 Target URL:', this.url);
      console.log('📍 Model:', this.model);
      console.log('📍 Temperature:', this.temperature);
      console.log('📝 Messages count:', messages.length);
      
      // Log system prompt info
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
      
      // Log user message info
      const userMessage = messages.find(m => m.role === 'user');
      if (userMessage) {
        console.log('\n✓ User message found:');
        console.log('  - Length:', userMessage.content.length, 'characters');
        console.log('  - First 300 chars:', userMessage.content.substring(0, 300));
      }
      
      const requestBody = {
        model: this.model,
        messages,
        stream: true,
        temperature: this.temperature,
        // max_tokens: 4000  // 移除限制，让 AI 自由输出
      };
      
      console.log('\n📤 Complete Request Body:');
      console.log('  - model:', requestBody.model);
      console.log('  - messagesCount:', requestBody.messages.length);
      console.log('  - stream:', requestBody.stream);
      console.log('  - temperature:', requestBody.temperature);
      console.log('  - max_tokens:', requestBody.max_tokens);
      console.log('\n📋 Full messages structure:');
      requestBody.messages.forEach((msg, idx) => {
        console.log(`  [${idx}] role: ${msg.role}, content length: ${msg.content.length}`);
      });
      
      // Use backend proxy to avoid CORS and Mixed Content issues
      const useProxy = window.location.protocol === 'https:' && this.url.startsWith('http://');
      const fullUrl = useProxy 
        ? '/api/direct-ai-proxy'
        : `${this.url}/v1/chat/completions`;
      
      console.log('\n🌐 Sending HTTP Request:');
      console.log('  - URL:', fullUrl);
      console.log('  - Using proxy:', useProxy);
      console.log('  - Method: POST');
      console.log('  - Headers:', { 'Content-Type': 'application/json' });
      console.log('  - Body size:', JSON.stringify(requestBody).length, 'bytes');
      
      const requestStartTime = Date.now();
      
      const requestPayload = useProxy ? {
        url: `${this.url}/v1/chat/completions`,
        body: requestBody
      } : requestBody;
      
      const response = await fetch(fullUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestPayload),
        signal: options.signal
      });

      const requestEndTime = Date.now();
      console.log('\n📥 Response received:');
      console.log('  - Status:', response.status, response.statusText);
      console.log('  - Time taken:', requestEndTime - requestStartTime, 'ms');
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

      console.log('\n📡 Starting to read stream...');

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            console.log('\n✅ Stream completed:');
            console.log('  - Total chunks:', chunkCount);
            console.log('  - Total content length:', totalContent.length);
            console.log('  - First 500 chars of response:', totalContent.substring(0, 500));
            console.log('  - Last 200 chars of response:', totalContent.substring(totalContent.length - 200));
            console.log('='.repeat(80) + '\n');
            
            // Yield final result
            yield {
              content: '',
              done: true,
              fullText: totalContent
            };
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim() || !line.startsWith('data: ')) continue;

            const data = line.slice(6);
            if (data === '[DONE]') {
              console.log('\n✓ Received [DONE] signal');
              // Yield final result before returning
              yield {
                content: '',
                done: true,
                fullText: totalContent
              };
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content || '';
              if (content) {
                chunkCount++;
                totalContent += content;
                
                if (!firstChunkReceived) {
                  console.log('\n🎯 First chunk received:');
                  console.log('  - Content:', JSON.stringify(content));
                  console.log('  - Parsed structure:', JSON.stringify(parsed, null, 2));
                  firstChunkReceived = true;
                }
                
                if (chunkCount % 50 === 0) {
                  console.log(`  📊 Progress: ${chunkCount} chunks, ${totalContent.length} chars`);
                }
                
                // Yield in the same format as AIAdapter
                yield {
                  content,
                  done: false,
                  fullText: totalContent
                };
              }
            } catch (e) {
              console.warn('⚠️ Failed to parse chunk:', e, 'Line:', line);
            }
          }
        }
      } finally {
        // 确保 reader 被释放
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

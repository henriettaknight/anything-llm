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
    this.temperature = config.temperature || 0.3;
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
      const response = await fetch(`${this.url}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: true,
          temperature: this.temperature,
          max_tokens: 4000
        }),
        signal: options.signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Direct AI API error: ${response.status} - ${errorText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;

          const data = line.slice(6);
          if (data === '[DONE]') return;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content || '';
            if (content) {
              yield content;
            }
          } catch (e) {
            // Ignore JSON parse errors
            console.debug('Failed to parse chunk:', e);
          }
        }
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Direct AI request was cancelled');
      }
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
   * @throws {Error} If trying to switch to direct mode in production
   */
  switchMode(newMode) {
    // Safety check: prevent switching to direct mode in production
    if (newMode === AI_MODES.DIRECT && import.meta.env.PROD) {
      throw new Error('Cannot switch to direct mode in production environment');
    }

    if (newMode === AI_MODES.DIRECT && !import.meta.env.DEV) {
      throw new Error('Direct mode is only available in development environment');
    }

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

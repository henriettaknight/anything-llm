/**
 * AI Adapter for Auto Detection System
 * 
 * This adapter interfaces with the AnythingLLM backend AI provider system
 * to perform code review analysis. It handles streaming responses,
 * provider selection, and error recovery.
 */

import { API_BASE } from "@/utils/constants";

/**
 * @typedef {Object} AIAdapterOptions
 * @property {string} [preferredProvider] - Preferred AI provider name
 * @property {string} [model] - Specific model to use
 * @property {number} [temperature] - Temperature for AI responses (0-1)
 * @property {AbortSignal} [signal] - Abort signal for cancellation
 */

/**
 * @typedef {Object} StreamChunkResult
 * @property {string} content - The content chunk from the AI
 * @property {boolean} done - Whether the stream is complete
 * @property {Object} [usage] - Token usage information
 */

/**
 * AI Adapter class for interfacing with AnythingLLM's AI providers
 */
export class AIAdapter {
  /**
   * @param {string} workspaceSlug - The workspace slug to use for AI requests
   * @param {AIAdapterOptions} options - Configuration options
   */
  constructor(workspaceSlug, options = {}) {
    this.workspaceSlug = workspaceSlug;
    this.preferredProvider = options.preferredProvider || null;
    this.model = options.model || null;
    this.temperature = options.temperature ?? 0.7;
    this.baseUrl = API_BASE || "";
  }

  /**
   * Stream chat with the AI provider
   * 
   * @param {Array<{role: string, content: string}>} messages - Chat messages
   * @param {Object} options - Additional options
   * @param {function(string): void} [options.onChunk] - Callback for each chunk
   * @param {AbortSignal} [options.signal] - Abort signal
   * @returns {AsyncGenerator<StreamChunkResult>} - Async generator of stream chunks
   */
  async *streamChat(messages, options = {}) {
    const { onChunk, signal } = options;

    try {
      const response = await this._makeStreamRequest(messages, signal);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AI Provider Error: ${response.status} - ${errorText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          yield {
            content: "",
            done: true,
            fullText,
          };
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim() || !line.startsWith("data: ")) continue;

          const data = line.slice(6); // Remove "data: " prefix
          
          if (data === "[DONE]") {
            yield {
              content: "",
              done: true,
              fullText,
            };
            return;
          }

          try {
            const parsed = JSON.parse(data);
            
            // Handle different response formats
            const content = this._extractContent(parsed);
            
            if (content) {
              fullText += content;
              
              if (onChunk) {
                onChunk(content);
              }

              yield {
                content,
                done: false,
                fullText,
              };
            }

            // Handle errors in the stream
            if (parsed.error) {
              throw new Error(parsed.error);
            }
          } catch (parseError) {
            console.warn("Failed to parse stream chunk:", parseError);
            // Continue processing other chunks
          }
        }
      }
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error("AI request was cancelled");
      }
      throw error;
    }
  }

  /**
   * Get a single chat completion (non-streaming)
   * 
   * @param {Array<{role: string, content: string}>} messages - Chat messages
   * @param {AbortSignal} [signal] - Abort signal
   * @returns {Promise<{textResponse: string, usage: Object}>}
   */
  async getChatCompletion(messages, signal = null) {
    let fullText = "";
    let usage = {};

    for await (const chunk of this.streamChat(messages, { signal })) {
      if (chunk.done) {
        fullText = chunk.fullText;
        usage = chunk.usage || {};
        break;
      }
    }

    return {
      textResponse: fullText,
      usage,
    };
  }

  /**
   * Make a streaming request to the backend
   * 
   * @private
   * @param {Array<{role: string, content: string}>} messages - Chat messages
   * @param {AbortSignal} [signal] - Abort signal
   * @returns {Promise<Response>}
   */
  async _makeStreamRequest(messages, signal = null) {
    const url = `${this.baseUrl}/api/workspace/${this.workspaceSlug}/stream-chat`;

    const payload = {
      message: messages[messages.length - 1]?.content || "",
      mode: "chat",
      attachments: [],
    };

    // Add system prompt if present
    const systemMessage = messages.find((m) => m.role === "system");
    if (systemMessage) {
      payload.systemPrompt = systemMessage.content;
    }

    // Add chat history (exclude system and last user message)
    const history = messages
      .filter((m) => m.role !== "system")
      .slice(0, -1)
      .map((m) => ({
        role: m.role,
        content: m.content,
      }));

    if (history.length > 0) {
      payload.history = history;
    }

    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(payload),
      signal,
    });
  }

  /**
   * Extract content from different response formats
   * 
   * @private
   * @param {Object} parsed - Parsed response chunk
   * @returns {string} - Extracted content
   */
  _extractContent(parsed) {
    // Handle AnythingLLM response format
    if (parsed.type === "textResponseChunk") {
      return parsed.textResponse || "";
    }

    // Handle OpenAI-style format
    if (parsed.choices && parsed.choices[0]?.delta?.content) {
      return parsed.choices[0].delta.content;
    }

    // Handle direct content
    if (typeof parsed.content === "string") {
      return parsed.content;
    }

    return "";
  }

  /**
   * Handle provider errors with fallback logic
   * 
   * @param {Error} error - The error that occurred
   * @param {string} currentProvider - The provider that failed
   * @returns {Promise<string|null>} - Alternative provider name or null
   */
  async handleProviderError(error, currentProvider) {
    console.error(`AI Provider ${currentProvider} failed:`, error);

    // Check if error is retryable
    if (this._isRetryableError(error)) {
      console.log("Error is retryable, will attempt retry");
      return currentProvider; // Retry with same provider
    }

    // For non-retryable errors, we can't automatically fallback
    // as provider selection is managed by the backend
    console.warn("Error is not retryable, no fallback available");
    return null;
  }

  /**
   * Check if an error is retryable
   * 
   * @private
   * @param {Error} error - The error to check
   * @returns {boolean}
   */
  _isRetryableError(error) {
    const retryableMessages = [
      "rate limit",
      "timeout",
      "network",
      "ECONNRESET",
      "ETIMEDOUT",
      "503",
      "502",
      "504",
    ];

    const errorMessage = error.message.toLowerCase();
    return retryableMessages.some((msg) => errorMessage.includes(msg));
  }

  /**
   * Format a code review prompt
   * 
   * @param {string} fileContent - The code file content to analyze
   * @param {string} fileName - The name of the file
   * @param {string} promptTemplate - The prompt template to use
   * @returns {Array<{role: string, content: string}>} - Formatted messages
   */
  formatDetectionPrompt(fileContent, fileName, promptTemplate) {
    // Replace placeholders in the template
    const systemPrompt = promptTemplate
      .replace(/\{fileName\}/g, fileName)
      .replace(/\{fileContent\}/g, fileContent);

    return [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: `请分析以下代码文件并生成缺陷报告：\n\n文件名：${fileName}\n\n代码内容：\n\`\`\`cpp\n${fileContent}\n\`\`\``,
      },
    ];
  }

  /**
   * Parse detection results from AI response
   * 
   * @param {string} response - The AI response text
   * @returns {Array<Object>} - Parsed defects
   */
  parseDetectionResults(response) {
    const defects = [];

    try {
      // Extract markdown table from response
      const tableMatch = response.match(/\|[\s\S]*?\|/g);
      
      if (!tableMatch || tableMatch.length < 2) {
        console.warn("No table found in AI response");
        return defects;
      }

      // Skip header and separator rows
      const rows = tableMatch.slice(2);

      for (const row of rows) {
        const cells = row
          .split("|")
          .map((cell) => cell.trim())
          .filter((cell) => cell);

        if (cells.length >= 10) {
          defects.push({
            no: cells[0],
            category: cells[1],
            file: cells[2],
            function: cells[3],
            snippet: cells[4],
            lines: cells[5],
            risk: cells[6],
            howToTrigger: cells[7],
            suggestedFix: cells[8],
            confidence: cells[9],
          });
        }
      }
    } catch (error) {
      console.error("Failed to parse detection results:", error);
      throw new Error(`Failed to parse AI response: ${error.message}`);
    }

    return defects;
  }

  /**
   * Validate detection results
   * 
   * @param {Array<Object>} defects - Parsed defects
   * @returns {boolean} - Whether results are valid
   */
  validateDetectionResults(defects) {
    if (!Array.isArray(defects)) {
      return false;
    }

    // Check if we have at least the required fields
    for (const defect of defects) {
      if (
        !defect.category ||
        !defect.file ||
        !defect.risk ||
        !defect.suggestedFix
      ) {
        return false;
      }
    }

    return true;
  }
}

/**
 * Create an AI adapter instance
 * 
 * @param {string} workspaceSlug - The workspace slug
 * @param {AIAdapterOptions} options - Configuration options
 * @returns {AIAdapter}
 */
export function createAIAdapter(workspaceSlug, options = {}) {
  return new AIAdapter(workspaceSlug, options);
}

export default AIAdapter;

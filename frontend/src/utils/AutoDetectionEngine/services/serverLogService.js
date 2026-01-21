/**
 * @fileoverview Server Log Service
 * Sends client logs to server console
 */

/**
 * Server Log Service
 * Manages logging operations and sends logs to server
 */
class ServerLogService {
  constructor() {
    this.enabled = true;
  }

  /**
   * Enable/disable server logging
   * @param {boolean} enabled - Whether to enable logging
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }

  /**
   * Send log to server
   * @param {string} level - Log level
   * @param {string} message - Log message
   * @param {*} [data] - Additional data
   * @returns {Promise<void>}
   */
  async sendLog(level, message, data) {
    if (!this.enabled) return;

    try {
      await fetch('/api/log', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ level, message, data }),
      });
    } catch (error) {
      // Silent failure, don't affect main flow
      console.error('发送日志到服务器失败:', error);
    }
  }

  /**
   * Info log
   * @param {string} message - Log message
   * @param {*} [data] - Additional data
   */
  info(message, data) {
    if (data !== undefined) {
      console.log(message, data);
    } else {
      console.log(message);
    }
    this.sendLog('info', message, data);
  }

  /**
   * Warning log
   * @param {string} message - Log message
   * @param {*} [data] - Additional data
   */
  warn(message, data) {
    if (data !== undefined) {
      console.warn(message, data);
    } else {
      console.warn(message);
    }
    this.sendLog('warn', message, data);
  }

  /**
   * Error log
   * @param {string} message - Log message
   * @param {*} [data] - Additional data
   */
  error(message, data) {
    if (data !== undefined) {
      console.error(message, data);
    } else {
      console.error(message);
    }
    this.sendLog('error', message, data);
  }

  /**
   * Debug log
   * @param {string} message - Log message
   * @param {*} [data] - Additional data
   */
  debug(message, data) {
    if (data !== undefined) {
      console.debug(message, data);
    } else {
      console.debug(message);
    }
    this.sendLog('debug', message, data);
  }
}

export const serverLog = new ServerLogService();

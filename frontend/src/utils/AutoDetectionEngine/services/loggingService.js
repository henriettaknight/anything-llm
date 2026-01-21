/**
 * @fileoverview Logging Service
 * Provides structured logging for all detection operations
 */

/**
 * Log levels
 * @enum {string}
 */
export const LogLevel = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
  CRITICAL: 'critical'
};

/**
 * Log categories
 * @enum {string}
 */
export const LogCategory = {
  DETECTION: 'detection',
  CONFIG: 'config',
  FILE_SYSTEM: 'file_system',
  AI_PROVIDER: 'ai_provider',
  REPORT: 'report',
  SESSION: 'session',
  BATCH: 'batch',
  RESOURCE: 'resource',
  SYSTEM: 'system'
};

/**
 * Logging Service Implementation
 */
class LoggingServiceImpl {
  constructor() {
    this.logs = [];
    this.maxLogs = 1000; // Keep last 1000 logs in memory
    this.logToConsole = true;
    this.logToStorage = true;
    this.minLevel = LogLevel.INFO;
    this.listeners = new Set();
    
    // Initialize from storage
    this.loadLogsFromStorage();
  }

  /**
   * Set minimum log level
   * @param {string} level - Minimum log level
   */
  setMinLevel(level) {
    this.minLevel = level;
  }

  /**
   * Enable/disable console logging
   * @param {boolean} enabled - Enable console logging
   */
  setConsoleLogging(enabled) {
    this.logToConsole = enabled;
  }

  /**
   * Enable/disable storage logging
   * @param {boolean} enabled - Enable storage logging
   */
  setStorageLogging(enabled) {
    this.logToStorage = enabled;
  }

  /**
   * Log a message
   * @param {string} level - Log level
   * @param {string} category - Log category
   * @param {string} message - Log message
   * @param {Object} [data] - Additional data
   * @param {Error} [error] - Error object
   */
  log(level, category, message, data = null, error = null) {
    // Check if level should be logged
    if (!this.shouldLog(level)) {
      return;
    }

    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      data,
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : null
    };

    // Add to memory
    this.logs.push(logEntry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // Log to console
    if (this.logToConsole) {
      this.logToConsoleOutput(logEntry);
    }

    // Save to storage
    if (this.logToStorage) {
      this.saveToStorage(logEntry);
    }

    // Notify listeners
    this.notifyListeners(logEntry);
  }

  /**
   * Check if level should be logged
   * @param {string} level - Log level
   * @returns {boolean} Should log
   */
  shouldLog(level) {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR, LogLevel.CRITICAL];
    const minIndex = levels.indexOf(this.minLevel);
    const levelIndex = levels.indexOf(level);
    return levelIndex >= minIndex;
  }

  /**
   * Log to console with appropriate method
   * @param {Object} logEntry - Log entry
   */
  logToConsoleOutput(logEntry) {
    const prefix = `[${logEntry.timestamp}] [${logEntry.category}]`;
    const message = `${prefix} ${logEntry.message}`;

    switch (logEntry.level) {
      case LogLevel.DEBUG:
        console.debug(message, logEntry.data);
        break;
      case LogLevel.INFO:
        console.info(message, logEntry.data);
        break;
      case LogLevel.WARN:
        console.warn(message, logEntry.data);
        break;
      case LogLevel.ERROR:
      case LogLevel.CRITICAL:
        console.error(message, logEntry.data, logEntry.error);
        break;
      default:
        console.log(message, logEntry.data);
    }
  }

  /**
   * Save log to storage
   * @param {Object} logEntry - Log entry
   */
  saveToStorage(logEntry) {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const storageKey = 'autoDetection_logs';
      const stored = localStorage.getItem(storageKey);
      let logs = stored ? JSON.parse(stored) : [];

      logs.push(logEntry);

      // Keep only last 500 logs in storage
      if (logs.length > 500) {
        logs = logs.slice(-500);
      }

      localStorage.setItem(storageKey, JSON.stringify(logs));
    } catch (error) {
      // Silently fail if storage is full
      console.error('Failed to save log to storage:', error);
    }
  }

  /**
   * Load logs from storage
   */
  loadLogsFromStorage() {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const storageKey = 'autoDetection_logs';
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        this.logs = JSON.parse(stored);
      }
    } catch (error) {
      console.error('Failed to load logs from storage:', error);
      this.logs = [];
    }
  }

  /**
   * Debug log
   * @param {string} category - Log category
   * @param {string} message - Log message
   * @param {Object} [data] - Additional data
   */
  debug(category, message, data = null) {
    this.log(LogLevel.DEBUG, category, message, data);
  }

  /**
   * Info log
   * @param {string} category - Log category
   * @param {string} message - Log message
   * @param {Object} [data] - Additional data
   */
  info(category, message, data = null) {
    this.log(LogLevel.INFO, category, message, data);
  }

  /**
   * Warning log
   * @param {string} category - Log category
   * @param {string} message - Log message
   * @param {Object} [data] - Additional data
   */
  warn(category, message, data = null) {
    this.log(LogLevel.WARN, category, message, data);
  }

  /**
   * Error log
   * @param {string} category - Log category
   * @param {string} message - Log message
   * @param {Error} [error] - Error object
   * @param {Object} [data] - Additional data
   */
  error(category, message, error = null, data = null) {
    this.log(LogLevel.ERROR, category, message, data, error);
  }

  /**
   * Critical log
   * @param {string} category - Log category
   * @param {string} message - Log message
   * @param {Error} [error] - Error object
   * @param {Object} [data] - Additional data
   */
  critical(category, message, error = null, data = null) {
    this.log(LogLevel.CRITICAL, category, message, data, error);
  }

  /**
   * Get all logs
   * @returns {Array} All logs
   */
  getLogs() {
    return [...this.logs];
  }

  /**
   * Get logs by level
   * @param {string} level - Log level
   * @returns {Array} Filtered logs
   */
  getLogsByLevel(level) {
    return this.logs.filter(log => log.level === level);
  }

  /**
   * Get logs by category
   * @param {string} category - Log category
   * @returns {Array} Filtered logs
   */
  getLogsByCategory(category) {
    return this.logs.filter(log => log.category === category);
  }

  /**
   * Get logs by time range
   * @param {Date} startTime - Start time
   * @param {Date} endTime - End time
   * @returns {Array} Filtered logs
   */
  getLogsByTimeRange(startTime, endTime) {
    return this.logs.filter(log => {
      const logTime = new Date(log.timestamp);
      return logTime >= startTime && logTime <= endTime;
    });
  }

  /**
   * Clear all logs
   */
  clearLogs() {
    this.logs = [];
    if (typeof window !== 'undefined') {
      localStorage.removeItem('autoDetection_logs');
    }
  }

  /**
   * Export logs as JSON
   * @returns {string} JSON string
   */
  exportLogs() {
    return JSON.stringify(this.logs, null, 2);
  }

  /**
   * Subscribe to log events
   * @param {Function} listener - Listener function
   * @returns {Function} Unsubscribe function
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify listeners
   * @param {Object} logEntry - Log entry
   */
  notifyListeners(logEntry) {
    this.listeners.forEach(listener => {
      try {
        listener(logEntry);
      } catch (error) {
        console.error('Error in log listener:', error);
      }
    });
  }

  /**
   * Get log statistics
   * @returns {Object} Log statistics
   */
  getStats() {
    const stats = {
      total: this.logs.length,
      byLevel: {},
      byCategory: {},
      errors: 0,
      warnings: 0
    };

    this.logs.forEach(log => {
      // Count by level
      if (!stats.byLevel[log.level]) {
        stats.byLevel[log.level] = 0;
      }
      stats.byLevel[log.level]++;

      // Count by category
      if (!stats.byCategory[log.category]) {
        stats.byCategory[log.category] = 0;
      }
      stats.byCategory[log.category]++;

      // Count errors and warnings
      if (log.level === LogLevel.ERROR || log.level === LogLevel.CRITICAL) {
        stats.errors++;
      } else if (log.level === LogLevel.WARN) {
        stats.warnings++;
      }
    });

    return stats;
  }
}

// Export singleton instance
export const loggingService = new LoggingServiceImpl();

// Export default
export default loggingService;

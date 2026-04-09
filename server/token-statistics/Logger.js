/**
 * Logger
 * Centralized logging system with multiple log levels
 */

const fs = require('fs').promises;
const path = require('path');

/**
 * Log levels
 */
const LogLevel = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
};

/**
 * Log level priorities (for filtering)
 */
const LogLevelPriority = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  /**
   * Create a logger instance
   * @param {Object} options - Logger configuration
   */
  constructor(options = {}) {
    this.minLevel = options.minLevel || LogLevel.INFO;
    this.enableConsole = options.enableConsole !== false;
    this.enableFile = options.enableFile || false;
    this.logFilePath = options.logFilePath || null;
    this.context = options.context || 'TokenStatistics';
  }

  /**
   * Log a debug message
   * @param {string} message - Log message
   * @param {Object} metadata - Additional metadata
   */
  debug(message, metadata = {}) {
    this._log(LogLevel.DEBUG, message, metadata);
  }

  /**
   * Log an info message
   * @param {string} message - Log message
   * @param {Object} metadata - Additional metadata
   */
  info(message, metadata = {}) {
    this._log(LogLevel.INFO, message, metadata);
  }

  /**
   * Log a warning message
   * @param {string} message - Log message
   * @param {Object} metadata - Additional metadata
   */
  warn(message, metadata = {}) {
    this._log(LogLevel.WARN, message, metadata);
  }

  /**
   * Log an error message
   * @param {string} message - Log message
   * @param {Error|Object} errorOrMetadata - Error object or metadata
   */
  error(message, errorOrMetadata = {}) {
    const metadata = errorOrMetadata instanceof Error
      ? { error: this._serializeError(errorOrMetadata) }
      : errorOrMetadata;
    
    this._log(LogLevel.ERROR, message, metadata);
  }

  /**
   * Create a child logger with additional context
   * @param {string} childContext - Additional context identifier
   * @returns {Logger} Child logger instance
   */
  child(childContext) {
    return new Logger({
      minLevel: this.minLevel,
      enableConsole: this.enableConsole,
      enableFile: this.enableFile,
      logFilePath: this.logFilePath,
      context: `${this.context}:${childContext}`,
    });
  }

  /**
   * Internal logging method
   * @private
   */
  _log(level, message, metadata = {}) {
    // Check if this log level should be output
    if (LogLevelPriority[level] < LogLevelPriority[this.minLevel]) {
      return;
    }

    const logEntry = {
      level,
      timestamp: new Date().toISOString(),
      context: this.context,
      message,
      ...metadata,
    };

    // Console output
    if (this.enableConsole) {
      this._logToConsole(logEntry);
    }

    // File output
    if (this.enableFile && this.logFilePath) {
      this._logToFile(logEntry).catch(err => {
        console.error('Failed to write log to file:', err.message);
      });
    }
  }

  /**
   * Log to console with appropriate formatting
   * @private
   */
  _logToConsole(logEntry) {
    const { level, timestamp, context, message, ...rest } = logEntry;
    const prefix = `[${timestamp}] [${level.toUpperCase()}] [${context}]`;
    
    const hasMetadata = Object.keys(rest).length > 0;
    const metadataStr = hasMetadata ? `\n${JSON.stringify(rest, null, 2)}` : '';

    switch (level) {
      case LogLevel.DEBUG:
        console.debug(`${prefix} ${message}${metadataStr}`);
        break;
      case LogLevel.INFO:
        console.info(`${prefix} ${message}${metadataStr}`);
        break;
      case LogLevel.WARN:
        console.warn(`${prefix} ${message}${metadataStr}`);
        break;
      case LogLevel.ERROR:
        console.error(`${prefix} ${message}${metadataStr}`);
        break;
    }
  }

  /**
   * Log to file
   * @private
   */
  async _logToFile(logEntry) {
    try {
      const logLine = JSON.stringify(logEntry) + '\n';
      
      // Ensure log directory exists
      const logDir = path.dirname(this.logFilePath);
      await fs.mkdir(logDir, { recursive: true });
      
      // Append to log file
      await fs.appendFile(this.logFilePath, logLine, 'utf-8');
    } catch (error) {
      // Don't throw - logging should not break the application
      console.error('Failed to write to log file:', error.message);
    }
  }

  /**
   * Serialize error object for logging
   * @private
   */
  _serializeError(error) {
    return {
      name: error.name,
      message: error.message,
      code: error.code,
      stack: error.stack,
      details: error.details,
      originalError: error.originalError ? this._serializeError(error.originalError) : undefined,
    };
  }

  /**
   * Set minimum log level
   * @param {string} level - Log level
   */
  setMinLevel(level) {
    if (!LogLevelPriority.hasOwnProperty(level)) {
      throw new Error(`Invalid log level: ${level}`);
    }
    this.minLevel = level;
  }

  /**
   * Enable or disable console logging
   * @param {boolean} enabled
   */
  setConsoleEnabled(enabled) {
    this.enableConsole = enabled;
  }

  /**
   * Enable or disable file logging
   * @param {boolean} enabled
   * @param {string} logFilePath - Path to log file (required if enabling)
   */
  setFileEnabled(enabled, logFilePath = null) {
    this.enableFile = enabled;
    if (enabled && logFilePath) {
      this.logFilePath = logFilePath;
    }
  }
}

/**
 * Create a default logger instance
 */
function createLogger(context = 'TokenStatistics', options = {}) {
  return new Logger({
    context,
    minLevel: process.env.LOG_LEVEL || LogLevel.INFO,
    enableConsole: true,
    enableFile: process.env.LOG_FILE_PATH ? true : false,
    logFilePath: process.env.LOG_FILE_PATH,
    ...options,
  });
}

module.exports = {
  Logger,
  LogLevel,
  createLogger,
};

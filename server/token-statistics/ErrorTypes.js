/**
 * ErrorTypes
 * Unified error type definitions for the token statistics system
 */

/**
 * Error codes enumeration
 */
const ErrorCode = {
  // Session errors
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  SESSION_CREATION_FAILED: 'SESSION_CREATION_FAILED',
  
  // Module errors
  MODULE_NOT_FOUND: 'MODULE_NOT_FOUND',
  MODULE_CREATION_FAILED: 'MODULE_CREATION_FAILED',
  
  // File errors
  FILE_READ_ERROR: 'FILE_READ_ERROR',
  FILE_WRITE_ERROR: 'FILE_WRITE_ERROR',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_ANALYSIS_ERROR: 'FILE_ANALYSIS_ERROR',
  
  // Security errors
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  INVALID_PATH: 'INVALID_PATH',
  PATH_TRAVERSAL_ATTEMPT: 'PATH_TRAVERSAL_ATTEMPT',
  UNAUTHORIZED_ACCESS: 'UNAUTHORIZED_ACCESS',
  
  // Storage errors
  STORAGE_FULL: 'STORAGE_FULL',
  STORAGE_ERROR: 'STORAGE_ERROR',
  CLEANUP_ERROR: 'CLEANUP_ERROR',
  
  // Configuration errors
  INVALID_LANGUAGE: 'INVALID_LANGUAGE',
  PRICING_CONFIG_ERROR: 'PRICING_CONFIG_ERROR',
  CONFIG_LOAD_ERROR: 'CONFIG_LOAD_ERROR',
  CONFIG_SAVE_ERROR: 'CONFIG_SAVE_ERROR',
  
  // Report generation errors
  ZIP_GENERATION_ERROR: 'ZIP_GENERATION_ERROR',
  REPORT_GENERATION_ERROR: 'REPORT_GENERATION_ERROR',
  CSV_GENERATION_ERROR: 'CSV_GENERATION_ERROR',
  
  // General errors
  INVALID_INPUT: 'INVALID_INPUT',
  OPERATION_TIMEOUT: 'OPERATION_TIMEOUT',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
};

/**
 * Base application error class
 */
class AppError extends Error {
  /**
   * Create an application error
   * @param {string} code - Error code from ErrorCode enum
   * @param {string} message - Human-readable error message
   * @param {*} details - Additional error details
   * @param {Error} originalError - Original error if wrapping another error
   */
  constructor(code, message, details = null, originalError = null) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
    this.originalError = originalError;
    this.timestamp = new Date();
    
    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert error to JSON format
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp.toISOString(),
      stack: this.stack,
    };
  }

  /**
   * Check if error is retryable
   */
  isRetryable() {
    const retryableCodes = [
      ErrorCode.FILE_WRITE_ERROR,
      ErrorCode.STORAGE_ERROR,
      ErrorCode.OPERATION_TIMEOUT,
    ];
    return retryableCodes.includes(this.code);
  }
}

/**
 * Session-related errors
 */
class SessionError extends AppError {
  constructor(code, message, details = null, originalError = null) {
    super(code, message, details, originalError);
    this.name = 'SessionError';
  }
}

/**
 * File operation errors
 */
class FileError extends AppError {
  constructor(code, message, details = null, originalError = null) {
    super(code, message, details, originalError);
    this.name = 'FileError';
  }
}

/**
 * Security-related errors
 */
class SecurityError extends AppError {
  constructor(code, message, details = null, originalError = null) {
    super(code, message, details, originalError);
    this.name = 'SecurityError';
  }
}

/**
 * Storage-related errors
 */
class StorageError extends AppError {
  constructor(code, message, details = null, originalError = null) {
    super(code, message, details, originalError);
    this.name = 'StorageError';
  }
}

/**
 * Configuration errors
 */
class ConfigError extends AppError {
  constructor(code, message, details = null, originalError = null) {
    super(code, message, details, originalError);
    this.name = 'ConfigError';
  }
}

/**
 * Report generation errors
 */
class ReportError extends AppError {
  constructor(code, message, details = null, originalError = null) {
    super(code, message, details, originalError);
    this.name = 'ReportError';
  }
}

module.exports = {
  ErrorCode,
  AppError,
  SessionError,
  FileError,
  SecurityError,
  StorageError,
  ConfigError,
  ReportError,
};

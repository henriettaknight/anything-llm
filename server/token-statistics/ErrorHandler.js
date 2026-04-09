/**
 * ErrorHandler
 * Centralized error handling utilities with retry logic and recovery strategies
 */

const fs = require('fs').promises;
const { ErrorCode, FileError, StorageError } = require('./ErrorTypes');
const { createLogger } = require('./Logger');

const logger = createLogger('ErrorHandler');

class ErrorHandler {
  /**
   * Retry an operation with exponential backoff
   * @param {Function} operation - Async operation to retry
   * @param {Object} options - Retry options
   * @returns {Promise<*>} Operation result
   */
  static async retryOperation(operation, options = {}) {
    const {
      maxRetries = 3,
      initialDelay = 100,
      maxDelay = 5000,
      backoffMultiplier = 2,
      operationName = 'operation',
      onRetry = null,
    } = options;

    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.debug(`Attempting ${operationName}`, { attempt, maxRetries });
        const result = await operation();
        
        if (attempt > 1) {
          logger.info(`${operationName} succeeded after ${attempt} attempts`);
        }
        
        return result;
      } catch (error) {
        lastError = error;
        
        logger.warn(`Attempt ${attempt}/${maxRetries} failed for ${operationName}`, {
          error: error.message,
          code: error.code,
        });
        
        if (attempt < maxRetries) {
          // Calculate delay with exponential backoff
          const delay = Math.min(
            initialDelay * Math.pow(backoffMultiplier, attempt - 1),
            maxDelay
          );
          
          logger.debug(`Retrying ${operationName} in ${delay}ms`);
          
          // Call retry callback if provided
          if (onRetry) {
            await onRetry(attempt, error);
          }
          
          await this._sleep(delay);
        }
      }
    }
    
    // All retries failed
    logger.error(`All ${maxRetries} attempts failed for ${operationName}`, lastError);
    throw lastError;
  }

  /**
   * Handle file read errors with skip logic
   * @param {Function} readOperation - File read operation
   * @param {string} filePath - Path to file being read
   * @param {*} defaultValue - Default value to return on error
   * @returns {Promise<*>} File content or default value
   */
  static async handleFileRead(readOperation, filePath, defaultValue = null) {
    try {
      return await readOperation();
    } catch (error) {
      logger.warn(`File read error, skipping file: ${filePath}`, {
        error: error.message,
        code: error.code,
      });
      
      // Return default value instead of throwing
      return defaultValue;
    }
  }

  /**
   * Handle file write errors with retry logic
   * @param {Function} writeOperation - File write operation
   * @param {string} filePath - Path to file being written
   * @returns {Promise<void>}
   */
  static async handleFileWrite(writeOperation, filePath) {
    try {
      await this.retryOperation(writeOperation, {
        maxRetries: 3,
        operationName: `writing file ${filePath}`,
      });
    } catch (error) {
      logger.error(`File write failed after retries: ${filePath}`, error);
      throw new FileError(
        ErrorCode.FILE_WRITE_ERROR,
        `Failed to write file: ${filePath}`,
        { filePath },
        error
      );
    }
  }

  /**
   * Check storage space and perform emergency cleanup if needed
   * @param {string} storagePath - Path to storage directory
   * @param {number} requiredSpace - Required space in bytes
   * @param {Function} cleanupCallback - Cleanup function to call if space is low
   * @returns {Promise<boolean>} True if sufficient space available
   */
  static async checkStorageSpace(storagePath, requiredSpace, cleanupCallback = null) {
    try {
      // Get available disk space (platform-specific)
      const stats = await fs.statfs ? fs.statfs(storagePath) : null;
      
      if (!stats) {
        // If statfs not available, assume space is available
        logger.warn('Unable to check disk space, proceeding anyway');
        return true;
      }
      
      const availableSpace = stats.bavail * stats.bsize;
      
      logger.debug('Storage space check', {
        availableSpace,
        requiredSpace,
        path: storagePath,
      });
      
      if (availableSpace < requiredSpace) {
        logger.warn('Low storage space detected', {
          availableSpace,
          requiredSpace,
          deficit: requiredSpace - availableSpace,
        });
        
        // Attempt emergency cleanup if callback provided
        if (cleanupCallback) {
          logger.info('Attempting emergency cleanup');
          try {
            await cleanupCallback();
            
            // Check space again after cleanup
            const newStats = await fs.statfs(storagePath);
            const newAvailableSpace = newStats.bavail * newStats.bsize;
            
            if (newAvailableSpace >= requiredSpace) {
              logger.info('Emergency cleanup successful', {
                freedSpace: newAvailableSpace - availableSpace,
              });
              return true;
            }
          } catch (cleanupError) {
            logger.error('Emergency cleanup failed', cleanupError);
          }
        }
        
        throw new StorageError(
          ErrorCode.STORAGE_FULL,
          'Insufficient storage space',
          { availableSpace, requiredSpace }
        );
      }
      
      return true;
    } catch (error) {
      if (error instanceof StorageError) {
        throw error;
      }
      
      // If we can't check space, log warning but don't fail
      logger.warn('Error checking storage space', error);
      return true;
    }
  }

  /**
   * Wrap an operation with comprehensive error handling
   * @param {Function} operation - Operation to execute
   * @param {Object} options - Error handling options
   * @returns {Promise<*>} Operation result
   */
  static async wrapOperation(operation, options = {}) {
    const {
      operationName = 'operation',
      retry = false,
      retryOptions = {},
      onError = null,
      defaultValue = null,
      rethrow = true,
    } = options;

    try {
      if (retry) {
        return await this.retryOperation(operation, {
          operationName,
          ...retryOptions,
        });
      } else {
        return await operation();
      }
    } catch (error) {
      logger.error(`Error in ${operationName}`, error);
      
      // Call error callback if provided
      if (onError) {
        await onError(error);
      }
      
      // Return default value or rethrow
      if (rethrow) {
        throw error;
      } else {
        return defaultValue;
      }
    }
  }

  /**
   * Handle multiple operations with partial failure tolerance
   * @param {Array<Function>} operations - Array of async operations
   * @param {Object} options - Options
   * @returns {Promise<Object>} Results and errors
   */
  static async handleBatch(operations, options = {}) {
    const {
      continueOnError = true,
      operationName = 'batch operation',
    } = options;

    const results = [];
    const errors = [];

    for (let i = 0; i < operations.length; i++) {
      try {
        const result = await operations[i]();
        results.push({ index: i, success: true, result });
      } catch (error) {
        logger.warn(`Operation ${i} failed in ${operationName}`, {
          error: error.message,
        });
        
        errors.push({ index: i, error });
        
        if (!continueOnError) {
          throw error;
        }
      }
    }

    if (errors.length > 0) {
      logger.warn(`${operationName} completed with ${errors.length} errors`, {
        totalOperations: operations.length,
        successCount: results.length,
        errorCount: errors.length,
      });
    }

    return {
      results,
      errors,
      successCount: results.length,
      errorCount: errors.length,
      totalCount: operations.length,
    };
  }

  /**
   * Sleep for specified milliseconds
   * @private
   */
  static _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = ErrorHandler;

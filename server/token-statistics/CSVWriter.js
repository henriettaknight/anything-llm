/**
 * CSVWriter
 * Writes statistical data to CSV files
 */

const fs = require('fs').promises;
const path = require('path');
const TempFileManager = require('./TempFileManager');
const { FileError, ErrorCode } = require('./ErrorTypes');
const { createLogger } = require('./Logger');
const ErrorHandler = require('./ErrorHandler');

class CSVWriter {
  constructor() {
    this.tempFileManager = new TempFileManager();
    this.logger = createLogger('CSVWriter');
  }

  /**
   * Write statistics records to CSV
   * @param {string} sessionId - Session ID
   * @param {Array} records - Array of statistics records
   */
  async writeStatistics(sessionId, records) {
    const sessionDir = this.tempFileManager.getSessionDir(sessionId);
    const csvPath = path.join(sessionDir, 'token_statistics.csv');

    this.logger.debug('Writing statistics CSV', { sessionId, recordCount: records.length });

    const writeOperation = async () => {
      // Check if file exists to determine if we need headers
      let fileExists = false;
      try {
        await fs.access(csvPath);
        fileExists = true;
      } catch (error) {
        // File doesn't exist
      }

      const headers = [
        'record_type',
        'record_id',
        'date',
        'period_type',
        'module_id',
        'module_name',
        'file_count',
        'total_lines',
        'code_lines',
        'comment_lines',
        'input_tokens',
        'output_tokens',
        'total_tokens',
        'avg_tokens_per_line',
        'deepseek_cost_usd',
        'claude_cost_usd',
        'cost_difference',
        'status',
      ];

      let csvContent = '';

      // Add headers if file doesn't exist
      if (!fileExists) {
        csvContent += headers.join(',') + '\n';
      }

      // Add records
      for (const record of records) {
        const row = headers.map(header => {
          // Try both snake_case (from header) and camelCase (from record)
          const snakeKey = this._camelToSnake(header);
          const camelKey = this._snakeToCamel(header);
          const value = record[snakeKey] ?? record[camelKey] ?? record[header];
          
          // Escape values that contain commas or quotes
          if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value ?? '';
        });
        csvContent += row.join(',') + '\n';
      }

      // Append to file with UTF-8 encoding (Requirement 11.4)
      await fs.appendFile(csvPath, csvContent, 'utf-8');
    };

    // Use ErrorHandler for retry logic with 3 attempts
    try {
      await ErrorHandler.retryOperation(writeOperation, {
        maxRetries: 3,
        operationName: `writing statistics CSV for session ${sessionId}`,
      });
      
      this.logger.debug('Statistics CSV written successfully', { sessionId, csvPath });
    } catch (error) {
      this.logger.error('Failed to write statistics CSV after retries', { error, sessionId });
      throw new FileError(
        ErrorCode.FILE_WRITE_ERROR,
        `Failed to write statistics CSV for session ${sessionId}`,
        { sessionId, csvPath },
        error
      );
    }
  }

  /**
   * Write file details to CSV
   * @param {string} sessionId - Session ID
   * @param {string} moduleId - Module ID
   * @param {Array} files - Array of file records
   */
  async writeFileDetails(sessionId, moduleId, files) {
    const sessionDir = this.tempFileManager.getSessionDir(sessionId);
    const detailsDir = path.join(sessionDir, 'details');
    await fs.mkdir(detailsDir, { recursive: true });

    const csvPath = path.join(detailsDir, `token_files_${moduleId}.csv`);

    this.logger.debug('Writing file details CSV', { sessionId, moduleId, fileCount: files.length });

    const writeOperation = async () => {
      // Check if file exists to determine if we need headers
      let fileExists = false;
      try {
        await fs.access(csvPath);
        fileExists = true;
      } catch (error) {
        // File doesn't exist
      }

      const headers = [
        'file_id',
        'module_id',
        'file_path',
        'file_name',
        'file_type',
        'operation_type',
        'total_lines',
        'code_lines',
        'comment_lines',
        'input_tokens',
        'output_tokens',
        'total_tokens',
        'tokens_per_line',
        'deepseek_cost_usd',
        'claude_cost_usd',
        'cost_per_line_usd',
      ];

      let csvContent = '';

      // Add headers if file doesn't exist
      if (!fileExists) {
        csvContent += headers.join(',') + '\n';
      }

      // Add file records
      for (const file of files) {
        const row = headers.map(header => {
          // Try both snake_case (from header) and camelCase (from record)
          const snakeKey = this._camelToSnake(header);
          const camelKey = this._snakeToCamel(header);
          const value = file[snakeKey] ?? file[camelKey] ?? file[header];
          
          // Escape values that contain commas or quotes
          if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value ?? '';
        });
        csvContent += row.join(',') + '\n';
      }

      // Append to file with UTF-8 encoding (Requirement 11.4)
      await fs.appendFile(csvPath, csvContent, 'utf-8');
    };

    // Use ErrorHandler for retry logic with 3 attempts
    try {
      await ErrorHandler.retryOperation(writeOperation, {
        maxRetries: 3,
        operationName: `writing file details CSV for module ${moduleId}`,
      });
      
      this.logger.debug('File details CSV written successfully', { sessionId, moduleId, csvPath });
    } catch (error) {
      this.logger.error('Failed to write file details CSV after retries', { error, sessionId, moduleId });
      throw new FileError(
        ErrorCode.FILE_WRITE_ERROR,
        `Failed to write file details CSV for module ${moduleId}`,
        { sessionId, moduleId, csvPath },
        error
      );
    }
  }

  /**
   * Append summary record to statistics CSV
   * @param {string} sessionId - Session ID
   * @param {Object} summary - Summary record
   */
  async appendSummary(sessionId, summary) {
    await this.writeStatistics(sessionId, [summary]);
  }

  /**
   * Convert camelCase to snake_case
   * @private
   */
  _camelToSnake(str) {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }

  /**
   * Convert snake_case to camelCase
   * @private
   */
  _snakeToCamel(str) {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  }
}

module.exports = CSVWriter;

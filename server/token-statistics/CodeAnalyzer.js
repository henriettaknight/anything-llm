/**
 * CodeAnalyzer
 * Analyzes file content and counts code lines, comment lines, and blank lines
 */

const fs = require('fs').promises;
const path = require('path');
const { FileError, ErrorCode } = require('./ErrorTypes');
const { createLogger } = require('./Logger');

class CodeAnalyzer {
  constructor() {
    this.logger = createLogger('CodeAnalyzer');
    this.languageConfigs = {
      javascript: {
        extensions: ['.js', '.jsx', '.mjs', '.cjs'],
        singleLineComment: ['//'],
        multiLineCommentStart: ['/*'],
        multiLineCommentEnd: ['*/'],
      },
      typescript: {
        extensions: ['.ts', '.tsx'],
        singleLineComment: ['//'],
        multiLineCommentStart: ['/*'],
        multiLineCommentEnd: ['*/'],
      },
      python: {
        extensions: ['.py'],
        singleLineComment: ['#'],
        multiLineCommentStart: ['"""', "'''"],
        multiLineCommentEnd: ['"""', "'''"],
      },
      java: {
        extensions: ['.java'],
        singleLineComment: ['//'],
        multiLineCommentStart: ['/*'],
        multiLineCommentEnd: ['*/'],
      },
      cpp: {
        extensions: ['.cpp', '.cc', '.cxx', '.c', '.h', '.hpp'],
        singleLineComment: ['//'],
        multiLineCommentStart: ['/*'],
        multiLineCommentEnd: ['*/'],
      },
      html: {
        extensions: ['.html', '.htm'],
        singleLineComment: [],
        multiLineCommentStart: ['<!--'],
        multiLineCommentEnd: ['-->'],
      },
      css: {
        extensions: ['.css', '.scss', '.sass', '.less'],
        singleLineComment: [],
        multiLineCommentStart: ['/*'],
        multiLineCommentEnd: ['*/'],
      },
      ruby: {
        extensions: ['.rb'],
        singleLineComment: ['#'],
        multiLineCommentStart: ['=begin'],
        multiLineCommentEnd: ['=end'],
      },
      go: {
        extensions: ['.go'],
        singleLineComment: ['//'],
        multiLineCommentStart: ['/*'],
        multiLineCommentEnd: ['*/'],
      },
      rust: {
        extensions: ['.rs'],
        singleLineComment: ['//'],
        multiLineCommentStart: ['/*'],
        multiLineCommentEnd: ['*/'],
      },
    };
  }

  /**
   * Analyze a file and return line statistics
   * @param {string} filePath - Path to the file
   * @param {number} totalTokens - Optional total tokens for calculating average per line
   * @returns {Promise<Object>} Line statistics
   */
  async analyzeFile(filePath, totalTokens = null) {
    try {
      this.logger.debug('Analyzing file', { filePath });
      
      const content = await fs.readFile(filePath, 'utf-8');
      const language = this.detectLanguage(filePath);
      const lineStats = this.countLines(content, language);
      
      // Calculate average tokens per line if totalTokens is provided
      if (totalTokens !== null && lineStats.totalLines > 0) {
        lineStats.avgTokensPerLine = this.calculateAvgTokensPerLine(
          totalTokens,
          lineStats.totalLines
        );
      }
      
      this.logger.debug('File analysis complete', {
        filePath,
        language,
        totalLines: lineStats.totalLines,
        codeLines: lineStats.codeLines,
      });
      
      return lineStats;
    } catch (error) {
      this.logger.error('Error analyzing file', { error, filePath });
      throw new FileError(
        ErrorCode.FILE_ANALYSIS_ERROR,
        `Failed to analyze file: ${filePath}`,
        { filePath },
        error
      );
    }
  }

  /**
   * Detect programming language from file extension
   * @param {string} filePath - Path to the file
   * @returns {string} Language name
   */
  detectLanguage(filePath) {
    const ext = path.extname(filePath).toLowerCase();

    for (const [language, config] of Object.entries(this.languageConfigs)) {
      if (config.extensions.includes(ext)) {
        return language;
      }
    }

    return 'unknown';
  }

  /**
   * Count lines in file content
   * @param {string} content - File content
   * @param {string} language - Programming language
   * @returns {Object} Line statistics
   */
  countLines(content, language) {
    const lines = content.split('\n');
    const config = this.languageConfigs[language] || {
      singleLineComment: [],
      multiLineCommentStart: [],
      multiLineCommentEnd: [],
    };

    let codeLines = 0;
    let commentLines = 0;
    let blankLines = 0;
    let inMultiLineComment = false;
    let multiLineCommentEnd = null;

    for (let line of lines) {
      const trimmedLine = line.trim();

      // Check for blank line
      if (trimmedLine.length === 0) {
        blankLines++;
        continue;
      }

      // Check if we're in a multi-line comment
      if (inMultiLineComment) {
        commentLines++;
        // Check if this line ends the multi-line comment
        if (multiLineCommentEnd && trimmedLine.includes(multiLineCommentEnd)) {
          inMultiLineComment = false;
          multiLineCommentEnd = null;
        }
        continue;
      }

      // Check for multi-line comment start
      let isMultiLineStart = false;
      for (const start of config.multiLineCommentStart) {
        if (trimmedLine.includes(start)) {
          isMultiLineStart = true;
          // Find corresponding end marker
          const startIndex = config.multiLineCommentStart.indexOf(start);
          multiLineCommentEnd = config.multiLineCommentEnd[startIndex];

          // Check if it ends on the same line
          if (!trimmedLine.includes(multiLineCommentEnd)) {
            inMultiLineComment = true;
          }
          commentLines++;
          break;
        }
      }

      if (isMultiLineStart) {
        continue;
      }

      // Check for single-line comment
      let isSingleLineComment = false;
      for (const commentPrefix of config.singleLineComment) {
        if (trimmedLine.startsWith(commentPrefix)) {
          isSingleLineComment = true;
          commentLines++;
          break;
        }
      }

      if (isSingleLineComment) {
        continue;
      }

      // If we reach here, it's a code line
      codeLines++;
    }

    return {
      totalLines: lines.length,
      codeLines,
      commentLines,
      blankLines,
    };
  }

  /**
   * Calculate average tokens per line
   * @param {number} totalTokens - Total tokens consumed
   * @param {number} totalLines - Total lines in file
   * @returns {number} Average tokens per line (rounded to 2 decimal places)
   */
  calculateAvgTokensPerLine(totalTokens, totalLines) {
    if (totalLines === 0) {
      return 0;
    }
    return parseFloat((totalTokens / totalLines).toFixed(2));
  }
}

module.exports = CodeAnalyzer;

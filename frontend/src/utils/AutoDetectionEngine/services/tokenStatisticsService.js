/**
 * @fileoverview Token Statistics Service
 * Tracks and reports token usage across detection sessions
 */

/**
 * @typedef {Object} TokenUsage
 * @property {number} prompt_tokens - Number of tokens in the prompt
 * @property {number} completion_tokens - Number of tokens in the completion
 * @property {number} total_tokens - Total number of tokens used
 */

/**
 * @typedef {Object} FileTokenRecord
 * @property {string} fileName - File name
 * @property {string} filePath - File path
 * @property {number} promptTokens - Prompt tokens used
 * @property {number} completionTokens - Completion tokens used
 * @property {number} totalTokens - Total tokens used
 * @property {number} timestamp - Timestamp of the detection
 */

/**
 * @typedef {Object} SessionTokenStatistics
 * @property {string} sessionId - Session ID
 * @property {number} startTime - Session start time
 * @property {number} endTime - Session end time
 * @property {number} totalPromptTokens - Total prompt tokens
 * @property {number} totalCompletionTokens - Total completion tokens
 * @property {number} totalTokens - Total tokens
 * @property {number} filesProcessed - Number of files processed
 * @property {FileTokenRecord[]} fileRecords - Per-file token records
 * @property {Object} summary - Summary statistics
 */

class TokenStatisticsService {
  constructor() {
    this.currentSession = null;
    this.fileRecords = [];
  }

  /**
   * Start a new token statistics session
   * @param {string} sessionId - Session ID
   */
  startSession(sessionId) {
    this.currentSession = {
      sessionId,
      startTime: Date.now(),
      endTime: null,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      filesProcessed: 0,
      fileRecords: [],
      summary: {
        avgPromptTokensPerFile: 0,
        avgCompletionTokensPerFile: 0,
        avgTotalTokensPerFile: 0,
        maxTokensFile: null,
        minTokensFile: null
      }
    };
    
    this.fileRecords = [];
    
    console.log('📊 Token statistics session started:', sessionId);
  }

  /**
   * Estimate token count from text (rough approximation)
   * @param {string} text - Text to estimate
   * @returns {number} - Estimated token count
   * @private
   */
  _estimateTokens(text) {
    if (!text) return 0;
    // Rough estimation: 1 token ≈ 4 characters for English, 1.5 characters for Chinese
    // Use a mixed ratio of 2.5 characters per token as average
    return Math.ceil(text.length / 2.5);
  }

  /**
   * Count lines in text
   * @param {string} text - Text to count
   * @returns {Object} - Line statistics
   * @private
   */
  _countLines(text) {
    if (!text) return { totalLines: 0, codeLines: 0, commentLines: 0 };
    
    const lines = text.split('\n');
    let codeLines = 0;
    let commentLines = 0;
    let inBlockComment = false;
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip empty lines
      if (!trimmed) continue;
      
      // Check for block comment start/end
      if (trimmed.includes('/*')) inBlockComment = true;
      if (trimmed.includes('*/')) {
        inBlockComment = false;
        commentLines++;
        continue;
      }
      
      // Count lines
      if (inBlockComment) {
        commentLines++;
      } else if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
        commentLines++;
      } else {
        codeLines++;
      }
    }
    
    return {
      totalLines: lines.length,
      codeLines,
      commentLines
    };
  }

  /**
   * Record token usage for a file
   * @param {string} fileName - File name
   * @param {string} filePath - File path
   * @param {TokenUsage|null} usage - Token usage data (can be null for estimation)
   * @param {string} [promptText] - Prompt text for estimation if usage is null
   * @param {string} [completionText] - Completion text for estimation if usage is null
   * @param {string} [moduleName] - Module/group name (optional)
   * @param {number} [processingTime] - Processing time in milliseconds (optional)
   * @param {Object} [lineStats] - Line statistics (optional, will auto-calculate if not provided)
   * @param {number} [lineStats.totalLines] - Total lines
   * @param {number} [lineStats.codeLines] - Code lines
   * @param {number} [lineStats.commentLines] - Comment lines
   */
  recordFileTokens(fileName, filePath, usage, promptText = '', completionText = '', moduleName = null, processingTime = 0, lineStats = null) {
    if (!this.currentSession) {
      console.warn('⚠️ No active token statistics session');
      return;
    }

    const recordStartTime = Date.now();
    
    // 🔧 确保lineStats有值，优先使用传入的，否则从promptText计算
    let calculatedLineStats;
    if (lineStats && lineStats.totalLines !== undefined) {
      // 使用传入的行数统计
      calculatedLineStats = {
        totalLines: lineStats.totalLines || 0,
        codeLines: lineStats.codeLines || 0,
        commentLines: lineStats.commentLines || 0
      };
    } else {
      // 从promptText计算（fallback）
      calculatedLineStats = this._countLines(promptText);
    }
    
    // 🔧 确保moduleName有值
    const safeModuleName = moduleName || this._extractModuleFromPath(filePath);
    
    // 🔧 确保processingTime是数字
    const safeProcessingTime = typeof processingTime === 'number' ? processingTime : 0;
    
    let record;

    if (usage && typeof usage.total_tokens === 'number') {
      // Use actual token data from API
      record = {
        fileName,
        filePath,
        moduleName: safeModuleName,
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
        totalTokens: usage.total_tokens || 0,
        timestamp: recordStartTime,
        processingTime: safeProcessingTime,
        totalLines: calculatedLineStats.totalLines,
        codeLines: calculatedLineStats.codeLines,
        commentLines: calculatedLineStats.commentLines,
        estimated: false
      };
    } else {
      // Estimate tokens from text length
      const estimatedPromptTokens = this._estimateTokens(promptText);
      const estimatedCompletionTokens = this._estimateTokens(completionText);
      
      record = {
        fileName,
        filePath,
        moduleName: safeModuleName,
        promptTokens: estimatedPromptTokens,
        completionTokens: estimatedCompletionTokens,
        totalTokens: estimatedPromptTokens + estimatedCompletionTokens,
        timestamp: recordStartTime,
        processingTime: safeProcessingTime,
        totalLines: calculatedLineStats.totalLines,
        codeLines: calculatedLineStats.codeLines,
        commentLines: calculatedLineStats.commentLines,
        estimated: true
      };
      
      console.log(`📊 Token usage estimated for ${fileName} (API did not provide usage data)`);
    }

    this.fileRecords.push(record);
    this.currentSession.fileRecords.push(record);
    this.currentSession.filesProcessed++;
    this.currentSession.totalPromptTokens += record.promptTokens;
    this.currentSession.totalCompletionTokens += record.completionTokens;
    this.currentSession.totalTokens += record.totalTokens;

    console.log(`📊 Token usage recorded for ${fileName}:`, {
      prompt: record.promptTokens,
      completion: record.completionTokens,
      total: record.totalTokens,
      module: record.moduleName,
      processingTime: record.processingTime,
      lines: `${record.totalLines} (code: ${record.codeLines}, comment: ${record.commentLines})`,
      estimated: record.estimated
    });
  }

  /**
   * Extract module name from file path
   * @private
   * @param {string} filePath - File path
   * @returns {string} - Module name
   */
  _extractModuleFromPath(filePath) {
    // 从路径中提取模块名
    // 例如: "Source/MyModule/file.cpp" -> "Source"
    //      "MyModule/file.cpp" -> "MyModule"
    //      "file.cpp" -> "root"
    //      "./file.cpp" -> "root"
    const parts = filePath.split('/').filter(p => p && p !== '.');
    
    // 如果没有路径部分，或者只有一个部分（文件名），返回root
    if (parts.length === 0 || parts.length === 1) {
      return 'root';
    }
    
    // 返回第一个目录名作为模块名
    return parts[0];
  }

  /**
   * End the current session and calculate statistics
   * @returns {SessionTokenStatistics|null} - Session statistics
   */
  endSession() {
    if (!this.currentSession) {
      console.warn('⚠️ No active token statistics session to end');
      return null;
    }

    this.currentSession.endTime = Date.now();
    
    // Calculate duration in milliseconds
    this.currentSession.duration = this.currentSession.endTime - this.currentSession.startTime;

    // Calculate line statistics totals
    this.currentSession.totalLines = this.currentSession.fileRecords.reduce((sum, r) => sum + (r.totalLines || 0), 0);
    this.currentSession.totalCodeLines = this.currentSession.fileRecords.reduce((sum, r) => sum + (r.codeLines || 0), 0);
    this.currentSession.totalCommentLines = this.currentSession.fileRecords.reduce((sum, r) => sum + (r.commentLines || 0), 0);

    // Calculate summary statistics
    if (this.currentSession.filesProcessed > 0) {
      this.currentSession.summary.avgPromptTokensPerFile = 
        Math.round(this.currentSession.totalPromptTokens / this.currentSession.filesProcessed);
      this.currentSession.summary.avgCompletionTokensPerFile = 
        Math.round(this.currentSession.totalCompletionTokens / this.currentSession.filesProcessed);
      this.currentSession.summary.avgTotalTokensPerFile = 
        Math.round(this.currentSession.totalTokens / this.currentSession.filesProcessed);
      
      // Calculate average tokens per line
      if (this.currentSession.totalLines > 0) {
        this.currentSession.summary.avgTokensPerLine = 
          this.currentSession.totalTokens / this.currentSession.totalLines;
      }

      // Find max and min token files
      const sortedByTotal = [...this.currentSession.fileRecords].sort((a, b) => b.totalTokens - a.totalTokens);
      this.currentSession.summary.maxTokensFile = sortedByTotal[0];
      this.currentSession.summary.minTokensFile = sortedByTotal[sortedByTotal.length - 1];
    }

    console.log('📊 Token statistics session ended:', {
      sessionId: this.currentSession.sessionId,
      duration: this.currentSession.duration,
      totalTokens: this.currentSession.totalTokens,
      totalLines: this.currentSession.totalLines,
      filesProcessed: this.currentSession.filesProcessed
    });

    const sessionData = { ...this.currentSession };
    this.currentSession = null;
    
    return sessionData;
  }

  /**
   * Get current session statistics (without ending the session)
   * @returns {SessionTokenStatistics|null} - Current session statistics
   */
  getCurrentSessionStats() {
    if (!this.currentSession) {
      return null;
    }

    // Calculate current duration
    const currentDuration = Date.now() - this.currentSession.startTime;

    return {
      ...this.currentSession,
      duration: currentDuration,
      summary: {
        ...this.currentSession.summary,
        avgPromptTokensPerFile: this.currentSession.filesProcessed > 0
          ? Math.round(this.currentSession.totalPromptTokens / this.currentSession.filesProcessed)
          : 0,
        avgCompletionTokensPerFile: this.currentSession.filesProcessed > 0
          ? Math.round(this.currentSession.totalCompletionTokens / this.currentSession.filesProcessed)
          : 0,
        avgTotalTokensPerFile: this.currentSession.filesProcessed > 0
          ? Math.round(this.currentSession.totalTokens / this.currentSession.filesProcessed)
          : 0
      }
    };
  }

  /**
   * Generate token statistics report
   * @param {SessionTokenStatistics} sessionStats - Session statistics
   * @param {string} [locale='zh'] - Report language ('zh' or 'en')
   * @param {Object} [pricing] - Pricing information
   * @param {number} [pricing.promptTokenPrice] - Price per 1K prompt tokens (USD)
   * @param {number} [pricing.completionTokenPrice] - Price per 1K completion tokens (USD)
   * @returns {string} - CSV format report
   */
  generateReport(sessionStats, locale = 'zh', pricing = null) {
    if (!sessionStats || !sessionStats.fileRecords || sessionStats.fileRecords.length === 0) {
      console.warn('⚠️ No token statistics data to generate report');
      return '';
    }

    // Default pricing (OpenAI GPT-4 pricing as reference)
    const defaultPricing = {
      promptTokenPrice: 0.03,      // $0.03 per 1K prompt tokens
      completionTokenPrice: 0.06   // $0.06 per 1K completion tokens
    };
    
    const actualPricing = pricing || defaultPricing;
    
    // Calculate costs
    const promptCost = (sessionStats.totalPromptTokens / 1000) * actualPricing.promptTokenPrice;
    const completionCost = (sessionStats.totalCompletionTokens / 1000) * actualPricing.completionTokenPrice;
    const totalCost = promptCost + completionCost;

    // CSV header (localized)
    const headers = locale === 'zh' 
      ? ['文件名', '文件路径', '总行数', '代码行', '注释行', 'Prompt Tokens', 'Completion Tokens', '总 Tokens', '耗时(秒)', '是否估算', '时间戳']
      : ['File Name', 'File Path', 'Total Lines', 'Code Lines', 'Comment Lines', 'Prompt Tokens', 'Completion Tokens', 'Total Tokens', 'Time(s)', 'Estimated', 'Timestamp'];
    
    const header = headers.join(',') + '\n';
    
    // CSV rows
    const rows = sessionStats.fileRecords.map(record => {
      const timestamp = new Date(record.timestamp).toISOString();
      const estimated = record.estimated 
        ? (locale === 'zh' ? '是' : 'Yes')
        : (locale === 'zh' ? '否' : 'No');
      const processingTimeSeconds = record.processingTime ? (record.processingTime / 1000).toFixed(1) : '0';
      return `"${record.fileName}","${record.filePath}",${record.totalLines || 0},${record.codeLines || 0},${record.commentLines || 0},${record.promptTokens},${record.completionTokens},${record.totalTokens},${processingTimeSeconds},${estimated},${timestamp}`;
    }).join('\n');

    // Summary section (localized)
    const estimatedCount = sessionStats.fileRecords.filter(r => r.estimated).length;
    const actualCount = sessionStats.fileRecords.length - estimatedCount;
    
    let summary = '';
    
    if (locale === 'zh') {
      summary = `\n\n汇总统计\n` +
        `会话 ID,${sessionStats.sessionId}\n` +
        `开始时间,${new Date(sessionStats.startTime).toISOString()}\n` +
        `结束时间,${new Date(sessionStats.endTime).toISOString()}\n` +
        `持续时间 (毫秒),${sessionStats.endTime - sessionStats.startTime}\n` +
        `处理文件数,${sessionStats.filesProcessed}\n` +
        `实际数据文件数,${actualCount}\n` +
        `估算数据文件数,${estimatedCount}\n` +
        `总 Prompt Tokens,${sessionStats.totalPromptTokens.toLocaleString()}\n` +
        `总 Completion Tokens,${sessionStats.totalCompletionTokens.toLocaleString()}\n` +
        `总 Tokens,${sessionStats.totalTokens.toLocaleString()}\n` +
        `平均 Prompt Tokens/文件,${sessionStats.summary.avgPromptTokensPerFile.toLocaleString()}\n` +
        `平均 Completion Tokens/文件,${sessionStats.summary.avgCompletionTokensPerFile.toLocaleString()}\n` +
        `平均总 Tokens/文件,${sessionStats.summary.avgTotalTokensPerFile.toLocaleString()}\n` +
        `\n费用估算 (基于 GPT-4 定价)\n` +
        `Prompt Token 单价,$${actualPricing.promptTokenPrice}/1K tokens\n` +
        `Completion Token 单价,$${actualPricing.completionTokenPrice}/1K tokens\n` +
        `Prompt 费用,$${promptCost.toFixed(4)}\n` +
        `Completion 费用,$${completionCost.toFixed(4)}\n` +
        `总费用,$${totalCost.toFixed(4)}\n` +
        `总费用 (人民币),¥${(totalCost * 7.2).toFixed(2)} (按汇率 1:7.2 计算)\n` +
        `\n注意: 标记为"估算"的 Token 数量是基于文本长度的近似值（API 未提供使用数据）\n`;
    } else {
      summary = `\n\nSummary\n` +
        `Session ID,${sessionStats.sessionId}\n` +
        `Start Time,${new Date(sessionStats.startTime).toISOString()}\n` +
        `End Time,${new Date(sessionStats.endTime).toISOString()}\n` +
        `Duration (ms),${sessionStats.endTime - sessionStats.startTime}\n` +
        `Files Processed,${sessionStats.filesProcessed}\n` +
        `Files with Actual Token Data,${actualCount}\n` +
        `Files with Estimated Token Data,${estimatedCount}\n` +
        `Total Prompt Tokens,${sessionStats.totalPromptTokens.toLocaleString()}\n` +
        `Total Completion Tokens,${sessionStats.totalCompletionTokens.toLocaleString()}\n` +
        `Total Tokens,${sessionStats.totalTokens.toLocaleString()}\n` +
        `Avg Prompt Tokens/File,${sessionStats.summary.avgPromptTokensPerFile.toLocaleString()}\n` +
        `Avg Completion Tokens/File,${sessionStats.summary.avgCompletionTokensPerFile.toLocaleString()}\n` +
        `Avg Total Tokens/File,${sessionStats.summary.avgTotalTokensPerFile.toLocaleString()}\n` +
        `\nCost Estimation (Based on GPT-4 Pricing)\n` +
        `Prompt Token Price,$${actualPricing.promptTokenPrice}/1K tokens\n` +
        `Completion Token Price,$${actualPricing.completionTokenPrice}/1K tokens\n` +
        `Prompt Cost,$${promptCost.toFixed(4)}\n` +
        `Completion Cost,$${completionCost.toFixed(4)}\n` +
        `Total Cost,$${totalCost.toFixed(4)}\n` +
        `Total Cost (CNY),¥${(totalCost * 7.2).toFixed(2)} (Exchange rate 1:7.2)\n` +
        `\nNote: Token counts marked as "Estimated" are approximations based on text length (API did not provide usage data)\n`;
    }

    const csv = '\uFEFF' + header + rows + summary; // Add BOM for Excel compatibility
    
    console.log('📊 Token statistics report generated:', {
      rows: sessionStats.fileRecords.length,
      totalTokens: sessionStats.totalTokens,
      estimatedFiles: estimatedCount,
      actualFiles: actualCount
    });

    return csv;
  }

  /**
   * Download token statistics report
   * @param {SessionTokenStatistics} sessionStats - Session statistics
   * @param {string} [fileName] - Custom file name
   * @param {string} [locale='zh'] - Report language ('zh' or 'en')
   * @param {Object} [pricing] - Pricing information
   */
  downloadReport(sessionStats, fileName, locale = 'zh', pricing = null) {
    const csv = this.generateReport(sessionStats, locale, pricing);
    if (!csv) {
      console.error('❌ Failed to generate token statistics report');
      return;
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', fileName || `token_statistics_${sessionStats.sessionId}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    URL.revokeObjectURL(url);
    
    console.log('📥 Token statistics report downloaded:', fileName || `token_statistics_${sessionStats.sessionId}.csv`);
  }

  /**
   * Reset the service (clear all data)
   */
  reset() {
    this.currentSession = null;
    this.fileRecords = [];
    console.log('🔄 Token statistics service reset');
  }
}

// Create singleton instance
const tokenStatisticsService = new TokenStatisticsService();

export default tokenStatisticsService;

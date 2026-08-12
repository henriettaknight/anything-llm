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

// 费用估算：定价表与汇率统一从 feeConfig.js 导入（费用估算单一数据源）
import { API_PRICING, USD_TO_CNY } from './feeConfig.js';

// 按单价（每百万 token）估算输入/输出费用
function estimateCost(pricing, sessionStats) {
  const prompt = (sessionStats.totalPromptTokens / 1e6) * pricing.inputPerM;
  const completion = (sessionStats.totalCompletionTokens / 1e6) * pricing.outputPerM;
  return { prompt, completion };
}

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
   * @returns {string} - CSV format report
   */
  generateReport(sessionStats, locale = 'zh') {
    if (!sessionStats || !sessionStats.fileRecords || sessionStats.fileRecords.length === 0) {
      console.warn('⚠️ No token statistics data to generate report');
      return '';
    }

    // 费用估算：按 2026 公开 API 价估算（本地 gemma4 模型无真实 API 费用）
    const ds = estimateCost(API_PRICING.deepseek, sessionStats);
    const cl = estimateCost(API_PRICING.claude, sessionStats);
    const dsTotal = ds.prompt + ds.completion;
    const clTotal = cl.prompt + cl.completion;

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
        `持续时间 (分钟),${((sessionStats.endTime - sessionStats.startTime) / 60000).toFixed(2)}\n` +
        `处理文件数,${sessionStats.filesProcessed}\n` +
        `实际数据文件数,${actualCount}\n` +
        `估算数据文件数,${estimatedCount}\n` +
        `总 Prompt Tokens,${sessionStats.totalPromptTokens.toLocaleString()}\n` +
        `总 Completion Tokens,${sessionStats.totalCompletionTokens.toLocaleString()}\n` +
        `总 Tokens,${sessionStats.totalTokens.toLocaleString()}\n` +
        `平均 Prompt Tokens/文件,${sessionStats.summary.avgPromptTokensPerFile.toLocaleString()}\n` +
        `平均 Completion Tokens/文件,${sessionStats.summary.avgCompletionTokensPerFile.toLocaleString()}\n` +
        `平均总 Tokens/文件,${sessionStats.summary.avgTotalTokensPerFile.toLocaleString()}\n` +
        `\n费用估算（按 2026 公开 API 价，本地 gemma4 无真实费用）\n` +
        `DeepSeek (输入 $${API_PRICING.deepseek.inputPerM}/1M, 输出 $${API_PRICING.deepseek.outputPerM}/1M),\n` +
        `  Prompt 费用,$${ds.prompt.toFixed(4)}\n` +
        `  Completion 费用,$${ds.completion.toFixed(4)}\n` +
        `  总费用,$${dsTotal.toFixed(4)}\n` +
        `  总费用 (人民币),¥${(dsTotal * USD_TO_CNY).toFixed(2)} (按汇率 1:${USD_TO_CNY})\n` +
        `Claude Sonnet 4.6 (输入 $${API_PRICING.claude.inputPerM}/1M, 输出 $${API_PRICING.claude.outputPerM}/1M),\n` +
        `  Prompt 费用,$${cl.prompt.toFixed(4)}\n` +
        `  Completion 费用,$${cl.completion.toFixed(4)}\n` +
        `  总费用,$${clTotal.toFixed(4)}\n` +
        `  总费用 (人民币),¥${(clTotal * USD_TO_CNY).toFixed(2)} (按汇率 1:${USD_TO_CNY})\n` +
        `\n注意: 标记为"估算"的 Token 数量是基于文本长度的近似值（API 未提供使用数据）\n`;
    } else {
      summary = `\n\nSummary\n` +
        `Session ID,${sessionStats.sessionId}\n` +
        `Start Time,${new Date(sessionStats.startTime).toISOString()}\n` +
        `End Time,${new Date(sessionStats.endTime).toISOString()}\n` +
        `Duration (min),${((sessionStats.endTime - sessionStats.startTime) / 60000).toFixed(2)}\n` +
        `Files Processed,${sessionStats.filesProcessed}\n` +
        `Files with Actual Token Data,${actualCount}\n` +
        `Files with Estimated Token Data,${estimatedCount}\n` +
        `Total Prompt Tokens,${sessionStats.totalPromptTokens.toLocaleString()}\n` +
        `Total Completion Tokens,${sessionStats.totalCompletionTokens.toLocaleString()}\n` +
        `Total Tokens,${sessionStats.totalTokens.toLocaleString()}\n` +
        `Avg Prompt Tokens/File,${sessionStats.summary.avgPromptTokensPerFile.toLocaleString()}\n` +
        `Avg Completion Tokens/File,${sessionStats.summary.avgCompletionTokensPerFile.toLocaleString()}\n` +
        `Avg Total Tokens/File,${sessionStats.summary.avgTotalTokensPerFile.toLocaleString()}\n` +
        `\nCost Estimation (2026 public API prices; local gemma4 has no real cost)\n` +
        `DeepSeek (input $${API_PRICING.deepseek.inputPerM}/1M, output $${API_PRICING.deepseek.outputPerM}/1M),\n` +
        `  Prompt Cost,$${ds.prompt.toFixed(4)}\n` +
        `  Completion Cost,$${ds.completion.toFixed(4)}\n` +
        `  Total Cost,$${dsTotal.toFixed(4)}\n` +
        `  Total Cost (CNY),¥${(dsTotal * USD_TO_CNY).toFixed(2)} (1:${USD_TO_CNY})\n` +
        `Claude Sonnet 4.6 (input $${API_PRICING.claude.inputPerM}/1M, output $${API_PRICING.claude.outputPerM}/1M),\n` +
        `  Prompt Cost,$${cl.prompt.toFixed(4)}\n` +
        `  Completion Cost,$${cl.completion.toFixed(4)}\n` +
        `  Total Cost,$${clTotal.toFixed(4)}\n` +
        `  Total Cost (CNY),¥${(clTotal * USD_TO_CNY).toFixed(2)} (1:${USD_TO_CNY})\n` +
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
   * Generate token statistics as an xlsx ArrayBuffer using SheetJS.
   * @param {Object} sessionStats
   * @param {string} [locale='zh']
   * @returns {ArrayBuffer|null}
   */
  async generateXLSXBuffer(sessionStats, locale = 'zh') {
    if (!sessionStats) {
      console.warn('⚠️ No token statistics data to generate xlsx');
      return null;
    }

    const XLSX = await import('xlsx');

    // 费用估算：按 2026 公开 API 价估算（本地 gemma4 模型无真实 API 费用）
    const ds = estimateCost(API_PRICING.deepseek, sessionStats);
    const cl = estimateCost(API_PRICING.claude, sessionStats);
    const dsTotal = ds.prompt + ds.completion;
    const clTotal = cl.prompt + cl.completion;

    const isZh = locale === 'zh';

    // 安全处理旧报告（可能缺少 startTime/endTime/summary 等字段）
    const safeISO = (ts) => {
      const d = new Date(ts);
      return isNaN(d.getTime()) ? '' : d.toISOString();
    };
    const s = sessionStats.summary || {};
    const safeAvg = (v) => (typeof v === 'number' ? v : 0);
    const durMin = (sessionStats.startTime && sessionStats.endTime)
      ? Number(((sessionStats.endTime - sessionStats.startTime) / 60000).toFixed(2))
      : 'N/A';

    // --- Sheet 1: per-file records ---
    const fileHeaders = isZh
      ? ['文件名', '文件路径', '总行数', '代码行', '注释行', 'Prompt Tokens', 'Completion Tokens', '总 Tokens', '耗时(秒)', '是否估算', '时间戳']
      : ['File Name', 'File Path', 'Total Lines', 'Code Lines', 'Comment Lines', 'Prompt Tokens', 'Completion Tokens', 'Total Tokens', 'Time(s)', 'Estimated', 'Timestamp'];

    const fileRows = [fileHeaders];
    const hasFileRecords = Array.isArray(sessionStats.fileRecords) && sessionStats.fileRecords.length > 0;
    if (hasFileRecords) {
      for (const r of sessionStats.fileRecords) {
        fileRows.push([
          r.fileName,
          r.filePath,
          r.totalLines || 0,
          r.codeLines || 0,
          r.commentLines || 0,
          r.promptTokens,
          r.completionTokens,
          r.totalTokens,
          r.processingTime ? +(r.processingTime / 1000).toFixed(1) : 0,
          r.estimated ? (isZh ? '是' : 'Yes') : (isZh ? '否' : 'No'),
          new Date(r.timestamp).toISOString()
        ]);
      }
    }

    const wsFiles = XLSX.utils.aoa_to_sheet(fileRows);
    wsFiles['!cols'] = [
      { wch: 30 }, { wch: 50 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
      { wch: 15 }, { wch: 18 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 26 }
    ];

    // --- Sheet 2: summary ---
    const estimatedCount = hasFileRecords ? sessionStats.fileRecords.filter(r => r.estimated).length : (sessionStats.estimatedCount || 0);
    const actualCount = hasFileRecords ? sessionStats.fileRecords.length - estimatedCount : (sessionStats.actualCount || 0);

    const summaryRows = isZh ? [
      ['会话 ID', sessionStats.sessionId || ''],
      ['开始时间', safeISO(sessionStats.startTime)],
      ['结束时间', safeISO(sessionStats.endTime)],
      ['持续时间 (分钟)', durMin],
      ['处理文件数', sessionStats.filesProcessed],
      ['实际数据文件数', actualCount],
      ['估算数据文件数', estimatedCount],
      ['总 Prompt Tokens', sessionStats.totalPromptTokens],
      ['总 Completion Tokens', sessionStats.totalCompletionTokens],
      ['总 Tokens', sessionStats.totalTokens],
      ['平均 Prompt Tokens/文件', safeAvg(s.avgPromptTokensPerFile)],
      ['平均 Completion Tokens/文件', safeAvg(s.avgCompletionTokensPerFile)],
      ['平均总 Tokens/文件', safeAvg(s.avgTotalTokensPerFile)],
      [],
      ['费用估算说明', '按 2026 公开 API 价估算（实际为本地 gemma4 模型，无真实 API 费用）'],
      [`DeepSeek：输入 $${API_PRICING.deepseek.inputPerM}/1M，输出 $${API_PRICING.deepseek.outputPerM}/1M`, ''],
      ['  Prompt 费用', `$${ds.prompt.toFixed(4)}`],
      ['  Completion 费用', `$${ds.completion.toFixed(4)}`],
      ['  总费用', `$${dsTotal.toFixed(4)}`],
      ['  总费用 (人民币)', `¥${(dsTotal * USD_TO_CNY).toFixed(2)}`],
      [`Claude Sonnet 4.6：输入 $${API_PRICING.claude.inputPerM}/1M，输出 $${API_PRICING.claude.outputPerM}/1M`, ''],
      ['  Prompt 费用', `$${cl.prompt.toFixed(4)}`],
      ['  Completion 费用', `$${cl.completion.toFixed(4)}`],
      ['  总费用', `$${clTotal.toFixed(4)}`],
      ['  总费用 (人民币)', `¥${(clTotal * USD_TO_CNY).toFixed(2)}`],
    ] : [
      ['Session ID', sessionStats.sessionId || ''],
      ['Start Time', safeISO(sessionStats.startTime)],
      ['End Time', safeISO(sessionStats.endTime)],
      ['Duration (min)', durMin],
      ['Files Processed', sessionStats.filesProcessed],
      ['Files with Actual Token Data', actualCount],
      ['Files with Estimated Token Data', estimatedCount],
      ['Total Prompt Tokens', sessionStats.totalPromptTokens],
      ['Total Completion Tokens', sessionStats.totalCompletionTokens],
      ['Total Tokens', sessionStats.totalTokens],
      ['Avg Prompt Tokens/File', safeAvg(s.avgPromptTokensPerFile)],
      ['Avg Completion Tokens/File', safeAvg(s.avgCompletionTokensPerFile)],
      ['Avg Total Tokens/File', safeAvg(s.avgTotalTokensPerFile)],
      [],
      ['Cost Estimation Note', 'Estimated using 2026 public API prices (actual local gemma4 model has no real API cost)'],
      [`DeepSeek: input $${API_PRICING.deepseek.inputPerM}/1M, output $${API_PRICING.deepseek.outputPerM}/1M`, ''],
      ['  Prompt Cost', `$${ds.prompt.toFixed(4)}`],
      ['  Completion Cost', `$${ds.completion.toFixed(4)}`],
      ['  Total Cost', `$${dsTotal.toFixed(4)}`],
      ['  Total Cost (CNY)', `¥${(dsTotal * USD_TO_CNY).toFixed(2)}`],
      [`Claude Sonnet 4.6: input $${API_PRICING.claude.inputPerM}/1M, output $${API_PRICING.claude.outputPerM}/1M`, ''],
      ['  Prompt Cost', `$${cl.prompt.toFixed(4)}`],
      ['  Completion Cost', `$${cl.completion.toFixed(4)}`],
      ['  Total Cost', `$${clTotal.toFixed(4)}`],
      ['  Total Cost (CNY)', `¥${(clTotal * USD_TO_CNY).toFixed(2)}`],
    ];

    const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
    wsSummary['!cols'] = [{ wch: 35 }, { wch: 30 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsSummary, isZh ? '汇总' : 'Summary');
    XLSX.utils.book_append_sheet(wb, wsFiles, isZh ? '逐文件统计' : 'Per-File Stats');

    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return buf.buffer ?? buf; // ensure ArrayBuffer
  }

  /**
   * Download token statistics report
   * @param {SessionTokenStatistics} sessionStats - Session statistics
   * @param {string} [fileName] - Custom file name
   * @param {string} [locale='zh'] - Report language ('zh' or 'en')
   * @param {Object} [pricing] - Pricing information
   */
  downloadReport(sessionStats, fileName, locale = 'zh') {
    const csv = this.generateReport(sessionStats, locale);
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

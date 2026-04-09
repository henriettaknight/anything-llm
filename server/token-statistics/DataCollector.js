/**
 * DataCollector
 * Coordinates the entire data collection process, manages sessions and modules
 */

const { v4: uuidv4 } = require('uuid');
const path = require('path');
const TempFileManager = require('./TempFileManager');
const CodeAnalyzer = require('./CodeAnalyzer');
const CostCalculator = require('./CostCalculator');
const CSVWriter = require('./CSVWriter');
const SecurityModule = require('./SecurityModule');
const { SessionError, ErrorCode } = require('./ErrorTypes');
const { createLogger } = require('./Logger');
const ErrorHandler = require('./ErrorHandler');

class DataCollector {
  constructor() {
    this.tempFileManager = new TempFileManager();
    this.codeAnalyzer = new CodeAnalyzer();
    this.costCalculator = new CostCalculator();
    this.csvWriter = new CSVWriter();
    this.security = new SecurityModule();
    this.activeSessions = new Map();
    this.activeModules = new Map();
    this.projectRoot = process.cwd(); // Store project root for path sanitization
    this.logger = createLogger('DataCollector');
  }

  /**
   * Start a new session
   * @returns {Object} SessionContext
   */
  async startSession() {
    try {
      const sessionId = uuidv4();
      const startTime = new Date();
      
      this.logger.info('Starting new session', { sessionId });
      
      const tempDir = await this.tempFileManager.createSessionDir(sessionId);

      const sessionContext = {
        sessionId,
        startTime,
        tempDir,
        modules: [],
      };

      this.activeSessions.set(sessionId, sessionContext);
      
      this.logger.info('Session started successfully', { sessionId, tempDir });
      
      return sessionContext;
    } catch (error) {
      this.logger.error('Failed to start session', error);
      throw new SessionError(
        ErrorCode.SESSION_CREATION_FAILED,
        'Failed to create session',
        null,
        error
      );
    }
  }

  /**
   * End a session
   * @param {string} sessionId
   */
  async endSession(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      this.logger.error('Session not found', { sessionId });
      throw new SessionError(
        ErrorCode.SESSION_NOT_FOUND,
        `Session not found: ${sessionId}`,
        { sessionId }
      );
    }

    try {
      this.logger.info('Ending session', { sessionId, moduleCount: session.modules.length });
      
      // Generate summary record
      await this.csvWriter.appendSummary(sessionId, this._calculateSummary(session));

      this.activeSessions.delete(sessionId);
      
      this.logger.info('Session ended successfully', { sessionId });
    } catch (error) {
      this.logger.error('Failed to end session', error);
      throw error;
    }
  }

  /**
   * Start a new module within a session
   * @param {string} sessionId
   * @param {string} moduleName
   * @returns {Object} ModuleContext
   */
  async startModule(sessionId, moduleName) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      this.logger.error('Session not found for module creation', { sessionId, moduleName });
      throw new SessionError(
        ErrorCode.SESSION_NOT_FOUND,
        `Session not found: ${sessionId}`,
        { sessionId, moduleName }
      );
    }

    try {
      const moduleId = `mod_${String(session.modules.length + 1).padStart(3, '0')}`;
      const startTime = new Date();

      this.logger.info('Starting module', { sessionId, moduleId, moduleName });

      const moduleContext = {
        moduleId,
        moduleName,
        startTime,
        sessionId,
        files: [],
        stats: {
          fileCount: 0,
          totalLines: 0,
          codeLines: 0,
          commentLines: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        },
      };

      session.modules.push(moduleContext);
      this.activeModules.set(`${sessionId}:${moduleId}`, moduleContext);

      this.logger.info('Module started successfully', { sessionId, moduleId, moduleName });

      return moduleContext;
    } catch (error) {
      this.logger.error('Failed to start module', error);
      throw error;
    }
  }

  /**
   * End a module and write its summary
   * @param {string} sessionId
   * @param {string} moduleId
   */
  async endModule(sessionId, moduleId) {
    const moduleKey = `${sessionId}:${moduleId}`;
    const module = this.activeModules.get(moduleKey);

    if (!module) {
      throw new Error(`Module not found: ${moduleId}`);
    }

    // Calculate module statistics
    const moduleStats = this._calculateModuleStats(module);

    // Write module record to CSV
    await this.csvWriter.writeStatistics(sessionId, [moduleStats]);

    this.activeModules.delete(moduleKey);
  }

  /**
   * Record a file processing event
   * @param {string} sessionId
   * @param {string} moduleId
   * @param {Object} fileInfo
   */
  async recordFile(sessionId, moduleId, fileInfo) {
    const moduleKey = `${sessionId}:${moduleId}`;
    const module = this.activeModules.get(moduleKey);

    if (!module) {
      this.logger.error('Module not found for file recording', { sessionId, moduleId });
      throw new SessionError(
        ErrorCode.MODULE_NOT_FOUND,
        `Module not found: ${moduleId}`,
        { sessionId, moduleId }
      );
    }

    try {
      // Analyze file if line stats not provided
      let lineStats = {
        totalLines: fileInfo.totalLines || 0,
        codeLines: fileInfo.codeLines || 0,
        commentLines: fileInfo.commentLines || 0,
        blankLines: fileInfo.blankLines || 0,
      };

      if (!fileInfo.totalLines && fileInfo.filePath) {
        // Use error handler to skip file on analysis error
        lineStats = await ErrorHandler.handleFileRead(
          () => this.codeAnalyzer.analyzeFile(fileInfo.filePath),
          fileInfo.filePath,
          lineStats
        );
      }

      // Calculate costs
      const costs = this.costCalculator.compareCosts(
        fileInfo.inputTokens || 0,
        fileInfo.outputTokens || 0
      );

      // Requirement 9.6: Sanitize file path to show only relative path
      const sanitizedPath = this.security.sanitizeFilePath(
        fileInfo.filePath || '',
        this.projectRoot
      );

      const fileRecord = {
        fileId: uuidv4(),
        moduleId,
        filePath: sanitizedPath, // Use sanitized path instead of full path
        fileName: fileInfo.fileName || path.basename(fileInfo.filePath || ''),
        fileType: fileInfo.fileType || path.extname(fileInfo.filePath || '').slice(1),
        operationType: fileInfo.operationType || 'read',
        totalLines: lineStats.totalLines,
        codeLines: lineStats.codeLines,
        commentLines: lineStats.commentLines,
        inputTokens: fileInfo.inputTokens || 0,
        outputTokens: fileInfo.outputTokens || 0,
        totalTokens: (fileInfo.inputTokens || 0) + (fileInfo.outputTokens || 0),
        tokensPerLine: lineStats.totalLines > 0 
          ? ((fileInfo.inputTokens || 0) + (fileInfo.outputTokens || 0)) / lineStats.totalLines 
          : 0,
        deepseekCostUsd: costs.deepseek.totalCost,
        claudeCostUsd: costs.claude.totalCost,
        costPerLineUsd: lineStats.totalLines > 0 
          ? costs.deepseek.totalCost / lineStats.totalLines 
          : 0,
      };

      // Update module stats
      module.files.push(fileRecord);
      module.stats.fileCount++;
      module.stats.totalLines += lineStats.totalLines;
      module.stats.codeLines += lineStats.codeLines;
      module.stats.commentLines += lineStats.commentLines;
      module.stats.inputTokens += fileInfo.inputTokens || 0;
      module.stats.outputTokens += fileInfo.outputTokens || 0;
      module.stats.totalTokens += (fileInfo.inputTokens || 0) + (fileInfo.outputTokens || 0);

      this.logger.debug('Recording file', {
        sessionId,
        moduleId,
        fileName: fileRecord.fileName,
        totalTokens: fileRecord.totalTokens,
      });

      // Write file record to CSV
      await this.csvWriter.writeFileDetails(sessionId, moduleId, [fileRecord]);
      
      this.logger.debug('File recorded successfully', {
        sessionId,
        moduleId,
        fileName: fileRecord.fileName,
      });
    } catch (error) {
      this.logger.error('Failed to record file', {
        error,
        sessionId,
        moduleId,
        filePath: fileInfo.filePath,
      });
      throw error;
    }
  }

  /**
   * Get session statistics
   * @param {string} sessionId
   * @returns {Object} Session statistics
   */
  async getSessionStats(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      this.logger.error('Session not found for stats retrieval', { sessionId });
      throw new SessionError(
        ErrorCode.SESSION_NOT_FOUND,
        `Session not found: ${sessionId}`,
        { sessionId }
      );
    }

    return {
      sessionId,
      startTime: session.startTime,
      moduleCount: session.modules.length,
      modules: session.modules.map(m => this._calculateModuleStats(m)),
    };
  }

  /**
   * Get module statistics
   * @param {string} sessionId
   * @param {string} moduleId
   * @returns {Object} Module statistics
   */
  async getModuleStats(sessionId, moduleId) {
    const moduleKey = `${sessionId}:${moduleId}`;
    const module = this.activeModules.get(moduleKey);

    if (!module) {
      this.logger.error('Module not found for stats retrieval', { sessionId, moduleId });
      throw new SessionError(
        ErrorCode.MODULE_NOT_FOUND,
        `Module not found: ${moduleId}`,
        { sessionId, moduleId }
      );
    }

    return this._calculateModuleStats(module);
  }

  /**
   * Calculate module statistics
   * @private
   */
  _calculateModuleStats(module) {
    const costs = this.costCalculator.compareCosts(
      module.stats.inputTokens,
      module.stats.outputTokens
    );

    return {
      recordType: 'module',
      recordId: module.moduleId,
      date: new Date().toISOString().split('T')[0],
      periodType: '日',
      moduleId: module.moduleId,
      moduleName: module.moduleName,
      fileCount: module.stats.fileCount,
      totalLines: module.stats.totalLines,
      codeLines: module.stats.codeLines,
      commentLines: module.stats.commentLines,
      inputTokens: module.stats.inputTokens,
      outputTokens: module.stats.outputTokens,
      totalTokens: module.stats.totalTokens,
      avgTokensPerLine: module.stats.totalLines > 0 
        ? module.stats.totalTokens / module.stats.totalLines 
        : 0,
      deepseekCostUsd: costs.deepseek.totalCost,
      claudeCostUsd: costs.claude.totalCost,
      costDifference: costs.difference,
      status: '已完成',
    };
  }

  /**
   * Calculate summary statistics for entire session
   * @private
   */
  _calculateSummary(session) {
    const totals = session.modules.reduce(
      (acc, module) => ({
        fileCount: acc.fileCount + module.stats.fileCount,
        totalLines: acc.totalLines + module.stats.totalLines,
        codeLines: acc.codeLines + module.stats.codeLines,
        commentLines: acc.commentLines + module.stats.commentLines,
        inputTokens: acc.inputTokens + module.stats.inputTokens,
        outputTokens: acc.outputTokens + module.stats.outputTokens,
        totalTokens: acc.totalTokens + module.stats.totalTokens,
      }),
      {
        fileCount: 0,
        totalLines: 0,
        codeLines: 0,
        commentLines: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      }
    );

    const costs = this.costCalculator.compareCosts(
      totals.inputTokens,
      totals.outputTokens
    );

    return {
      recordType: 'summary',
      recordId: 'summary',
      date: new Date().toISOString().split('T')[0],
      periodType: '日',
      moduleId: '',
      moduleName: '全局统计',
      fileCount: totals.fileCount,
      totalLines: totals.totalLines,
      codeLines: totals.codeLines,
      commentLines: totals.commentLines,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      totalTokens: totals.totalTokens,
      avgTokensPerLine: totals.totalLines > 0 
        ? totals.totalTokens / totals.totalLines 
        : 0,
      deepseekCostUsd: costs.deepseek.totalCost,
      claudeCostUsd: costs.claude.totalCost,
      costDifference: costs.difference,
      status: '已完成',
    };
  }
}

module.exports = DataCollector;

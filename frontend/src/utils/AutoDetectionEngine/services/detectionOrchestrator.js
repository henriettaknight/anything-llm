/**
 * @fileoverview Detection Orchestrator Service
 * Coordinates all services for the main detection workflow
 */

import { scanDirectoryByGroups, filterFiles } from './fileMonitorService.js';
import { createBatchProcessor } from './batchProcessingService.js';
import { detectDefectsInFile } from './codeDetectionService.js';
import { resumeDetectionService } from './resumeDetectionService.js';
import SessionStorage, { SessionStatus } from '../storage/sessionStorage.js';
import { resourceMonitorService } from './resourceMonitorService.js';
import tokenStatisticsService from './tokenStatisticsService.js';
import zipPackageService from './zipPackageService.js';

/**
 * @typedef {Object} DetectionSession
 * @property {string} id - Session ID
 * @property {string} status - Session status (running, paused, completed, failed)
 * @property {Object} progress - Progress information
 * @property {number} progress.totalFiles - Total files to process
 * @property {number} progress.processedFiles - Files processed
 * @property {string} progress.currentFile - Current file being processed
 * @property {number} progress.percentage - Progress percentage
 * @property {number} startTime - Start timestamp
 * @property {number} [endTime] - End timestamp
 * @property {Object} config - Configuration snapshot
 * @property {string} [error] - Error message if failed
 */

/**
 * Detection Orchestrator Implementation
 */
class DetectionOrchestratorImpl {
  constructor() {
    this.currentSession = null;
    this.batchProcessor = null;
    this.progressCallbacks = [];
    this.statusCallbacks = [];
    this._isCancelled = false;  // 使用私有变量
    
    // 🔍 调试：使用 getter/setter 监控 isCancelled 的变化
    Object.defineProperty(this, 'isCancelled', {
      get: () => {
        return this._isCancelled;
      },
      set: (value) => {
        if (this._isCancelled !== value) {
          console.log('🚨🚨🚨 isCancelled 标志变化:', this._isCancelled, '→', value);
          console.log('变化时间:', new Date().toISOString());
          console.trace('变化调用栈:');
        }
        this._isCancelled = value;
      }
    });
  }

  /**
   * Start a new detection session
   * @param {Object} options - Detection options
   * @param {FileSystemDirectoryHandle} options.directoryHandle - Directory to scan
   * @param {Object} options.config - Detection configuration
   * @param {Function} [options.onProgress] - Progress callback
   * @param {Function} [options.onStatusChange] - Status change callback
   * @param {Function} [options.onReportGenerated] - Report generated callback
   * @param {boolean} [options.resumeFromLast] - Resume from last incomplete session
   * @returns {Promise<DetectionSession>} - Created session
   */
  async startDetection(options) {
    console.log('🔥 NEW CODE LOADED - startDetection called with force cleanup');
    const { directoryHandle, config, onProgress, onStatusChange, onReportGenerated, resumeFromLast = false } = options;

    // Force cleanup any existing session state
    console.log('🧹 强制清理会话状态');
    console.trace('调用栈:');
    console.log('清理前 isCancelled:', this.isCancelled);
    
    this.currentSession = null;
    this.progressCallbacks = [];
    this.statusCallbacks = [];
    this.reportCallbacks = [];
    this.isCancelled = false;  // 重置取消标志
    
    console.log('✅ Session state forcefully cleared');
    console.log('清理后 isCancelled:', this.isCancelled);

    // Check if we should resume from last session
    if (resumeFromLast) {
      const incompleteSessions = SessionStorage.getIncompleteSessions();
      if (incompleteSessions.length > 0) {
        const lastSession = incompleteSessions[0];
        console.log(`恢复会话: ${lastSession.id}`);
        return await this.resumeFromSession(lastSession.id, options);
      }
    }

    // Check system resources before starting
    console.log('检查系统资源...');
    const resourceCheck = resourceMonitorService.checkResourceConstraints({
      batchSize: config.batchSize,
      avgFileSize: config.avgFileSize || 50
    });

    if (!resourceCheck.canStartDetection) {
      const error = `资源不足，无法开始检测:\n${resourceCheck.warnings.join('\n')}`;
      console.error(error);
      
      if (resourceCheck.recommendations.batchSize) {
        console.log(`建议: ${resourceCheck.recommendations.message}`);
        // Auto-adjust batch size
        config.batchSize = resourceCheck.recommendations.batchSize;
        console.log(`已自动调整批处理大小为: ${config.batchSize}`);
      } else {
        throw new Error(error);
      }
    }

    // Start resource monitoring
    resourceMonitorService.startMonitoring((warning) => {
      console.warn(`资源警告 [${warning.level}]: ${warning.message}`);
      
      if (warning.level === 'critical' && this.batchProcessor) {
        // Dynamically reduce batch size
        const newBatchSize = this.batchProcessor.adjustBatchSizeDynamic({
          availableMemory: warning.resourceInfo.availableMemory,
          avgFileSize: config.avgFileSize || 50
        });
        console.log(`由于资源限制，批处理大小已调整为: ${newBatchSize}`);
      }
    });

    // Create new session using SessionStorage
    this.currentSession = SessionStorage.createSession(config);

    // Start token statistics session
    tokenStatisticsService.startSession(this.currentSession.id);
    console.log('📊 Token statistics session started for:', this.currentSession.id);

    // Register callbacks
    if (onProgress) {
      this.progressCallbacks.push(onProgress);
    }
    if (onStatusChange) {
      this.statusCallbacks.push(onStatusChange);
    }

    // Notify status change
    this.notifyStatusChange(SessionStatus.RUNNING);

    try {
      // Step 1: Scan directory with filters
      console.log('步骤 1: 扫描目录...');
      const scanConfig = {
        fileTypes: config.fileTypes || ['.h', '.cpp', '.hpp', '.cc', '.cxx'],
        excludePatterns: config.excludePatterns || []
      };
      
      const { groups, rootFiles } = await scanDirectoryByGroups(directoryHandle, scanConfig);
      
      // Calculate total files
      const totalFiles = groups.reduce((sum, g) => sum + g.files.length, 0) + rootFiles.length;
      
      // Update session progress
      SessionStorage.updateProgress(this.currentSession.id, {
        totalFiles: totalFiles,
        processedFiles: 0
      });
      
      this.currentSession = SessionStorage.load(this.currentSession.id);
      
      console.log(`扫描完成: ${groups.length} 个分组, ${totalFiles} 个文件`);
      
      // Estimate detection time
      const timeEstimate = resourceMonitorService.estimateDetectionTime({
        totalFiles,
        batchSize: config.batchSize,
        avgTimePerFile: 5000
      });
      console.log(`预计检测时间: ${timeEstimate.estimatedTimeFormatted}`);
      if (timeEstimate.note) {
        console.warn(timeEstimate.note);
      }
      
      this.notifyProgress();

      // Step 2: Process each group
      console.log('步骤 2: 开始批处理检测...');
      const allResults = [];
      
      // Initialize batch processor with resource-aware configuration
      this.batchProcessor = createBatchProcessor({
        batchSize: config.batchSize || 20,
        maxConcurrency: config.maxConcurrency || 1
      });

      // Calculate total groups (including root if it has files)
      const totalGroups = groups.length + (rootFiles.length > 0 ? 1 : 0);

      // Process groups
      for (let i = 0; i < groups.length; i++) {
        // 检查是否已取消
        console.log(`🔍 检查取消标志 (分组 ${i + 1}/${groups.length}): isCancelled = ${this.isCancelled}`);
        if (this.isCancelled) {
          console.log('❌ 检测已被取消，停止处理');
          console.log('取消时间:', new Date().toISOString());
          console.log('当前分组:', groups[i].name);
          console.trace('取消检测点的调用栈:');
          throw new Error('检测已被用户取消');
        }
        
        const group = groups[i];
        console.log(`处理分组 ${i + 1}/${groups.length}: ${group.name}`);
        
        // Update progress with current group info
        SessionStorage.updateProgress(this.currentSession.id, {
          currentGroup: i + 1,
          totalGroups: totalGroups,
          currentGroupName: group.name
        });
        this.currentSession = SessionStorage.load(this.currentSession.id);
        this.notifyProgress();
        
        const groupResult = await this.processGroup(
          group,
          directoryHandle,
          onReportGenerated,
          this.currentSession.id  // 传递 sessionId
        );
        
        allResults.push(groupResult);
        
        // 立即生成并保存该分组的报告
        if (onReportGenerated) {
          const groupReport = {
            groupName: group.name,
            groupPath: group.path,
            filesScanned: group.files.length,
            defectsFound: 0,  // 从 groupResult 中计算
            batches: groupResult.batches,
            sessionId: this.currentSession.id,
            timestamp: Date.now(),
            createdAt: new Date().toISOString(),
            status: 'completed'
          };
          
          // 计算缺陷数
          const batchResults = (groupResult.batches || []).flatMap(batch => batch.results || []);
          groupReport.defectsFound = batchResults.reduce((sum, r) => sum + (r.defects?.length || 0), 0);
          groupReport.defects = batchResults.flatMap(r => r.defects || []);
          groupReport.results = batchResults.map(r => ({
            file: r.filePath || r.file?.path,
            filePath: r.filePath || r.file?.path,
            defects: r.defects || []
          }));
          
          console.log(`✅ 分组 ${group.name} 检测完成，立即生成报告`);
          onReportGenerated(groupReport);
        }
      }

      // Process root files if any
      if (rootFiles.length > 0) {
        console.log(`处理根目录文件: ${rootFiles.length} 个`);
        
        // Update progress with root group info
        SessionStorage.updateProgress(this.currentSession.id, {
          currentGroup: totalGroups,
          totalGroups: totalGroups,
          currentGroupName: 'root'
        });
        this.currentSession = SessionStorage.load(this.currentSession.id);
        this.notifyProgress();
        
        const rootResult = await this.processGroup(
          { name: 'root', path: '.', files: rootFiles },
          directoryHandle,
          onReportGenerated,
          this.currentSession.id  // 传递 sessionId
        );
        allResults.push(rootResult);
        
        // 立即生成并保存根目录文件的报告
        if (onReportGenerated) {
          const groupReport = {
            groupName: 'root',
            groupPath: '.',
            filesScanned: rootFiles.length,
            defectsFound: 0,  // 从 rootResult 中计算
            batches: rootResult.batches,
            sessionId: this.currentSession.id,
            timestamp: Date.now(),
            createdAt: new Date().toISOString(),
            status: 'completed'
          };
          
          // 计算缺陷数
          const batchResults = (rootResult.batches || []).flatMap(batch => batch.results || []);
          groupReport.defectsFound = batchResults.reduce((sum, r) => sum + (r.defects?.length || 0), 0);
          groupReport.defects = batchResults.flatMap(r => r.defects || []);
          groupReport.results = batchResults.map(r => ({
            file: r.filePath || r.file?.path,
            filePath: r.filePath || r.file?.path,
            defects: r.defects || []
          }));
          
          console.log(`✅ 根目录文件检测完成，立即生成报告`);
          onReportGenerated(groupReport);
        }
      }

      // Step 3: Complete session
      SessionStorage.updateStatus(this.currentSession.id, SessionStatus.COMPLETED);
      SessionStorage.updateProgress(this.currentSession.id, { percentage: 100 });
      
      // End token statistics session and get statistics
      const tokenStats = tokenStatisticsService.endSession();
      let tokenStatisticsCSV = '';
      
      if (tokenStats && tokenStats.filesProcessed > 0) {
        console.log('📊 Token statistics collected:', {
          filesProcessed: tokenStats.filesProcessed,
          totalTokens: tokenStats.totalTokens
        });
        
        // Detect user language
        const { detectUserLanguage } = await import('../utils/languageDetector.js');
        const userLang = detectUserLanguage();
        const locale = userLang === 'zh' ? 'zh' : 'en';
        
        // Generate token statistics CSV with user's language
        tokenStatisticsCSV = tokenStatisticsService.generateReport(tokenStats, locale);
      } else {
        console.warn('⚠️ No token statistics collected during this session');
      }
      
      // Collect all defect reports for ZIP packaging
      console.log('📦 Collecting all reports for ZIP packaging...');
      const defectReports = [];
      
      for (const result of allResults) {
        const groupName = result.groupName;
        const batchResults = (result.batches || []).flatMap(batch => batch.results || []);
        
        // Generate CSV content for this group
        const { default: reportGenerationService } = await import('./reportGenerationService.js');
        
        const groupReport = {
          groupName: groupName,
          groupPath: result.groupPath || '.',
          filesScanned: batchResults.length,
          defectsFound: batchResults.reduce((sum, r) => sum + (r.defects?.length || 0), 0),
          defects: batchResults.flatMap(r => r.defects || []),
          fileResults: batchResults.map(r => ({
            file: { path: r.filePath || r.file?.path },
            filePath: r.filePath || r.file?.path,
            defects: r.defects || [],
            hasDefects: (r.defects?.length || 0) > 0
          })),
          totalFiles: batchResults.length,
          totalDefects: batchResults.reduce((sum, r) => sum + (r.defects?.length || 0), 0),
          summary: { bySeverity: {}, byType: {} }
        };
        
        // Convert to DetectionReport format and export as CSV
        const detectionReport = reportGenerationService.convertCodeDetectionReport(groupReport);
        const csvContent = await reportGenerationService.exportReportAsCSV(detectionReport, 'auto');
        
        defectReports.push({
          groupName: groupName,
          csvContent: csvContent,
          filesScanned: groupReport.filesScanned,
          defectsFound: groupReport.defectsFound
        });
        
        console.log(`  ✓ Collected report for: ${groupName}`);
      }
      
      // Generate HTML summary report
      console.log('📄 Generating HTML summary report...');
      const htmlReport = zipPackageService.generateHTMLSummary({
        defectReports: defectReports,
        tokenStats: tokenStats
      });
      
      // Package everything into ZIP and download
      console.log('📦 Packaging all reports into ZIP...');
      
      // Generate timestamp for filename: YYYY-MM-DD_HH-MM-SS
      const now = new Date();
      const timestamp = now.toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_')
        .substring(0, 19);
      
      await zipPackageService.packageAndDownload({
        defectReports: defectReports,
        tokenStatistics: tokenStatisticsCSV,
        htmlReport: htmlReport,
        fileName: `report_${timestamp}`
      });
      
      console.log('✅ ZIP package generated and downloaded successfully');
      
      // Transform allResults to groups format for report generation
      const groupResults = allResults.map(result => {
        const batchResults = (result.batches || []).flatMap(batch => {
          // batch.results should now contain file results with defects
          if (!batch.results || batch.results.length === 0) {
            console.warn(`批次 ${batch.id} 没有结果数据`);
            return [];
          }
          
          return batch.results.map(fileResult => ({
            file: fileResult.filePath || fileResult.file?.path,
            filePath: fileResult.filePath || fileResult.file?.path,
            defects: fileResult.defects || []
          }));
        });
        
        console.log(`分组 ${result.groupName}: ${batchResults.length} 个文件结果`);
        
        return {
          name: result.groupName,
          path: result.groupPath,
          results: batchResults
        };
      });
      
      // Save group results to session
      this.currentSession.groups = groupResults;
      SessionStorage.save(this.currentSession);
      
      this.currentSession = SessionStorage.load(this.currentSession.id);
      this.notifyStatusChange(SessionStatus.COMPLETED);
      
      // Stop resource monitoring
      resourceMonitorService.stopMonitoring();
      
      // Log resource statistics
      const memoryStats = resourceMonitorService.getMemoryStats();
      console.log('资源使用统计:', memoryStats);
      
      console.log('检测完成，分组数:', groupResults.length);
      
      return this.currentSession;

    } catch (error) {
      console.error('检测过程中发生错误:', error);
      
      // Stop resource monitoring
      resourceMonitorService.stopMonitoring();
      
      // End token statistics session (even on error)
      const tokenStats = tokenStatisticsService.endSession();
      let tokenStatisticsCSV = '';
      
      if (tokenStats && tokenStats.filesProcessed > 0) {
        console.log('📊 Token statistics collected (partial):', {
          filesProcessed: tokenStats.filesProcessed,
          totalTokens: tokenStats.totalTokens
        });
        
        // Detect user language
        const { detectUserLanguage } = await import('../utils/languageDetector.js');
        const userLang = detectUserLanguage();
        const locale = userLang === 'zh' ? 'zh' : 'en';
        
        // Generate token statistics CSV with user's language
        tokenStatisticsCSV = tokenStatisticsService.generateReport(tokenStats, locale);
        
        // Try to package partial results into ZIP
        try {
          console.log('📦 Packaging partial results into ZIP...');
          const defectReports = [];
          
          // Collect whatever reports we have
          for (const result of allResults || []) {
            const groupName = result.groupName;
            const batchResults = (result.batches || []).flatMap(batch => batch.results || []);
            
            if (batchResults.length > 0) {
              const { default: reportGenerationService } = await import('./reportGenerationService.js');
              
              const groupReport = {
                groupName: groupName,
                groupPath: result.groupPath || '.',
                filesScanned: batchResults.length,
                defectsFound: batchResults.reduce((sum, r) => sum + (r.defects?.length || 0), 0),
                defects: batchResults.flatMap(r => r.defects || []),
                fileResults: batchResults.map(r => ({
                  file: { path: r.filePath || r.file?.path },
                  filePath: r.filePath || r.file?.path,
                  defects: r.defects || [],
                  hasDefects: (r.defects?.length || 0) > 0
                })),
                totalFiles: batchResults.length,
                totalDefects: batchResults.reduce((sum, r) => sum + (r.defects?.length || 0), 0),
                summary: { bySeverity: {}, byType: {} }
              };
              
              const detectionReport = reportGenerationService.convertCodeDetectionReport(groupReport);
              const csvContent = await reportGenerationService.exportReportAsCSV(detectionReport, 'auto');
              
              defectReports.push({
                groupName: groupName,
                csvContent: csvContent,
                filesScanned: groupReport.filesScanned,
                defectsFound: groupReport.defectsFound
              });
            }
          }
          
          if (defectReports.length > 0 || tokenStatisticsCSV) {
            const htmlReport = zipPackageService.generateHTMLSummary({
              defectReports: defectReports,
              tokenStats: tokenStats
            });
            
            // Generate timestamp for partial report filename
            const now = new Date();
            const timestamp = now.toISOString()
              .replace(/[:.]/g, '-')
              .replace('T', '_')
              .substring(0, 19);
            
            await zipPackageService.packageAndDownload({
              defectReports: defectReports,
              tokenStatistics: tokenStatisticsCSV,
              htmlReport: htmlReport,
              fileName: `report_${timestamp}_partial`
            });
            
            console.log('✅ Partial ZIP package generated');
          }
        } catch (zipError) {
          console.error('❌ Failed to generate partial ZIP:', zipError);
        }
      }
      
      // 检查是否是用户取消
      if (this.isCancelled || error.message.includes('取消')) {
        console.log('检测被用户取消');
        SessionStorage.updateStatus(this.currentSession.id, SessionStatus.CANCELLED, '用户取消了检测');
        this.currentSession = SessionStorage.load(this.currentSession.id);
        this.notifyStatusChange(SessionStatus.CANCELLED);
        
        // 不抛出错误，正常返回
        return this.currentSession;
      }
      
      SessionStorage.updateStatus(this.currentSession.id, SessionStatus.FAILED, error.message);
      this.currentSession = SessionStorage.load(this.currentSession.id);
      this.notifyStatusChange(SessionStatus.FAILED);
      
      throw error;
    }
  }

  /**
   * Process a single group
   * @param {Object} group - File group
   * @param {FileSystemDirectoryHandle} directoryHandle - Directory handle
   * @param {Function} [onReportGenerated] - Report callback
   * @returns {Promise<Object>} - Group result
   */
  async processGroup(group, directoryHandle, onReportGenerated) {
    const { name, path, files } = group;
    
    // Create batches with pairing logic
    const batches = this.batchProcessor.createBatches(files);
    console.log(`创建了 ${batches.length} 个批次`);

    // Update session with batch info
    SessionStorage.updateProgress(this.currentSession.id, {
      totalBatches: batches.length,
      currentBatch: 0
    });

    // Process batches
    const processedBatches = await this.batchProcessor.processAllBatches(
      batches,
      async (file) => {
        // 检查是否已取消
        if (this.isCancelled) {
          console.log('❌ 文件处理时检测到取消标志');
          console.log('文件:', file.path);
          console.log('取消时间:', new Date().toISOString());
          throw new Error('检测已被用户取消');
        }
        
        // Update progress
        SessionStorage.updateProgress(this.currentSession.id, {
          currentFile: file.name
        });
        this.currentSession = SessionStorage.load(this.currentSession.id);
        this.notifyProgress();
        
        // Detect defects in file
        let defects = [];
        try {
          // Get projectType from config
          const projectType = this.currentSession.config.projectType;
          if (!projectType) {
            throw new Error('Project type is required for detection');
          }
          
          defects = await detectDefectsInFile(file, directoryHandle, projectType);
          
          // Track processed file
          SessionStorage.addProcessedFile(this.currentSession.id, {
            path: file.path,
            name: file.name,
            defectsFound: defects.length
          });
        } catch (error) {
          console.error(`处理文件 ${file.name} 失败:`, error);
          
          // Track failed file
          SessionStorage.addFailedFile(this.currentSession.id, {
            path: file.path,
            name: file.name,
            error: error.message
          });
        }
        
        // Update progress
        this.currentSession = SessionStorage.load(this.currentSession.id);
        this.notifyProgress();
        
        return defects;
      },
      (batchIndex, totalBatches) => {
        console.log(`批次进度: ${batchIndex}/${totalBatches}`);
        SessionStorage.updateProgress(this.currentSession.id, {
          currentBatch: batchIndex
        });
      }
    );

    // Aggregate results
    const aggregated = this.batchProcessor.aggregateResults(processedBatches);
    
    // 注意：报告生成已移至 startDetection 中，在 processGroup 完成后统一处理
    // 这样可以确保每个分组只生成一次报告

    return {
      groupName: name,
      groupPath: path,
      batches: processedBatches,
      aggregated
    };
  }

  /**
   * Pause current detection session
   * @returns {Promise<void>}
   */
  async pauseDetection() {
    if (!this.currentSession || this.currentSession.status !== SessionStatus.RUNNING) {
      throw new Error('没有正在运行的检测会话');
    }

    SessionStorage.updateStatus(this.currentSession.id, SessionStatus.PAUSED);
    this.currentSession = SessionStorage.load(this.currentSession.id);
    this.notifyStatusChange(SessionStatus.PAUSED);
    
    console.log('检测已暂停');
  }

  /**
   * Resume paused detection session
   * @returns {Promise<void>}
   */
  async resumeDetection() {
    if (!this.currentSession || this.currentSession.status !== SessionStatus.PAUSED) {
      throw new Error('没有暂停的检测会话');
    }

    SessionStorage.updateStatus(this.currentSession.id, SessionStatus.RUNNING);
    this.currentSession = SessionStorage.load(this.currentSession.id);
    this.notifyStatusChange(SessionStatus.RUNNING);
    
    console.log('检测已恢复');
    
    // Continue from where it left off
    // This would require more complex state management
    // For now, just update status
  }

  /**
   * Cancel current detection session
   * @returns {Promise<void>}
   */
  async cancelDetection() {
    // 🔍 调试：记录调用栈
    console.log('🛑🛑🛑 detectionOrchestrator.cancelDetection() 被调用');
    console.trace('调用栈:');
    console.log('当前时间:', new Date().toISOString());
    console.log('当前会话:', this.currentSession?.id);
    console.log('isCancelled 当前值:', this.isCancelled);
    
    if (!this.currentSession) {
      throw new Error('没有活动的检测会话');
    }

    // 设置取消标志
    this.isCancelled = true;
    console.log('✅ 设置取消标志为 true，检测将在下一个检查点停止');

    SessionStorage.updateStatus(this.currentSession.id, SessionStatus.CANCELLED);
    this.currentSession = SessionStorage.load(this.currentSession.id);
    this.notifyStatusChange(SessionStatus.CANCELLED);
    
    // Stop resource monitoring
    resourceMonitorService.stopMonitoring();
    
    console.log('检测已取消');
  }

  /**
   * Get current session status
   * @returns {DetectionSession|null} - Current session or null
   */
  getCurrentSession() {
    return this.currentSession;
  }

  /**
   * Get session progress
   * @returns {Object|null} - Progress information or null
   */
  getProgress() {
    return this.currentSession ? this.currentSession.progress : null;
  }

  /**
   * Generate session ID
   * @returns {string} - Session ID
   */
  generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Notify progress callbacks
   */
  notifyProgress() {
    if (this.currentSession) {
      for (const callback of this.progressCallbacks) {
        try {
          callback(this.currentSession.progress);
        } catch (error) {
          console.error('进度回调错误:', error);
        }
      }
    }
  }

  /**
   * Notify status change callbacks
   * @param {string} status - New status
   */
  notifyStatusChange(status) {
    for (const callback of this.statusCallbacks) {
      try {
        callback(status, this.currentSession);
      } catch (error) {
        console.error('状态变更回调错误:', error);
      }
    }
  }

  /**
   * Clear callbacks
   */
  clearCallbacks() {
    this.progressCallbacks = [];
    this.statusCallbacks = [];
  }

  /**
   * Load incomplete sessions
   * @returns {Promise<DetectionSession[]>} - Incomplete sessions
   */
  async loadIncompleteSessions() {
    return SessionStorage.getIncompleteSessions();
  }

  /**
   * Resume from incomplete session
   * @param {string} sessionId - Session ID to resume
   * @param {Object} options - Resume options
   * @returns {Promise<DetectionSession>} - Resumed session
   */
  async resumeFromSession(sessionId, options) {
    const session = SessionStorage.load(sessionId);
    
    if (!session) {
      throw new Error('会话不存在');
    }

    // Set as current session
    this.currentSession = session;
    
    // Update status to running
    SessionStorage.updateStatus(sessionId, SessionStatus.RUNNING);
    this.currentSession = SessionStorage.load(sessionId);

    // Register callbacks
    if (options.onProgress) {
      this.progressCallbacks.push(options.onProgress);
    }
    if (options.onStatusChange) {
      this.statusCallbacks.push(options.onStatusChange);
    }

    this.notifyStatusChange(SessionStatus.RUNNING);

    // Start resource monitoring
    resourceMonitorService.startMonitoring((warning) => {
      console.warn(`资源警告 [${warning.level}]: ${warning.message}`);
      
      if (warning.level === 'critical' && this.batchProcessor) {
        const newBatchSize = this.batchProcessor.adjustBatchSizeDynamic({
          availableMemory: warning.resourceInfo.availableMemory,
          avgFileSize: session.config.avgFileSize || 50
        });
        console.log(`由于资源限制，批处理大小已调整为: ${newBatchSize}`);
      }
    });

    try {
      // Get processed files list
      const processedFiles = session.results?.processedFilesList || [];
      const processedPaths = new Set(processedFiles.map(f => f.path));

      console.log(`恢复会话 ${sessionId}，已处理 ${processedFiles.length} 个文件`);

      // Scan directory again
      const scanConfig = {
        fileTypes: session.config.fileTypes || ['.h', '.cpp', '.hpp', '.cc', '.cxx'],
        excludePatterns: session.config.excludePatterns || []
      };
      
      const { groups, rootFiles } = await scanDirectoryByGroups(options.directoryHandle, scanConfig);
      
      // Filter out already processed files
      const filterProcessedFiles = (files) => {
        return files.filter(f => !processedPaths.has(f.path));
      };

      const remainingGroups = groups.map(g => ({
        ...g,
        files: filterProcessedFiles(g.files)
      })).filter(g => g.files.length > 0);

      const remainingRootFiles = filterProcessedFiles(rootFiles);

      const remainingTotal = remainingGroups.reduce((sum, g) => sum + g.files.length, 0) + remainingRootFiles.length;

      console.log(`剩余 ${remainingTotal} 个文件待处理`);

      if (remainingTotal === 0) {
        console.log('所有文件已处理完成');
        SessionStorage.updateStatus(sessionId, SessionStatus.COMPLETED);
        SessionStorage.updateProgress(sessionId, { percentage: 100 });
        this.currentSession = SessionStorage.load(sessionId);
        this.notifyStatusChange(SessionStatus.COMPLETED);
        resourceMonitorService.stopMonitoring();
        return this.currentSession;
      }

      // Initialize batch processor with resource-aware configuration
      this.batchProcessor = createBatchProcessor({
        batchSize: session.config.batchSize || 20,
        maxConcurrency: session.config.maxConcurrency || 1
      });

      // Process remaining groups
      for (let i = 0; i < remainingGroups.length; i++) {
        const group = remainingGroups[i];
        console.log(`处理分组 ${i + 1}/${remainingGroups.length}: ${group.name}`);
        
        await this.processGroup(
          group,
          options.directoryHandle,
          options.onReportGenerated
        );
      }

      // Process remaining root files
      if (remainingRootFiles.length > 0) {
        console.log(`处理根目录文件: ${remainingRootFiles.length} 个`);
        const rootResult = await this.processGroup(
          { name: 'root', path: '.', files: remainingRootFiles },
          options.directoryHandle,
          options.onReportGenerated
        );
        
        // 立即生成并保存根目录文件的报告
        if (options.onReportGenerated) {
          const groupReport = {
            groupName: 'root',
            groupPath: '.',
            filesScanned: remainingRootFiles.length,
            defectsFound: 0,  // 从 rootResult 中计算
            batches: rootResult.batches,
            sessionId: sessionId,
            timestamp: Date.now(),
            createdAt: new Date().toISOString(),
            status: 'completed'
          };
          
          // 计算缺陷数
          const batchResults = (rootResult.batches || []).flatMap(batch => batch.results || []);
          groupReport.defectsFound = batchResults.reduce((sum, r) => sum + (r.defects?.length || 0), 0);
          groupReport.defects = batchResults.flatMap(r => r.defects || []);
          groupReport.results = batchResults.map(r => ({
            file: r.filePath || r.file?.path,
            filePath: r.filePath || r.file?.path,
            defects: r.defects || []
          }));
          
          console.log(`✅ 根目录文件检测完成，立即生成报告`);
          options.onReportGenerated(groupReport);
        }
      }

      // Complete session
      SessionStorage.updateStatus(sessionId, SessionStatus.COMPLETED);
      SessionStorage.updateProgress(sessionId, { percentage: 100 });
      this.currentSession = SessionStorage.load(sessionId);
      this.notifyStatusChange(SessionStatus.COMPLETED);
      
      // Stop resource monitoring
      resourceMonitorService.stopMonitoring();
      
      // Log resource statistics
      const memoryStats = resourceMonitorService.getMemoryStats();
      console.log('资源使用统计:', memoryStats);
      
      console.log('恢复的检测完成');
      
      return this.currentSession;

    } catch (error) {
      console.error('恢复检测过程中发生错误:', error);
      
      // Stop resource monitoring
      resourceMonitorService.stopMonitoring();
      
      SessionStorage.updateStatus(sessionId, SessionStatus.FAILED, error.message);
      this.currentSession = SessionStorage.load(sessionId);
      this.notifyStatusChange(SessionStatus.FAILED);
      
      throw error;
    }
  }

  /**
   * Get session by ID
   * @param {string} sessionId - Session ID
   * @returns {Object|null} - Session or null
   */
  getSession(sessionId) {
    return SessionStorage.load(sessionId);
  }

  /**
   * Delete session by ID
   * @param {string} sessionId - Session ID
   * @returns {boolean} - Success status
   */
  deleteSession(sessionId) {
    return SessionStorage.delete(sessionId);
  }

  /**
   * Get session statistics
   * @returns {Object} - Session statistics
   */
  getSessionStats() {
    return SessionStorage.getStats();
  }

  /**
   * Cleanup old sessions
   * @returns {Object} - Cleanup results
   */
  cleanupOldSessions() {
    return SessionStorage.cleanupOldSessions();
  }
}

// Export singleton instance
export const detectionOrchestrator = new DetectionOrchestratorImpl();

// Export factory function
export const createDetectionOrchestrator = () => {
  return new DetectionOrchestratorImpl();
};

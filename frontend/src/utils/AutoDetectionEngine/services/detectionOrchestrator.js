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
 * Session status enum
 * @enum {string}
 */
export const SessionStatus = {
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

/**
 * Detection Orchestrator Implementation
 */
class DetectionOrchestratorImpl {
  constructor() {
    this.currentSession = null;
    this.batchProcessor = null;
    this.progressCallbacks = [];
    this.statusCallbacks = [];
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
    const { directoryHandle, config, onProgress, onStatusChange, onReportGenerated, resumeFromLast = false } = options;

    // Check if there's already an active session
    const activeSession = SessionStorage.getActiveSession();
    if (activeSession) {
      throw new Error('检测会话已在运行中');
    }

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

      // Process groups
      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        console.log(`处理分组 ${i + 1}/${groups.length}: ${group.name}`);
        
        const groupResult = await this.processGroup(
          group,
          directoryHandle,
          onReportGenerated
        );
        
        allResults.push(groupResult);
      }

      // Process root files if any
      if (rootFiles.length > 0) {
        console.log(`处理根目录文件: ${rootFiles.length} 个`);
        const rootResult = await this.processGroup(
          { name: 'root', path: '.', files: rootFiles },
          directoryHandle,
          onReportGenerated
        );
        allResults.push(rootResult);
      }

      // Step 3: Complete session
      SessionStorage.updateStatus(this.currentSession.id, SessionStatus.COMPLETED);
      SessionStorage.updateProgress(this.currentSession.id, { percentage: 100 });
      
      this.currentSession = SessionStorage.load(this.currentSession.id);
      this.notifyStatusChange(SessionStatus.COMPLETED);
      
      // Stop resource monitoring
      resourceMonitorService.stopMonitoring();
      
      // Log resource statistics
      const memoryStats = resourceMonitorService.getMemoryStats();
      console.log('资源使用统计:', memoryStats);
      
      console.log('检测完成');
      
      return this.currentSession;

    } catch (error) {
      console.error('检测过程中发生错误:', error);
      
      // Stop resource monitoring
      resourceMonitorService.stopMonitoring();
      
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
        // Update progress
        SessionStorage.updateProgress(this.currentSession.id, {
          currentFile: file.name
        });
        this.currentSession = SessionStorage.load(this.currentSession.id);
        this.notifyProgress();
        
        // Detect defects in file
        let defects = [];
        try {
          defects = await detectDefectsInFile(file, directoryHandle);
          
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
    
    // Generate report for this group
    if (onReportGenerated) {
      const report = {
        groupName: name,
        groupPath: path,
        filesScanned: files.length,
        defectsFound: 0, // Will be calculated from actual defects
        batches: processedBatches,
        aggregated
      };
      
      onReportGenerated(report);
    }

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
    if (!this.currentSession) {
      throw new Error('没有活动的检测会话');
    }

    SessionStorage.updateStatus(this.currentSession.id, SessionStatus.CANCELLED);
    this.currentSession = SessionStorage.load(this.currentSession.id);
    this.notifyStatusChange(SessionStatus.CANCELLED);
    
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
        await this.processGroup(
          { name: 'root', path: '.', files: remainingRootFiles },
          options.directoryHandle,
          options.onReportGenerated
        );
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

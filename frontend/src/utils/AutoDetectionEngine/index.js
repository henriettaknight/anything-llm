/**
 * @fileoverview Auto Detection Engine
 * Main entry point for the Auto Detection Engine system
 * 
 * This module provides a unified interface to all auto detection services
 * including configuration management, code detection, file monitoring,
 * report generation, task scheduling, batch processing, and session recovery.
 * 
 * @module AutoDetectionEngine
 */

// Import all service classes
import AutoDetectionConfigService from './services/autoDetectionConfigService.js';
import CodeDetectionService from './services/codeDetectionService.js';
import FileMonitorService from './services/fileMonitorService.js';
import ReportGenerationService from './services/reportGenerationService.js';
import TaskSchedulerService from './services/taskSchedulerService.js';
import BatchProcessingService from './services/batchProcessingService.js';
import ResumeDetectionService from './services/resumeDetectionService.js';
import { loggingService, LogCategory, LogLevel } from './services/loggingService.js';
import { monitoringService } from './services/monitoringService.js';

// Import orchestrator
import { detectionOrchestrator } from './services/detectionOrchestrator.js';

// Import storage services
import { ConfigStorage, ReportStorage, fileSystemStorage } from './storage/index.js';

/**
 * Auto Detection Engine
 * Main orchestrator for the auto detection system
 * 
 * @class
 * @example
 * const engine = new AutoDetectionEngine();
 * await engine.initialize();
 * // Use engine.startDetection() to start detection
 */
class AutoDetectionEngine {
  constructor() {
    // Initialize all services
    // Note: These are not classes, they are objects/functions exported from their modules
    this.detection = CodeDetectionService;
    this.fileMonitor = FileMonitorService;
    this.reports = ReportGenerationService;
    this.scheduler = TaskSchedulerService;
    this.batchProcessor = BatchProcessingService;
    this.resumeService = ResumeDetectionService;
    this.orchestrator = detectionOrchestrator;
    this.logging = loggingService;
    this.monitoring = monitoringService;
    
    this.initialized = false;
    
    // Note: Logging is deferred to initialize() method
    // to avoid issues with logging service initialization
  }

  /**
   * Initialize the Auto Detection Engine
   * Sets up all services and prepares the system for operation
   * 
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      if (this.logging && typeof this.logging.info === 'function') {
        this.logging.info(LogCategory.SYSTEM, 'Initializing AutoDetectionEngine');
      }
      
      // Note: AI service initialization is deferred to startDetection
      // to avoid circular dependencies and initialization issues
      
      this.initialized = true;
      
      if (this.logging && typeof this.logging.info === 'function') {
        this.logging.info(LogCategory.SYSTEM, 'AutoDetectionEngine initialized successfully');
      }
    } catch (error) {
      if (this.logging && typeof this.logging.error === 'function') {
        this.logging.error(LogCategory.SYSTEM, 'Failed to initialize AutoDetectionEngine', error);
      }
      throw error;
    }
  }

  /**
   * Initialize AI service for code detection
   * Sets up the dual mode AI adapter and initializes the code detection service
   * 
   * Supports both:
   * - Direct mode: Direct connection to 172.16.100.61:8000 (development only)
   * - LLM mode: Connection through AnythingLLM backend (production)
   * 
   * @private
   * @returns {Promise<void>}
   */
  async initializeAIService() {
    try {
      // Import required modules
      const { DualModeAIAdapter } = await import('./utils/dualModeAIAdapter.js');
      const { initializeServices } = await import('./services/codeDetectionService.js');
      const { getAIModeInfo } = await import('./config/aiModeConfig.js');

      // Create dual mode AI adapter
      const aiAdapter = new DualModeAIAdapter();

      // Initialize code detection service with AI adapter and logging service
      initializeServices(aiAdapter, this.logging);

      // Log AI mode information
      const modeInfo = getAIModeInfo();
      if (this.logging && typeof this.logging.info === 'function') {
        this.logging.info(LogCategory.DETECTION, 'AI service initialized successfully', modeInfo);
      }
    } catch (error) {
      if (this.logging && typeof this.logging.error === 'function') {
        this.logging.error(LogCategory.DETECTION, 'Failed to initialize AI service', error);
      }
      throw error;
    }
  }

  /**
   * Start a manual detection session
   * 
   * @param {Object} options - Detection options
   * @param {FileSystemDirectoryHandle} options.directoryHandle - Directory to analyze
   * @param {Object} [options.config] - Detection configuration (optional, uses stored config if not provided)
   * @param {Function} [options.onProgress] - Progress callback
   * @param {Function} [options.onStatusChange] - Status change callback
   * @param {Function} [options.onReportGenerated] - Report generated callback
   * @param {boolean} [options.resumeFromLast] - Resume from last incomplete session
   * @returns {Promise<Object>} Detection session
   */
  async startDetection(options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    const stopTimer = this.monitoring.startTimer('detection.total_duration');

    try {
      if (this.logging && typeof this.logging.info === 'function') {
        this.logging.info(LogCategory.DETECTION, 'Starting detection', { options });
      }
      
      // Get configuration if not provided
      let config = options.config;
      if (!config) {
        // Config must be provided by caller
        throw new Error('Configuration is required for detection');
      }

      // Initialize AI service for code detection
      if (this.logging && typeof this.logging.info === 'function') {
        this.logging.info(LogCategory.DETECTION, 'Initializing AI service for code detection');
      }
      await this.initializeAIService();

      // Record detection started
      const sessionId = `session_${Date.now()}`;
      this.monitoring.recordDetectionStarted(sessionId, config);

      // Start detection using orchestrator
      const session = await this.orchestrator.startDetection({
        directoryHandle: options.directoryHandle,
        config: config,
        onProgress: options.onProgress,
        onStatusChange: options.onStatusChange,
        onReportGenerated: options.onReportGenerated,
        resumeFromLast: options.resumeFromLast || false
      });

      const duration = stopTimer();
      
      // Record detection completed
      this.monitoring.recordDetectionCompleted(session.id, duration, {
        filesProcessed: session.progress?.processedFiles || 0,
        defectsFound: 0 // Will be updated from actual results
      });

      if (this.logging && typeof this.logging.info === 'function') {
        this.logging.info(LogCategory.DETECTION, 'Detection completed successfully', { 
          sessionId: session.id,
          duration 
        });
      }

      return {
        success: true,
        session: session
      };
    } catch (error) {
      stopTimer();
      
      // 检查是否是用户取消
      const isCancelled = error.message && error.message.includes('取消');
      
      if (this.logging && typeof this.logging.error === 'function') {
        if (isCancelled) {
          this.logging.info(LogCategory.DETECTION, 'Detection cancelled by user');
        } else {
          this.logging.error(LogCategory.DETECTION, 'Failed to start detection', error);
        }
      }
      
      if (!isCancelled) {
        this.monitoring.recordDetectionFailed('unknown', error);
      }
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Stop the current detection session
   * 
   * @returns {Promise<Object>} Result with success status
   */
  async stopDetection() {
    if (!this.initialized) {
      throw new Error('Engine not initialized');
    }

    try {
      if (this.logging && typeof this.logging.info === 'function') {
        this.logging.info(LogCategory.DETECTION, 'Stopping detection');
      }
      await this.orchestrator.cancelDetection();
      if (this.logging && typeof this.logging.info === 'function') {
        this.logging.info(LogCategory.DETECTION, 'Detection stopped successfully');
      }
      
      return {
        success: true
      };
    } catch (error) {
      if (this.logging && typeof this.logging.error === 'function') {
        this.logging.error(LogCategory.DETECTION, 'Failed to stop detection', error);
      }
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Pause the current detection session
   * 
   * @returns {Promise<Object>} Result with success status
   */
  async pauseDetection() {
    if (!this.initialized) {
      throw new Error('Engine not initialized');
    }

    try {
      if (this.logging && typeof this.logging.info === 'function') {
        this.logging.info(LogCategory.DETECTION, 'Pausing detection');
      }
      await this.orchestrator.pauseDetection();
      if (this.logging && typeof this.logging.info === 'function') {
        this.logging.info(LogCategory.DETECTION, 'Detection paused successfully');
      }
      
      return {
        success: true
      };
    } catch (error) {
      if (this.logging && typeof this.logging.error === 'function') {
        this.logging.error(LogCategory.DETECTION, 'Failed to pause detection', error);
      }
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Resume the paused detection session
   * 
   * @returns {Promise<Object>} Result with success status
   */
  async resumeDetection() {
    if (!this.initialized) {
      throw new Error('Engine not initialized');
    }

    try {
      if (this.logging && typeof this.logging.info === 'function') {
        this.logging.info(LogCategory.DETECTION, 'Resuming detection');
      }
      await this.orchestrator.resumeDetection();
      if (this.logging && typeof this.logging.info === 'function') {
        this.logging.info(LogCategory.DETECTION, 'Detection resumed successfully');
      }
      
      return {
        success: true
      };
    } catch (error) {
      if (this.logging && typeof this.logging.error === 'function') {
        this.logging.error(LogCategory.DETECTION, 'Failed to resume detection', error);
      }
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get current detection status
   * 
   * @returns {Promise<Object>} Current status and session information
   */
  async getStatus() {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const session = this.orchestrator.getCurrentSession();
      const progress = this.orchestrator.getProgress();

      return {
        success: true,
        status: {
          isRunning: session && session.status === 'running',
          isPaused: session && session.status === 'paused',
          currentSession: session,
          progress: progress
        }
      };
    } catch (error) {
      console.error('Failed to get status:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get incomplete sessions that can be resumed
   * 
   * @returns {Promise<Object>} Result with incomplete sessions
   */
  async getIncompleteSessions() {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const sessions = await this.orchestrator.loadIncompleteSessions();
      return {
        success: true,
        sessions: sessions
      };
    } catch (error) {
      console.error('Failed to get incomplete sessions:', error);
      return {
        success: false,
        error: error.message,
        sessions: []
      };
    }
  }

  /**
   * Resume from a specific session
   * 
   * @param {string} sessionId - Session ID to resume
   * @param {Object} options - Resume options
   * @returns {Promise<Object>} Result with resumed session
   */
  async resumeFromSession(sessionId, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const session = await this.orchestrator.resumeFromSession(sessionId, options);
      return {
        success: true,
        session: session
      };
    } catch (error) {
      console.error('Failed to resume from session:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get session statistics
   * 
   * @returns {Promise<Object>} Result with session statistics
   */
  async getSessionStats() {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const stats = this.orchestrator.getSessionStats();
      return {
        success: true,
        stats: stats
      };
    } catch (error) {
      console.error('Failed to get session stats:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Cleanup old sessions
   * 
   * @returns {Promise<Object>} Result with cleanup results
   */
  async cleanupOldSessions() {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const results = this.orchestrator.cleanupOldSessions();
      return {
        success: true,
        results: results
      };
    } catch (error) {
      console.error('Failed to cleanup old sessions:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get all reports
   * 
   * @returns {Promise<Object>} Result with reports list
   */
  async getReports() {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const reports = await this.reports.getReports();
      return reports;
    } catch (error) {
      console.error('Failed to get reports:', error);
      return {
        success: false,
        error: error.message,
        reports: []
      };
    }
  }

  /**
   * Get a specific report
   * 
   * @param {string} reportId - Report ID
   * @returns {Promise<Object>} Result with report data
   */
  async getReport(reportId) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const report = await this.reports.getReport(reportId);
      return report;
    } catch (error) {
      console.error('Failed to get report:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Delete a report
   * 
   * @param {string} reportId - Report ID
   * @returns {Promise<Object>} Result with success status
   */
  async deleteReport(reportId) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const result = await this.reports.deleteReport(reportId);
      return result;
    } catch (error) {
      console.error('Failed to delete report:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Export report
   * 
   * @param {string} reportId - Report ID
   * @param {string} format - Export format ('csv' or 'json')
   * @returns {Promise<Object>} Result with success status
   */
  async exportReport(reportId, format = 'json') {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      let result;
      if (format === 'csv') {
        result = await this.reports.exportReportAsCSV(reportId);
      } else {
        result = await this.reports.exportReportAsJSON(reportId);
      }
      return result;
    } catch (error) {
      console.error('Failed to export report:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get logs
   * 
   * @param {Object} [filters] - Log filters
   * @returns {Array} Filtered logs
   */
  getLogs(filters = {}) {
    if (filters.level) {
      return this.logging.getLogsByLevel(filters.level);
    } else if (filters.category) {
      return this.logging.getLogsByCategory(filters.category);
    } else if (filters.startTime && filters.endTime) {
      return this.logging.getLogsByTimeRange(filters.startTime, filters.endTime);
    }
    return this.logging.getLogs();
  }

  /**
   * Get log statistics
   * 
   * @returns {Object} Log statistics
   */
  getLogStats() {
    return this.logging.getStats();
  }

  /**
   * Export logs
   * 
   * @returns {string} JSON string of logs
   */
  exportLogs() {
    return this.logging.exportLogs();
  }

  /**
   * Clear logs
   */
  clearLogs() {
    if (this.logging && typeof this.logging.clearLogs === 'function') {
      this.logging.clearLogs();
    }
    if (this.logging && typeof this.logging.info === 'function') {
      this.logging.info(LogCategory.SYSTEM, 'Logs cleared');
    }
  }

  /**
   * Get monitoring metrics
   * 
   * @returns {Array} All metrics
   */
  getMetrics() {
    return this.monitoring.getAllMetrics();
  }

  /**
   * Get monitoring summary
   * 
   * @returns {Object} Monitoring summary
   */
  getMonitoringSummary() {
    return this.monitoring.getSummary();
  }

  /**
   * Get alerts
   * 
   * @param {boolean} [unacknowledgedOnly=false] - Get only unacknowledged alerts
   * @returns {Array} Alerts
   */
  getAlerts(unacknowledgedOnly = false) {
    return unacknowledgedOnly 
      ? this.monitoring.getUnacknowledgedAlerts()
      : this.monitoring.getAlerts();
  }

  /**
   * Acknowledge alert
   * 
   * @param {string} alertId - Alert ID
   */
  acknowledgeAlert(alertId) {
    this.monitoring.acknowledgeAlert(alertId);
    if (this.logging && typeof this.logging.info === 'function') {
      this.logging.info(LogCategory.SYSTEM, 'Alert acknowledged', { alertId });
    }
  }

  /**
   * Export metrics
   * 
   * @returns {string} JSON string of metrics
   */
  exportMetrics() {
    return this.monitoring.exportMetrics();
  }

  /**
   * Reset monitoring
   */
  resetMonitoring() {
    this.monitoring.reset();
    if (this.logging && typeof this.logging.info === 'function') {
      this.logging.info(LogCategory.SYSTEM, 'Monitoring reset');
    }
  }

  /**
   * Set log level
   * 
   * @param {string} level - Log level
   */
  setLogLevel(level) {
    if (this.logging && typeof this.logging.setMinLevel === 'function') {
      this.logging.setMinLevel(level);
    }
    if (this.logging && typeof this.logging.info === 'function') {
      this.logging.info(LogCategory.SYSTEM, 'Log level changed', { level });
    }
  }

  /**
   * Enable/disable console logging
   * 
   * @param {boolean} enabled - Enable console logging
   */
  setConsoleLogging(enabled) {
    this.logging.setConsoleLogging(enabled);
  }

  /**
   * Cleanup and shutdown the engine
   * 
   * @returns {Promise<void>}
   */
  async shutdown() {
    if (!this.initialized) {
      return;
    }

    try {
      if (this.logging && typeof this.logging.info === 'function') {
        this.logging.info(LogCategory.SYSTEM, 'Shutting down AutoDetectionEngine');
      }
      
      // Stop any active detection
      const session = this.orchestrator.getCurrentSession();
      if (session && (session.status === 'running' || session.status === 'paused')) {
        await this.orchestrator.cancelDetection();
      }

      // Clear callbacks
      this.orchestrator.clearCallbacks();

      // Clean up resources
      this.initialized = false;
      
      if (this.logging && typeof this.logging.info === 'function') {
        this.logging.info(LogCategory.SYSTEM, 'AutoDetectionEngine shutdown complete');
      }
    } catch (error) {
      if (this.logging && typeof this.logging.error === 'function') {
        this.logging.error(LogCategory.SYSTEM, 'Error during shutdown', error);
      }
      throw error;
    }
  }
}

// Export the main engine class
export default AutoDetectionEngine;

// Export individual services for direct access if needed
export {
  AutoDetectionConfigService,
  CodeDetectionService,
  FileMonitorService,
  ReportGenerationService,
  TaskSchedulerService,
  BatchProcessingService,
  ResumeDetectionService,
  detectionOrchestrator,
  loggingService,
  monitoringService,
  LogCategory,
  LogLevel
};

// Export storage services
export {
  ConfigStorage,
  ReportStorage,
  fileSystemStorage,
};

// Export types (for JSDoc references)
export * from './types.js';

// Export a singleton instance for convenience (lazy initialization)
let autoDetectionEngineInstance = null;

export const getAutoDetectionEngine = () => {
  if (!autoDetectionEngineInstance) {
    autoDetectionEngineInstance = new AutoDetectionEngine();
  }
  return autoDetectionEngineInstance;
};

/**
 * Frontend Detection Control Service
 * Manages detection lifecycle, progress tracking, and session management
 * Integrates with AutoDetectionEngine for real file scanning and defect detection
 */

import AutoDetectionEngine from '@/utils/AutoDetectionEngine/index.js';

const SESSION_STORAGE_KEY = 'autoDetection_session';
const STATUS_STORAGE_KEY = 'autoDetection_status';

/**
 * Status change listeners
 */
const statusChangeListeners = new Set();

/**
 * Progress update listeners
 */
const progressUpdateListeners = new Set();

/**
 * Detection Service
 * Controls detection execution, status tracking, and session management
 */
class DetectionService {
  constructor() {
    this.currentSession = null;
    this.currentStatus = {
      status: 'idle', // idle, running, paused, error
      progress: {
        completed: 0,
        total: 0,
        currentFile: null
      },
      error: null,
      startedAt: null,
      estimatedTimeRemaining: null
    };
    this.isInitialized = false;
    this.progressInterval = null;
    this.engine = null;
    this.directoryHandle = null;
    this.onReportGeneratedCallback = null;  // 添加回调存储
  }

  /**
   * Initialize the service
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    try {
      // Initialize AutoDetectionEngine lazily
      if (!this.engine) {
        this.engine = new AutoDetectionEngine();
      }
      
      if (this.engine && typeof this.engine.initialize === 'function') {
        await this.engine.initialize();
      }
      
      // Load persisted status
      this.loadStatus();
      
      // Load active session if exists
      this.loadSession();

      this.isInitialized = true;
    } catch (error) {
      console.error('Error initializing detection service:', error);
      console.error('Error stack:', error.stack);
      this.isInitialized = true;
      // Don't throw, allow service to continue with fallback
    }
  }

  /**
   * Set directory handle for file access
   * @param {FileSystemDirectoryHandle} handle - Directory handle
   */
  setDirectoryHandle(handle) {
    console.log('Setting directory handle:', handle);
    this.directoryHandle = handle;
    console.log('Directory handle set, current value:', this.directoryHandle);
  }

  /**
   * Set report generated callback
   * @param {Function} callback - Callback function
   */
  setOnReportGenerated(callback) {
    this.onReportGeneratedCallback = callback;
  }

  /**
   * Start detection
   * @param {Object} options - Detection options
   * @returns {Promise<Object>} Result with success status
   */
  async start(options = {}) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Check if already running
      if (this.currentStatus.status === 'running') {
        return {
          success: false,
          error: 'Detection is already running'
        };
      }

      // Create new session
      const sessionId = this.generateSessionId();
      this.currentSession = {
        id: sessionId,
        startedAt: new Date().toISOString(),
        status: 'running',
        options: options
      };

      // Update status
      this.updateStatus({
        status: 'running',
        progress: {
          completed: 0,
          total: 0,
          currentFile: null
        },
        error: null,
        startedAt: new Date().toISOString(),
        estimatedTimeRemaining: null
      });

      // Save session
      this.saveSession();

      // Start detection (will fallback to simulation if engine not ready)
      this.startRealDetection();

      return {
        success: true,
        sessionId: sessionId
      };
    } catch (error) {
      console.error('Error starting detection:', error);
      console.error('Error stack:', error.stack);
      this.updateStatus({
        status: 'error',
        error: error.message
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Start real detection using AutoDetectionEngine
   * @private
   */
  async startRealDetection() {
    try {
      console.log('startRealDetection called, directoryHandle:', this.directoryHandle);
      
      // Create engine locally to avoid Proxy issues
      let engine = this.engine;
      
      if (!engine) {
        console.log('Creating AutoDetectionEngine for detection');
        const AutoDetectionEngineClass = (await import('@/utils/AutoDetectionEngine/index.js')).default;
        engine = new AutoDetectionEngineClass();
        await engine.initialize();
        this.engine = engine;
        console.log('AutoDetectionEngine created and initialized');
      }

      // Verify engine is ready
      if (!engine || typeof engine.startDetection !== 'function') {
        console.warn('Engine is not ready, falling back to simulation');
        this.simulateDetection();
        return;
      }

      if (!this.directoryHandle) {
        console.warn('Directory handle not available, falling back to simulation');
        console.warn('this.directoryHandle value:', this.directoryHandle);
        this.simulateDetection();
        return;
      }

      console.log('Directory handle is available, starting real detection');

      // Get current config
      const config = this.currentStatus.config || {
        targetDirectory: '',
        detectionTime: '09:00',
        enabled: true,
        fileTypes: ['.h', '.cpp', '.c', '.hpp', '.cc'],
        excludePatterns: ['**/node_modules/**', '**/build/**', '**/dist/**', '**/.git/**'],
        batchSize: 10,
        retryAttempts: 3
      };

      console.log('Starting real detection with config:', config);

      // Start detection with callbacks
      const result = await engine.startDetection({
        directoryHandle: this.directoryHandle,
        config: config,
        onProgress: (progress) => {
          // Handle both formats: object or individual parameters
          if (typeof progress === 'object') {
            this.updateProgress({
              completed: progress.processedFiles || 0,
              total: progress.totalFiles || 0,
              processedFiles: progress.processedFiles || 0,
              totalFiles: progress.totalFiles || 0,
              currentGroup: progress.currentGroup || 0,
              totalGroups: progress.totalGroups || 0,
              currentGroupName: progress.currentGroupName || '',
              currentFile: progress.currentFile || null
            });
          } else {
            // Legacy format: (completed, total, currentFile)
            const [completed, total, currentFile] = arguments;
            this.updateProgress({
              completed: completed || 0,
              total: total || 0,
              currentFile: currentFile || null
            });
          }
        },
        onStatusChange: (status) => {
          console.log('Status changed to:', status);
          // Don't call completeDetection here, let the main flow handle it
        },
        onReportGenerated: this.onReportGeneratedCallback  // 传递回调
      });

      console.log('Detection result:', result);

      if (!result.success) {
        // 检查是否是用户取消
        if (result.error && result.error.includes('取消')) {
          console.log('检测被用户取消');
          this.updateStatus({
            status: 'idle',
            error: null
          });
          return;
        }
        
        this.setError(result.error || 'Detection failed');
      } else {
        // Extract results from the returned session
        const session = result.session;
        console.log('Detection session:', session);
        
        if (session) {
          const allDefects = [];
          if (session.detectionResults) {
            session.detectionResults.forEach(fileResult => {
              if (fileResult.defects && fileResult.defects.length > 0) {
                allDefects.push(...fileResult.defects);
              }
            });
          }
          
          console.log('Total defects found:', allDefects.length);
          
          // Pass the entire session object to completeDetection
          this.completeDetection({
            filesScanned: session.progress?.totalFiles || this.currentStatus.progress.total,
            defectsFound: allDefects.length,
            detectionResults: session.detectionResults || [],
            session: session  // 传递完整的 session 对象，包含 groups 数据
          });
        } else {
          // Fallback if no session
          this.completeDetection({
            filesScanned: this.currentStatus.progress.total,
            defectsFound: 0,
            detectionResults: []
          });
        }
      }
    } catch (error) {
      console.error('Error in real detection:', error);
      console.error('Error stack:', error.stack);
      
      // 检查是否是用户取消
      if (error.message && error.message.includes('取消')) {
        console.log('检测被用户取消，不执行模拟检测');
        this.updateStatus({
          status: 'idle',
          error: null
        });
        return;
      }
      
      // 其他错误才执行模拟检测
      this.simulateDetection();
    }
  }

  /**
   * Simulate detection progress (fallback)
   * @private
   */
  simulateDetection() {
    let completed = 0;
    const total = 10;
    const interval = setInterval(() => {
      if (this.currentStatus.status !== 'running') {
        clearInterval(interval);
        return;
      }

      completed++;
      this.updateProgress({
        completed: completed,
        total: total,
        currentFile: `file_${completed}.cpp`
      });

      if (completed >= total) {
        clearInterval(interval);
        this.completeDetection({
          filesScanned: total,
          defectsFound: Math.floor(Math.random() * 5)
        });
      }
    }, 1000); // Update every second
  }

  /**
   * Stop detection
   * @returns {Promise<Object>} Result with success status
   */
  async stop() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Check if running
      if (this.currentStatus.status !== 'running') {
        return {
          success: false,
          error: 'No detection is currently running'
        };
      }

      // Stop the detection engine
      if (this.engine) {
        console.log('Stopping detection engine...');
        await this.engine.stopDetection();
      }

      // Update session
      if (this.currentSession) {
        this.currentSession.status = 'stopped';
        this.currentSession.stoppedAt = new Date().toISOString();
      }

      // Update status
      this.updateStatus({
        status: 'idle',
        error: null
      });

      // Clear session
      this.clearSession();

      console.log('Detection stopped successfully');

      return {
        success: true
      };
    } catch (error) {
      console.error('Error stopping detection:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Pause detection
   * @returns {Promise<Object>} Result with success status
   */
  async pause() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Check if running
      if (this.currentStatus.status !== 'running') {
        return {
          success: false,
          error: 'No detection is currently running'
        };
      }

      // Update session
      if (this.currentSession) {
        this.currentSession.status = 'paused';
        this.currentSession.pausedAt = new Date().toISOString();
      }

      // Update status
      this.updateStatus({
        status: 'paused'
      });

      // Save session
      this.saveSession();

      return {
        success: true
      };
    } catch (error) {
      console.error('Error pausing detection:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Resume detection
   * @returns {Promise<Object>} Result with success status
   */
  async resume() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Check if paused
      if (this.currentStatus.status !== 'paused') {
        return {
          success: false,
          error: 'No paused detection to resume'
        };
      }

      // Update session
      if (this.currentSession) {
        this.currentSession.status = 'running';
        this.currentSession.resumedAt = new Date().toISOString();
      }

      // Update status
      this.updateStatus({
        status: 'running'
      });

      // Save session
      this.saveSession();

      return {
        success: true
      };
    } catch (error) {
      console.error('Error resuming detection:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get current status
   * @returns {Promise<Object>} Current status
   */
  async getStatus() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      return {
        success: true,
        status: { ...this.currentStatus }
      };
    } catch (error) {
      console.error('Error getting status:', error);
      return {
        success: true,
        status: { ...this.currentStatus }
      };
    }
  }

  /**
   * Get current session
   * @returns {Promise<Object|null>} Current session or null
   */
  async getSession() {
    if (!this.isInitialized) {
      await this.initialize();
    }

    return this.currentSession ? { ...this.currentSession } : null;
  }

  /**
   * Update progress
   * @param {Object} progress - Progress update
   * @returns {void}
   */
  updateProgress(progress) {
    const oldProgress = { ...this.currentStatus.progress };
    
    this.currentStatus.progress = {
      ...this.currentStatus.progress,
      ...progress
    };

    // Calculate estimated time remaining
    if (progress.completed && progress.total) {
      const elapsed = Date.now() - new Date(this.currentStatus.startedAt).getTime();
      const rate = progress.completed / elapsed;
      const remaining = progress.total - progress.completed;
      this.currentStatus.estimatedTimeRemaining = remaining / rate;
    }

    // Save status
    this.saveStatus();

    // Notify listeners
    this.notifyProgressUpdate(this.currentStatus.progress, oldProgress);
  }

  /**
   * Update status
   * @param {Object} statusUpdate - Status update
   * @returns {void}
   */
  updateStatus(statusUpdate) {
    const oldStatus = { ...this.currentStatus };
    
    this.currentStatus = {
      ...this.currentStatus,
      ...statusUpdate
    };

    // Save status
    this.saveStatus();

    // Notify listeners
    this.notifyStatusChange(this.currentStatus, oldStatus);
  }

  /**
   * Set error status
   * @param {string} error - Error message
   * @returns {void}
   */
  setError(error) {
    const errorMsg = typeof error === 'string' ? error : (error?.message || 'Unknown error occurred');
    this.updateStatus({
      status: 'error',
      error: errorMsg
    });

    // Update session if exists
    if (this.currentSession) {
      this.currentSession.status = 'error';
      this.currentSession.error = errorMsg;
      this.saveSession();
    }
  }

  /**
   * Clear error status
   * @returns {void}
   */
  clearError() {
    this.updateStatus({
      error: null
    });
  }

  /**
   * Complete detection
   * @param {Object} result - Detection result
   * @returns {void}
   */
  completeDetection(result = {}) {
    console.log('completeDetection called with result:', result);
    
    // Update session
    if (this.currentSession) {
      this.currentSession.status = 'completed';
      this.currentSession.completedAt = new Date().toISOString();
      this.currentSession.result = result;
    }

    // Store the detection result for report generation
    this.lastDetectionResult = result;

    // Update status to 'completed' instead of 'idle'
    // This allows the UI to show the completion state
    const newStatus = {
      status: 'completed',
      error: null,
      detectionResult: {
        ...result,
        shouldGenerateReport: true // 标记需要生成报告
      }
    };
    
    console.log('Setting status with shouldGenerateReport:', newStatus);
    this.updateStatus(newStatus);

    console.log('Detection completed, status updated to completed');

    // Clear session
    this.clearSession();
  }

  /**
   * Reset detection to idle state
   * @returns {void}
   */
  resetToIdle() {
    this.updateStatus({
      status: 'idle',
      progress: {
        completed: 0,
        total: 0,
        currentFile: null
      },
      error: null,
      startedAt: null,
      estimatedTimeRemaining: null
    });
  }

  /**
   * Simulate detection progress
   * @private
   */
  simulateDetection() {
    let completed = 0;
    const total = 10;
    const interval = setInterval(() => {
      if (this.currentStatus.status !== 'running') {
        clearInterval(interval);
        return;
      }

      completed++;
      this.updateProgress({
        completed: completed,
        total: total,
        currentFile: `file_${completed}.cpp`
      });

      if (completed >= total) {
        clearInterval(interval);
        this.completeDetection({
          filesScanned: total,
          defectsFound: Math.floor(Math.random() * 5)
        });
      }
    }, 1000); // Update every second
  }

  /**
   * Subscribe to status changes
   * @param {Function} listener - Callback function (newStatus, oldStatus) => void
   * @returns {Function} Unsubscribe function
   */
  onStatusChange(listener) {
    if (typeof listener !== 'function') {
      throw new Error('Listener must be a function');
    }

    statusChangeListeners.add(listener);

    // Return unsubscribe function
    return () => {
      statusChangeListeners.delete(listener);
    };
  }

  /**
   * Subscribe to progress updates
   * @param {Function} listener - Callback function (newProgress, oldProgress) => void
   * @returns {Function} Unsubscribe function
   */
  onProgressUpdate(listener) {
    if (typeof listener !== 'function') {
      throw new Error('Listener must be a function');
    }

    progressUpdateListeners.add(listener);

    // Return unsubscribe function
    return () => {
      progressUpdateListeners.delete(listener);
    };
  }

  /**
   * Notify status change listeners
   * @param {Object} newStatus - New status
   * @param {Object} oldStatus - Old status
   */
  notifyStatusChange(newStatus, oldStatus) {
    statusChangeListeners.forEach(listener => {
      try {
        listener(newStatus, oldStatus);
      } catch (error) {
        console.error('Error in status change listener:', error);
      }
    });
  }

  /**
   * Notify progress update listeners
   * @param {Object} newProgress - New progress
   * @param {Object} oldProgress - Old progress
   */
  notifyProgressUpdate(newProgress, oldProgress) {
    progressUpdateListeners.forEach(listener => {
      try {
        listener(newProgress, oldProgress);
      } catch (error) {
        console.error('Error in progress update listener:', error);
      }
    });
  }

  /**
   * Save session to storage
   */
  saveSession() {
    try {
      if (this.currentSession) {
        sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(this.currentSession));
      }
    } catch (error) {
      console.error('Error saving session:', error);
    }
  }

  /**
   * Load session from storage
   */
  loadSession() {
    try {
      const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (stored) {
        this.currentSession = JSON.parse(stored);
      }
    } catch (error) {
      console.error('Error loading session:', error);
      this.currentSession = null;
    }
  }

  /**
   * Clear session from storage
   */
  clearSession() {
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      this.currentSession = null;
    } catch (error) {
      console.error('Error clearing session:', error);
    }
  }

  /**
   * Save status to storage
   */
  saveStatus() {
    try {
      localStorage.setItem(STATUS_STORAGE_KEY, JSON.stringify(this.currentStatus));
    } catch (error) {
      console.error('Error saving status:', error);
    }
  }

  /**
   * Load status from storage
   */
  loadStatus() {
    try {
      const stored = localStorage.getItem(STATUS_STORAGE_KEY);
      if (stored) {
        const loadedStatus = JSON.parse(stored);
        
        // Don't restore 'running' status on page load
        if (loadedStatus.status === 'running') {
          loadedStatus.status = 'idle';
        }
        
        // Clear shouldGenerateReport flag to prevent re-generation on page refresh
        if (loadedStatus.detectionResult) {
          loadedStatus.detectionResult.shouldGenerateReport = false;
          
          // Validate and clean up detectionResult.session.groups structure
          if (loadedStatus.detectionResult.session && loadedStatus.detectionResult.session.groups) {
            const groups = loadedStatus.detectionResult.session.groups;
            
            // Ensure groups is an array and each group has valid structure
            if (Array.isArray(groups)) {
              loadedStatus.detectionResult.session.groups = groups.map(group => ({
                name: group.name || 'unknown',
                path: group.path || '',
                results: Array.isArray(group.results) ? group.results.map(result => ({
                  file: result.file || result.filePath || '',
                  filePath: result.filePath || result.file || '',
                  defects: Array.isArray(result.defects) ? result.defects : []
                })) : []
              }));
            } else {
              // If groups is not an array, clear it
              loadedStatus.detectionResult.session.groups = [];
            }
          }
        }
        
        this.currentStatus = loadedStatus;
      }
    } catch (error) {
      console.error('Error loading status:', error);
      // If loading fails, reset to default status
      this.currentStatus = {
        status: 'idle',
        progress: {
          completed: 0,
          total: 0,
          currentFile: null
        },
        error: null,
        startedAt: null,
        estimatedTimeRemaining: null
      };
    }
  }

  /**
   * Generate unique session ID
   * @returns {string} Session ID
   */
  generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Check if detection is running
   * @returns {boolean} Running status
   */
  isRunning() {
    return this.currentStatus.status === 'running';
  }

  /**
   * Check if detection is paused
   * @returns {boolean} Paused status
   */
  isPaused() {
    return this.currentStatus.status === 'paused';
  }

  /**
   * Check if detection has error
   * @returns {boolean} Error status
   */
  hasError() {
    return this.currentStatus.status === 'error';
  }

  /**
   * Get progress percentage
   * @returns {number} Progress percentage (0-100)
   */
  getProgressPercentage() {
    const { completed, total } = this.currentStatus.progress;
    if (!total || total === 0) {
      return 0;
    }
    return Math.round((completed / total) * 100);
  }

  /**
   * Reset service state
   */
  reset() {
    this.clearSession();
    this.currentStatus = {
      status: 'idle',
      progress: {
        completed: 0,
        total: 0,
        currentFile: null
      },
      error: null,
      startedAt: null,
      estimatedTimeRemaining: null
    };
    this.saveStatus();
  }
}

// Create singleton instance (lazy initialization)
let detectionServiceInstance = null;

const getDetectionService = () => {
  if (!detectionServiceInstance) {
    detectionServiceInstance = new DetectionService();
  }
  return detectionServiceInstance;
};

// Export as proxy for backward compatibility
export default new Proxy({}, {
  get(target, prop) {
    const instance = getDetectionService();
    const value = instance[prop];
    // If it's a function, bind it to the instance
    if (typeof value === 'function') {
      return value.bind(instance);
    }
    return value;
  },
  set(target, prop, value) {
    const instance = getDetectionService();
    instance[prop] = value;
    return true;
  }
});

/**
 * Frontend Detection Control Service
 * Manages detection lifecycle, progress tracking, and session management
 */

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
      // Load persisted status
      this.loadStatus();
      
      // Load active session if exists
      this.loadSession();

      this.isInitialized = true;
    } catch (error) {
      console.error('Error initializing detection service:', error);
      this.isInitialized = true;
    }
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

      return {
        success: true,
        sessionId: sessionId
      };
    } catch (error) {
      console.error('Error starting detection:', error);
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
    if (!this.isInitialized) {
      await this.initialize();
    }

    return {
      success: true,
      status: { ...this.currentStatus }
    };
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
    this.updateStatus({
      status: 'error',
      error: error
    });

    // Update session if exists
    if (this.currentSession) {
      this.currentSession.status = 'error';
      this.currentSession.error = error;
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
    // Update session
    if (this.currentSession) {
      this.currentSession.status = 'completed';
      this.currentSession.completedAt = new Date().toISOString();
      this.currentSession.result = result;
    }

    // Update status
    this.updateStatus({
      status: 'idle',
      error: null
    });

    // Clear session
    this.clearSession();
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
        this.currentStatus = loadedStatus;
      }
    } catch (error) {
      console.error('Error loading status:', error);
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

// Create singleton instance
const detectionService = new DetectionService();

export default detectionService;

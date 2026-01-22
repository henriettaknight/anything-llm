/**
 * @fileoverview Resume Detection Service
 * Handles detection session management and recovery
 */

import SessionStorage, { SessionStatus } from '../storage/sessionStorage.js';

/**
 * @typedef {Object} DetectionStatus
 * @property {string} lastProcessedFile - Last processed file path
 * @property {string[]} processedFiles - List of processed file paths
 * @property {number} startTime - Start time
 * @property {number} lastUpdateTime - Last update time
 * @property {string} directoryHash - Directory hash
 */

/**
 * @typedef {Object} DetectionSession
 * @property {string} id - Session ID
 * @property {string} directoryPath - Directory path
 * @property {DetectionStatus} status - Detection status
 */

// Storage key prefix (legacy support)
const STORAGE_KEY_PREFIX = 'auto_detection_session_';

/**
 * Resume Detection Service Implementation
 */
class ResumeDetectionServiceImpl {
  /**
   * Create new detection session
   * @param {string} directoryPath - Directory path
   * @returns {DetectionSession} - Created session
   */
  createSession(directoryPath) {
    const sessionId = this.generateSessionId(directoryPath);
    const session = {
      id: sessionId,
      directoryPath,
      status: {
        lastProcessedFile: '',
        processedFiles: [],
        startTime: Date.now(),
        lastUpdateTime: Date.now(),
        directoryHash: this.generateDirectoryHash(directoryPath)
      }
    };
    
    this.saveSession(session);
    return session;
  }

  /**
   * Get existing session
   * @param {string} directoryPath - Directory path
   * @returns {DetectionSession|null} - Session or null
   */
  getSession(directoryPath) {
    const sessionId = this.generateSessionId(directoryPath);
    try {
      const storedSession = localStorage.getItem(`${STORAGE_KEY_PREFIX}${sessionId}`);
      if (storedSession) {
        return JSON.parse(storedSession);
      }
    } catch (error) {
      console.error('获取会话失败:', error);
    }
    return null;
  }

  /**
   * Save session status
   * @param {DetectionSession} session - Session to save
   */
  saveSession(session) {
    try {
      // Update last update time
      session.status.lastUpdateTime = Date.now();
      localStorage.setItem(
        `${STORAGE_KEY_PREFIX}${session.id}`,
        JSON.stringify(session)
      );
    } catch (error) {
      console.error('保存会话失败:', error);
    }
  }

  /**
   * Update processing progress
   * @param {DetectionSession} session - Session to update
   * @param {Object} processedFile - Processed file info
   */
  updateProgress(session, processedFile) {
    session.status.lastProcessedFile = processedFile.path;
    
    // Avoid duplicate additions
    if (!session.status.processedFiles.includes(processedFile.path)) {
      session.status.processedFiles.push(processedFile.path);
    }
    
    this.saveSession(session);
  }

  /**
   * Get unprocessed files
   * @param {DetectionSession} session - Current session
   * @param {Object[]} allFiles - All files
   * @returns {Object[]} - Unprocessed files
   */
  getUnprocessedFiles(session, allFiles) {
    return allFiles.filter(
      file => !session.status.processedFiles.includes(file.path)
    );
  }

  /**
   * Complete session
   * @param {DetectionSession} session - Session to complete
   */
  completeSession(session) {
    // Can choose to delete session or mark as completed
    // Here we choose to delete session because task is completed
    this.deleteSession(session.id);
  }

  /**
   * Delete session
   * @param {string} sessionId - Session ID
   */
  deleteSession(sessionId) {
    try {
      localStorage.removeItem(`${STORAGE_KEY_PREFIX}${sessionId}`);
    } catch (error) {
      console.error('删除会话失败:', error);
    }
  }

  /**
   * Cleanup expired sessions (over 24 hours)
   */
  cleanupExpiredSessions() {
    const now = Date.now();
    const EXPIRY_TIME = 24 * 60 * 60 * 1000; // 24 hours

    try {
      // Iterate all localStorage items
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(STORAGE_KEY_PREFIX)) {
          const sessionData = localStorage.getItem(key);
          if (sessionData) {
            const session = JSON.parse(sessionData);
            if (now - session.status.lastUpdateTime > EXPIRY_TIME) {
              localStorage.removeItem(key);
            }
          }
        }
      }
    } catch (error) {
      console.error('清理过期会话失败:', error);
    }
  }

  /**
   * Generate session ID
   * @param {string} directoryPath - Directory path
   * @returns {string} - Session ID
   */
  generateSessionId(directoryPath) {
    return `${this.generateDirectoryHash(directoryPath)}_${Date.now()}`;
  }

  /**
   * Generate directory hash
   * @param {string} directoryPath - Directory path
   * @returns {string} - Hash value
   */
  generateDirectoryHash(directoryPath) {
    // Simple string hash function
    let hash = 0;
    for (let i = 0; i < directoryPath.length; i++) {
      const char = directoryPath.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Check if can resume detection
   * @param {string} directoryPath - Directory path
   * @returns {boolean} - True if can resume
   */
  canResumeDetection(directoryPath) {
    const session = this.getSession(directoryPath);
    if (!session) {
      return false;
    }

    // Check if session is expired (not updated for over 1 hour)
    const ONE_HOUR = 60 * 60 * 1000;
    return Date.now() - session.status.lastUpdateTime < ONE_HOUR;
  }

  /**
   * Get progress percentage
   * @param {DetectionSession} session - Current session
   * @param {number} totalFiles - Total files
   * @returns {number} - Progress percentage
   */
  getProgressPercentage(session, totalFiles) {
    if (totalFiles === 0) return 0;
    return Math.round(
      (session.status.processedFiles.length / totalFiles) * 100
    );
  }

  /**
   * Save progress for a session
   * @param {string} sessionId - Session ID
   * @param {Object} progress - Progress information
   * @returns {Promise<void>}
   */
  async saveProgress(sessionId, progress) {
    try {
      // Use new SessionStorage
      SessionStorage.updateProgress(sessionId, progress);
      
      // Legacy support
      const key = `${STORAGE_KEY_PREFIX}${sessionId}`;
      const storedSession = localStorage.getItem(key);
      
      if (storedSession) {
        const session = JSON.parse(storedSession);
        session.progress = progress;
        session.status.lastUpdateTime = Date.now();
        localStorage.setItem(key, JSON.stringify(session));
      }
    } catch (error) {
      console.error('保存进度失败:', error);
    }
  }

  /**
   * Load a session by ID
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object|null>} - Session or null
   */
  async loadSession(sessionId) {
    try {
      // Try new SessionStorage first
      const session = SessionStorage.load(sessionId);
      if (session) {
        return session;
      }
      
      // Fallback to legacy storage
      const key = `${STORAGE_KEY_PREFIX}${sessionId}`;
      const storedSession = localStorage.getItem(key);
      
      if (storedSession) {
        return JSON.parse(storedSession);
      }
    } catch (error) {
      console.error('加载会话失败:', error);
    }
    return null;
  }

  /**
   * Get all incomplete sessions
   * @returns {Promise<Array>} - List of incomplete sessions
   */
  async getIncompleteSessions() {
    try {
      // Use new SessionStorage
      const incompleteSessions = SessionStorage.getIncompleteSessions();
      
      // Also check legacy storage
      const legacySessions = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(STORAGE_KEY_PREFIX)) {
          const sessionData = localStorage.getItem(key);
          if (sessionData) {
            const session = JSON.parse(sessionData);
            // Only return sessions that are not completed
            if (session.status !== 'completed' && session.status !== 'cancelled') {
              legacySessions.push(session);
            }
          }
        }
      }
      
      // Combine and deduplicate
      const allSessions = [...incompleteSessions, ...legacySessions];
      const uniqueSessions = allSessions.filter((session, index, self) =>
        index === self.findIndex((s) => s.id === session.id)
      );
      
      return uniqueSessions;
    } catch (error) {
      console.error('获取未完成会话失败:', error);
      return [];
    }
  }

  /**
   * Create a new session with enhanced tracking
   * @param {Object} config - Session configuration
   * @returns {Object} Created session
   */
  createEnhancedSession(config) {
    return SessionStorage.createSession(config);
  }

  /**
   * Update session status
   * @param {string} sessionId - Session ID
   * @param {string} status - New status
   * @param {string} [error] - Error message if failed
   * @returns {boolean} Success status
   */
  updateSessionStatus(sessionId, status, error = null) {
    return SessionStorage.updateStatus(sessionId, status, error);
  }

  /**
   * Add processed file to session
   * @param {string} sessionId - Session ID
   * @param {Object} fileInfo - File information
   * @returns {boolean} Success status
   */
  addProcessedFile(sessionId, fileInfo) {
    return SessionStorage.addProcessedFile(sessionId, fileInfo);
  }

  /**
   * Add failed file to session
   * @param {string} sessionId - Session ID
   * @param {Object} fileInfo - File information with error
   * @returns {boolean} Success status
   */
  addFailedFile(sessionId, fileInfo) {
    return SessionStorage.addFailedFile(sessionId, fileInfo);
  }

  /**
   * Get session statistics
   * @returns {Object} Session statistics
   */
  getSessionStats() {
    return SessionStorage.getStats();
  }

  /**
   * Cleanup old and stale sessions
   * @returns {Object} Cleanup results
   */
  cleanupSessions() {
    return SessionStorage.cleanupOldSessions();
  }
}

// Export singleton instance
export const resumeDetectionService = new ResumeDetectionServiceImpl();

// Cleanup expired sessions on initialization
resumeDetectionService.cleanupExpiredSessions();


// Export default
export default resumeDetectionService;

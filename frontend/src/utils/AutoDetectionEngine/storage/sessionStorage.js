/**
 * Session Storage Service
 * Manages detection session persistence using localStorage
 * Provides session state tracking, metadata management, and cleanup
 */

const SESSION_STORAGE_PREFIX = 'autoDetection_session_';
const SESSION_INDEX_KEY = 'autoDetection_session_index';
const MAX_SESSIONS = 50; // Maximum number of sessions to keep
const SESSION_RETENTION_DAYS = 7; // Days to keep completed sessions
const SESSION_EXPIRY_HOURS = 24; // Hours before incomplete session is considered stale

/**
 * Session status enum
 * @enum {string}
 */
export const SessionStatus = {
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  INTERRUPTED: 'interrupted'
};

/**
 * Session Storage Service
 */
class SessionStorage {
  /**
   * Create a new session
   * @param {Object} config - Session configuration
   * @returns {Object} Created session
   */
  static createSession(config) {
    const sessionId = this.generateId();
    const session = {
      id: sessionId,
      status: SessionStatus.RUNNING,
      config: { ...config },
      metadata: {
        startTime: Date.now(),
        lastUpdateTime: Date.now(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      progress: {
        totalFiles: 0,
        processedFiles: 0,
        currentFile: '',
        currentBatch: 0,
        totalBatches: 0,
        percentage: 0,
        filesWithDefects: 0,
        totalDefectsFound: 0
      },
      results: {
        processedFilesList: [],
        failedFiles: [],
        batchResults: []
      },
      error: null
    };

    this.save(session);
    this.addToIndex(sessionId, this.getSessionMetadata(session));
    
    return session;
  }

  /**
   * Save session to localStorage
   * @param {Object} session - Session object to save
   * @returns {boolean} Success status
   */
  static save(session) {
    try {
      if (!this.validateSession(session)) {
        throw new Error('Invalid session format');
      }

      // Update metadata
      session.metadata.lastUpdateTime = Date.now();
      session.metadata.updatedAt = new Date().toISOString();

      const key = this.getSessionKey(session.id);
      localStorage.setItem(key, JSON.stringify(session));

      // Update index
      this.updateIndex(session.id, this.getSessionMetadata(session));

      return true;
    } catch (error) {
      console.error('Error saving session:', error);
      return false;
    }
  }

  /**
   * Load session by ID
   * @param {string} sessionId - Session ID
   * @returns {Object|null} Session object or null
   */
  static load(sessionId) {
    try {
      const key = this.getSessionKey(sessionId);
      const stored = localStorage.getItem(key);
      
      if (!stored) {
        return null;
      }

      return JSON.parse(stored);
    } catch (error) {
      console.error('Error loading session:', error);
      return null;
    }
  }

  /**
   * Update session progress
   * @param {string} sessionId - Session ID
   * @param {Object} progress - Progress update
   * @returns {boolean} Success status
   */
  static updateProgress(sessionId, progress) {
    try {
      const session = this.load(sessionId);
      if (!session) {
        return false;
      }

      session.progress = { ...session.progress, ...progress };
      
      // Calculate percentage if total files is known
      if (session.progress.totalFiles > 0) {
        session.progress.percentage = Math.floor(
          (session.progress.processedFiles / session.progress.totalFiles) * 100
        );
      }

      return this.save(session);
    } catch (error) {
      console.error('Error updating progress:', error);
      return false;
    }
  }

  /**
   * Update session status
   * @param {string} sessionId - Session ID
   * @param {string} status - New status
   * @param {string} [error] - Error message if failed
   * @returns {boolean} Success status
   */
  static updateStatus(sessionId, status, error = null) {
    try {
      const session = this.load(sessionId);
      if (!session) {
        return false;
      }

      session.status = status;
      
      if (error) {
        session.error = error;
      }

      // Set end time for terminal states
      if ([SessionStatus.COMPLETED, SessionStatus.FAILED, SessionStatus.CANCELLED].includes(status)) {
        session.metadata.endTime = Date.now();
        session.metadata.duration = session.metadata.endTime - session.metadata.startTime;
      }

      return this.save(session);
    } catch (error) {
      console.error('Error updating status:', error);
      return false;
    }
  }

  /**
   * Add processed file to session
   * @param {string} sessionId - Session ID
   * @param {Object} fileInfo - Processed file information
   * @returns {boolean} Success status
   */
  static addProcessedFile(sessionId, fileInfo) {
    try {
      const session = this.load(sessionId);
      if (!session) {
        return false;
      }

      session.results.processedFilesList.push({
        path: fileInfo.path,
        name: fileInfo.name,
        defectsFound: fileInfo.defectsFound || 0,
        processedAt: Date.now()
      });

      session.progress.processedFiles = session.results.processedFilesList.length;
      
      if (fileInfo.defectsFound > 0) {
        session.progress.filesWithDefects++;
        session.progress.totalDefectsFound += fileInfo.defectsFound;
      }

      return this.save(session);
    } catch (error) {
      console.error('Error adding processed file:', error);
      return false;
    }
  }

  /**
   * Add failed file to session
   * @param {string} sessionId - Session ID
   * @param {Object} fileInfo - Failed file information
   * @returns {boolean} Success status
   */
  static addFailedFile(sessionId, fileInfo) {
    try {
      const session = this.load(sessionId);
      if (!session) {
        return false;
      }

      session.results.failedFiles.push({
        path: fileInfo.path,
        name: fileInfo.name,
        error: fileInfo.error,
        failedAt: Date.now()
      });

      return this.save(session);
    } catch (error) {
      console.error('Error adding failed file:', error);
      return false;
    }
  }

  /**
   * Get all sessions (metadata only)
   * @returns {Array} Array of session metadata
   */
  static list() {
    try {
      const index = this.getIndex();
      
      // Sort by creation date (newest first)
      return index.sort((a, b) => 
        new Date(b.createdAt) - new Date(a.createdAt)
      );
    } catch (error) {
      console.error('Error listing sessions:', error);
      return [];
    }
  }

  /**
   * Get incomplete sessions
   * @returns {Array} Array of incomplete session metadata
   */
  static getIncompleteSessions() {
    try {
      const sessions = this.list();
      const incompleteStatuses = [SessionStatus.RUNNING, SessionStatus.PAUSED, SessionStatus.INTERRUPTED];
      
      return sessions.filter(s => incompleteStatuses.includes(s.status));
    } catch (error) {
      console.error('Error getting incomplete sessions:', error);
      return [];
    }
  }

  /**
   * Get active session (currently running)
   * @returns {Object|null} Active session or null
   */
  static getActiveSession() {
    try {
      const sessions = this.list();
      const activeSession = sessions.find(s => s.status === SessionStatus.RUNNING);
      
      if (activeSession) {
        return this.load(activeSession.id);
      }
      
      return null;
    } catch (error) {
      console.error('Error getting active session:', error);
      return null;
    }
  }

  /**
   * Delete session by ID
   * @param {string} sessionId - Session ID
   * @returns {boolean} Success status
   */
  static delete(sessionId) {
    try {
      const key = this.getSessionKey(sessionId);
      localStorage.removeItem(key);
      this.removeFromIndex(sessionId);
      return true;
    } catch (error) {
      console.error('Error deleting session:', error);
      return false;
    }
  }

  /**
   * Cleanup completed and failed sessions
   * @returns {number} Number of sessions deleted
   */
  static cleanupCompletedSessions() {
    try {
      const sessions = this.list();
      let deletedCount = 0;

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - SESSION_RETENTION_DAYS);

      const terminalStatuses = [SessionStatus.COMPLETED, SessionStatus.FAILED, SessionStatus.CANCELLED];
      
      for (const session of sessions) {
        if (terminalStatuses.includes(session.status) && 
            new Date(session.createdAt) < cutoffDate) {
          this.delete(session.id);
          deletedCount++;
        }
      }

      return deletedCount;
    } catch (error) {
      console.error('Error cleaning up completed sessions:', error);
      return 0;
    }
  }

  /**
   * Cleanup stale sessions (incomplete sessions that haven't been updated)
   * @returns {number} Number of sessions cleaned up
   */
  static cleanupStaleSessions() {
    try {
      const sessions = this.list();
      let deletedCount = 0;

      const cutoffTime = Date.now() - (SESSION_EXPIRY_HOURS * 60 * 60 * 1000);
      const incompleteStatuses = [SessionStatus.RUNNING, SessionStatus.PAUSED, SessionStatus.INTERRUPTED];

      for (const session of sessions) {
        if (incompleteStatuses.includes(session.status) && 
            session.lastUpdateTime < cutoffTime) {
          // Mark as interrupted instead of deleting
          this.updateStatus(session.id, SessionStatus.INTERRUPTED, 'Session expired due to inactivity');
          deletedCount++;
        }
      }

      return deletedCount;
    } catch (error) {
      console.error('Error cleaning up stale sessions:', error);
      return 0;
    }
  }

  /**
   * Cleanup old sessions based on retention policy
   * @returns {Object} Cleanup results
   */
  static cleanupOldSessions() {
    try {
      const sessions = this.list();
      let deletedCount = 0;

      // Delete sessions exceeding max count
      if (sessions.length > MAX_SESSIONS) {
        const terminalStatuses = [SessionStatus.COMPLETED, SessionStatus.FAILED, SessionStatus.CANCELLED];
        const completedSessions = sessions.filter(s => terminalStatuses.includes(s.status));
        
        if (completedSessions.length > MAX_SESSIONS) {
          const toDelete = completedSessions.slice(MAX_SESSIONS);
          for (const session of toDelete) {
            this.delete(session.id);
            deletedCount++;
          }
        }
      }

      const completedDeleted = this.cleanupCompletedSessions();
      const staleDeleted = this.cleanupStaleSessions();

      return {
        total: deletedCount + completedDeleted + staleDeleted,
        byMaxCount: deletedCount,
        byRetention: completedDeleted,
        byStale: staleDeleted
      };
    } catch (error) {
      console.error('Error cleaning up old sessions:', error);
      return {
        total: 0,
        byMaxCount: 0,
        byRetention: 0,
        byStale: 0,
        error: error.message
      };
    }
  }

  /**
   * Get session statistics
   * @returns {Object} Session statistics
   */
  static getStats() {
    try {
      const sessions = this.list();
      
      const statusCounts = sessions.reduce((acc, session) => {
        acc[session.status] = (acc[session.status] || 0) + 1;
        return acc;
      }, {});

      const completedSessions = sessions.filter(s => s.status === SessionStatus.COMPLETED);
      const totalDuration = completedSessions.reduce((sum, s) => {
        const session = this.load(s.id);
        return sum + (session?.metadata?.duration || 0);
      }, 0);

      const avgDuration = completedSessions.length > 0 
        ? totalDuration / completedSessions.length 
        : 0;

      return {
        totalSessions: sessions.length,
        statusCounts,
        completedSessions: completedSessions.length,
        incompleteSessions: this.getIncompleteSessions().length,
        avgDuration: Math.floor(avgDuration),
        avgDurationFormatted: this.formatDuration(avgDuration)
      };
    } catch (error) {
      console.error('Error getting session stats:', error);
      return {
        totalSessions: 0,
        statusCounts: {},
        completedSessions: 0,
        incompleteSessions: 0,
        avgDuration: 0,
        avgDurationFormatted: '0s'
      };
    }
  }

  /**
   * Validate session structure
   * @param {Object} session - Session to validate
   * @returns {boolean} Validation result
   */
  static validateSession(session) {
    if (!session || typeof session !== 'object') {
      return false;
    }

    const requiredFields = ['id', 'status', 'config', 'metadata', 'progress'];
    
    for (const field of requiredFields) {
      if (!(field in session)) {
        console.warn(`Missing required field: ${field}`);
        return false;
      }
    }

    const validStatuses = Object.values(SessionStatus);
    if (!validStatuses.includes(session.status)) {
      console.warn(`Invalid status: ${session.status}`);
      return false;
    }

    return true;
  }

  /**
   * Generate unique session ID
   * @returns {string} Unique ID
   */
  static generateId() {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Get storage key for a session
   * @param {string} sessionId - Session ID
   * @returns {string} Storage key
   */
  static getSessionKey(sessionId) {
    return `${SESSION_STORAGE_PREFIX}${sessionId}`;
  }

  /**
   * Get session metadata (for index)
   * @param {Object} session - Session object
   * @returns {Object} Session metadata
   */
  static getSessionMetadata(session) {
    return {
      id: session.id,
      status: session.status,
      createdAt: session.metadata.createdAt,
      lastUpdateTime: session.metadata.lastUpdateTime,
      startTime: session.metadata.startTime,
      endTime: session.metadata.endTime,
      duration: session.metadata.duration,
      totalFiles: session.progress.totalFiles,
      processedFiles: session.progress.processedFiles,
      percentage: session.progress.percentage,
      totalDefectsFound: session.progress.totalDefectsFound
    };
  }

  /**
   * Get session index
   * @returns {Array} Session index
   */
  static getIndex() {
    try {
      const stored = localStorage.getItem(SESSION_INDEX_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Error getting session index:', error);
      return [];
    }
  }

  /**
   * Add session to index
   * @param {string} sessionId - Session ID
   * @param {Object} metadata - Session metadata
   */
  static addToIndex(sessionId, metadata) {
    try {
      const index = this.getIndex();
      
      // Remove existing entry if present
      const filtered = index.filter(s => s.id !== sessionId);
      
      // Add new entry
      filtered.push(metadata);
      
      localStorage.setItem(SESSION_INDEX_KEY, JSON.stringify(filtered));
    } catch (error) {
      console.error('Error adding to session index:', error);
    }
  }

  /**
   * Update session in index
   * @param {string} sessionId - Session ID
   * @param {Object} metadata - Updated metadata
   */
  static updateIndex(sessionId, metadata) {
    this.addToIndex(sessionId, metadata);
  }

  /**
   * Remove session from index
   * @param {string} sessionId - Session ID
   */
  static removeFromIndex(sessionId) {
    try {
      const index = this.getIndex();
      const filtered = index.filter(s => s.id !== sessionId);
      localStorage.setItem(SESSION_INDEX_KEY, JSON.stringify(filtered));
    } catch (error) {
      console.error('Error removing from session index:', error);
    }
  }

  /**
   * Format duration in milliseconds to human readable string
   * @param {number} milliseconds - Duration in milliseconds
   * @returns {string} Formatted duration
   */
  static formatDuration(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Export session as JSON
   * @param {string} sessionId - Session ID
   * @returns {string|null} JSON string or null
   */
  static exportSession(sessionId) {
    try {
      const session = this.load(sessionId);
      if (!session) {
        return null;
      }
      return JSON.stringify(session, null, 2);
    } catch (error) {
      console.error('Error exporting session:', error);
      return null;
    }
  }

  /**
   * Delete all sessions
   * @returns {boolean} Success status
   */
  static deleteAll() {
    try {
      const sessions = this.list();
      
      for (const session of sessions) {
        const key = this.getSessionKey(session.id);
        localStorage.removeItem(key);
      }

      localStorage.removeItem(SESSION_INDEX_KEY);
      return true;
    } catch (error) {
      console.error('Error deleting all sessions:', error);
      return false;
    }
  }
}

export default SessionStorage;

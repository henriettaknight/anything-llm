/**
 * TempFileManager
 * Manages temporary file storage and cleanup
 * 
 * Requirements:
 * - 1.1: Create unique session directories in temporary storage
 * - 9.1: Set directory permissions to current user read/write only
 * - 11.3: Use cross-platform path handling
 * - 11.6: Handle Windows backslash path separators correctly
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class TempFileManager {
  constructor() {
    // Use cross-platform path handling (Requirement 11.3)
    this.basePath = this._normalizePath(
      process.env.KIRO_TEMP_PATH || path.join(os.tmpdir(), '.kiro', 'statistics')
    );
    this.retentionHours = parseInt(process.env.KIRO_RETENTION_HOURS || '24', 10);
  }

  /**
   * Normalize path for cross-platform compatibility
   * Handles Windows backslashes and ensures consistent path separators
   * @private
   * @param {string} filePath - Path to normalize
   * @returns {string} Normalized path
   */
  _normalizePath(filePath) {
    // Convert to forward slashes for consistency, then use path.normalize
    // This handles both Windows and Unix-style paths (Requirement 11.6)
    return path.normalize(filePath.replace(/\\/g, '/'));
  }

  /**
   * Create a session directory with secure permissions
   * Requirement 1.1: Create unique session directory at /tmp/.kiro/statistics/[session_id]/
   * Requirement 9.1: Set directory permissions to current user read/write only (0o700)
   * @param {string} sessionId - Session ID
   * @returns {Promise<string>} Path to session directory
   */
  async createSessionDir(sessionId) {
    const sessionDir = this._normalizePath(path.join(this.basePath, sessionId));

    try {
      // Create directory with mode 0o700 (owner read/write/execute only)
      // Requirement 9.1: Directory permissions for current user only
      await fs.mkdir(sessionDir, { recursive: true, mode: 0o700 });
      
      // On Windows, fs.mkdir mode parameter is ignored, so we need to set permissions explicitly
      if (os.platform() === 'win32') {
        // Windows doesn't support Unix-style permissions, but we can verify directory was created
        // The directory is created in user's temp folder which is already user-specific
        await this._verifyDirectoryExists(sessionDir);
      } else {
        // On Unix-like systems, verify and enforce permissions
        await this._setSecurePermissions(sessionDir);
      }
      
      // Create subdirectories for organized storage
      await this._createSessionSubdirectories(sessionDir);
      
      return sessionDir;
    } catch (error) {
      console.error(`Error creating session directory for ${sessionId}:`, error.message);
      throw error;
    }
  }

  /**
   * Create subdirectories within session directory
   * @private
   * @param {string} sessionDir - Session directory path
   */
  async _createSessionSubdirectories(sessionDir) {
    const subdirs = ['details', 'config', 'reports', 'downloads'];
    
    for (const subdir of subdirs) {
      const subdirPath = path.join(sessionDir, subdir);
      await fs.mkdir(subdirPath, { recursive: true, mode: 0o700 });
      
      if (os.platform() !== 'win32') {
        await this._setSecurePermissions(subdirPath);
      }
    }
  }

  /**
   * Set secure permissions on Unix-like systems
   * @private
   * @param {string} dirPath - Directory path
   */
  async _setSecurePermissions(dirPath) {
    try {
      // Set permissions to 0o700 (rwx------)
      await fs.chmod(dirPath, 0o700);
    } catch (error) {
      console.warn(`Warning: Could not set permissions on ${dirPath}:`, error.message);
    }
  }

  /**
   * Verify directory exists (for Windows)
   * @private
   * @param {string} dirPath - Directory path
   */
  async _verifyDirectoryExists(dirPath) {
    try {
      const stats = await fs.stat(dirPath);
      if (!stats.isDirectory()) {
        throw new Error(`Path exists but is not a directory: ${dirPath}`);
      }
    } catch (error) {
      throw new Error(`Failed to verify directory: ${error.message}`);
    }
  }

  /**
   * Get session directory path with cross-platform path handling
   * @param {string} sessionId - Session ID
   * @returns {string} Path to session directory
   */
  getSessionDir(sessionId) {
    return this._normalizePath(path.join(this.basePath, sessionId));
  }

  /**
   * Get subdirectory path within session
   * @param {string} sessionId - Session ID
   * @param {string} subdir - Subdirectory name (details, config, reports, downloads)
   * @returns {string} Path to subdirectory
   */
  getSessionSubdir(sessionId, subdir) {
    return this._normalizePath(path.join(this.basePath, sessionId, subdir));
  }

  /**
   * Check if session directory exists
   * @param {string} sessionId - Session ID
   * @returns {Promise<boolean>} Whether session directory exists
   */
  async sessionExists(sessionId) {
    try {
      const sessionDir = this.getSessionDir(sessionId);
      const stats = await fs.stat(sessionDir);
      return stats.isDirectory();
    } catch (error) {
      return false;
    }
  }

  /**
   * Clean up expired sessions
   * Requirement 6.2: Scan temporary storage directory and identify sessions older than 24 hours
   * Requirement 6.3: Delete expired session directories and all contained files
   * @returns {Promise<number>} Number of sessions cleaned up
   */
  async cleanupExpiredSessions() {
    try {
      // Ensure base directory exists before attempting cleanup
      try {
        await fs.access(this.basePath);
      } catch (error) {
        console.log('Base directory does not exist yet, skipping cleanup');
        return 0;
      }

      const sessions = await fs.readdir(this.basePath);
      const now = Date.now();
      const retentionMs = this.retentionHours * 60 * 60 * 1000;
      let cleanedCount = 0;
      const expiredSessions = [];

      // First pass: identify expired sessions
      for (const sessionId of sessions) {
        const sessionDir = this._normalizePath(path.join(this.basePath, sessionId));

        try {
          const stats = await fs.stat(sessionDir);

          // Skip if not a directory
          if (!stats.isDirectory()) {
            continue;
          }

          // Check if directory is older than retention period
          // Requirement 6.2: Identify sessions created more than retention hours ago
          const ageMs = now - stats.mtimeMs;
          if (ageMs > retentionMs) {
            expiredSessions.push({
              sessionId,
              sessionDir,
              ageHours: Math.floor(ageMs / (60 * 60 * 1000))
            });
          }
        } catch (error) {
          console.warn(`Error checking session ${sessionId}:`, error.message);
        }
      }

      // Second pass: delete expired sessions
      // Requirement 6.3: Delete expired directories and all contained files
      for (const { sessionId, sessionDir, ageHours } of expiredSessions) {
        try {
          await this._deleteDirectory(sessionDir);
          cleanedCount++;
          console.log(`Cleaned up expired session: ${sessionId} (age: ${ageHours} hours)`);
        } catch (error) {
          console.error(`Failed to delete session ${sessionId}:`, error.message);
        }
      }

      return cleanedCount;
    } catch (error) {
      console.error('Error during cleanup:', error.message);
      return 0;
    }
  }

  /**
   * Schedule cleanup task
   * Note: This method is informational only. Actual scheduling is handled by
   * the BackgroundService which uses Bree job scheduler.
   * 
   * Requirement 6.4: Execute cleanup task daily at 3:00 AM
   * Requirement 7.3: Support configurable cleanup schedule
   * 
   * @param {string} cronExpression - Cron expression for scheduling (e.g., "0 3 * * *" for 3:00 AM daily)
   * @returns {Object} Scheduling configuration
   */
  scheduleCleanup(cronExpression = '0 3 * * *') {
    // The actual scheduling is handled by BackgroundService using Bree
    // This method returns the configuration that should be used
    return {
      name: 'cleanup-token-statistics',
      cron: cronExpression,
      retentionHours: this.retentionHours,
      basePath: this.basePath
    };
  }

  /**
   * Get cleanup configuration
   * @returns {Object} Cleanup configuration
   */
  getCleanupConfig() {
    return {
      retentionHours: this.retentionHours,
      basePath: this.basePath,
      defaultSchedule: '0 3 * * *', // Daily at 3:00 AM
      configuredSchedule: process.env.KIRO_CLEANUP_SCHEDULE || '0 3 * * *'
    };
  }

  /**
   * Validate download token
   * @param {string} token - Download token to validate
   * @returns {Promise<boolean>} Whether token is valid
   */
  async validateDownloadToken(token) {
    try {
      // Token validation logic will be implemented in security task
      return true;
    } catch (error) {
      console.error('Error validating token:', error.message);
      return false;
    }
  }

  /**
   * Delete directory recursively with cross-platform path handling
   * @private
   * @param {string} dirPath - Directory path to delete
   */
  async _deleteDirectory(dirPath) {
    try {
      const normalizedPath = this._normalizePath(dirPath);
      const entries = await fs.readdir(normalizedPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = this._normalizePath(path.join(normalizedPath, entry.name));

        if (entry.isDirectory()) {
          await this._deleteDirectory(fullPath);
        } else {
          await fs.unlink(fullPath);
        }
      }

      await fs.rmdir(normalizedPath);
    } catch (error) {
      console.error(`Error deleting directory ${dirPath}:`, error.message);
      throw error;
    }
  }

  /**
   * Validate path to prevent directory traversal attacks
   * Requirement 9.5: Validate path legality to prevent path traversal
   * @param {string} filePath - Path to validate
   * @returns {boolean} Whether path is valid and safe
   */
  validatePath(filePath) {
    try {
      const normalizedPath = this._normalizePath(filePath);
      const normalizedBase = this._normalizePath(this.basePath);
      
      // Resolve to absolute paths
      const resolvedPath = path.resolve(normalizedPath);
      const resolvedBase = path.resolve(normalizedBase);
      
      // Check if the resolved path starts with the base path
      // This prevents directory traversal attacks like ../../etc/passwd
      return resolvedPath.startsWith(resolvedBase);
    } catch (error) {
      console.error('Error validating path:', error.message);
      return false;
    }
  }

  /**
   * Get platform information for debugging
   * @returns {Object} Platform information
   */
  getPlatformInfo() {
    return {
      platform: os.platform(),
      isWindows: os.platform() === 'win32',
      pathSeparator: path.sep,
      basePath: this.basePath,
      tmpDir: os.tmpdir()
    };
  }
}

module.exports = TempFileManager;

/**
 * Token Statistics Cleanup Job
 * 
 * Automatically cleans up expired token statistics sessions
 * 
 * Requirements:
 * - 6.1: Retain temporary statistics files for 24 hours
 * - 6.2: Scan temporary storage directory and identify sessions older than 24 hours
 * - 6.3: Delete expired session directories and all contained files
 * - 6.4: Execute cleanup task daily at 3:00 AM
 * - 7.2: Support configurable retention time via environment variables
 * - 7.3: Support configurable cleanup schedule via environment variables
 */

const { log, conclude } = require('./helpers/index.js');
const TempFileManager = require('../token-statistics/TempFileManager.js');

(async () => {
  try {
    log('Starting token statistics cleanup job...');
    
    const tempFileManager = new TempFileManager();
    
    // Get configuration
    const retentionHours = tempFileManager.retentionHours;
    log(`Retention period: ${retentionHours} hours`);
    
    // Perform cleanup
    const cleanedCount = await tempFileManager.cleanupExpiredSessions();
    
    if (cleanedCount > 0) {
      log(`Successfully cleaned up ${cleanedCount} expired session(s)`);
    } else {
      log('No expired sessions found to clean up');
    }
    
  } catch (error) {
    log(`Error during cleanup: ${error.message}`);
    console.error(error);
  } finally {
    conclude();
  }
})();

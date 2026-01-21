/**
 * @fileoverview Type definitions for the Auto Detection Engine
 * This file contains JSDoc type definitions for all services and data structures
 */

/**
 * @typedef {Object} DetectionConfig
 * @property {boolean} enabled - Enable/disable auto detection
 * @property {string} targetDirectory - Directory to monitor
 * @property {string} detectionTime - Scheduled detection time (HH:MM)
 * @property {string[]} fileTypes - File extensions to analyze (e.g., ['.cpp', '.h'])
 * @property {string[]} excludePatterns - Patterns to exclude from analysis
 * @property {number} batchSize - Files per batch for processing
 * @property {number} retryAttempts - Retry attempts for failed detections
 * @property {string|null} aiProvider - Preferred AI provider
 * @property {boolean} notificationEnabled - Enable completion notifications
 */

/**
 * @typedef {Object} DetectionProgress
 * @property {number} filesProcessed - Number of files processed
 * @property {number} totalFiles - Total number of files to process
 * @property {string} currentFile - Currently processing file
 * @property {number} percentage - Progress percentage (0-100)
 */

/**
 * @typedef {Object} DetectionStatus
 * @property {boolean} isRunning - Whether detection is currently running
 * @property {string|null} currentSession - Current session ID
 * @property {DetectionProgress} progress - Current progress information
 * @property {number|null} estimatedTimeRemaining - Estimated time remaining in milliseconds
 * @property {Date|null} lastRun - Last detection run timestamp
 * @property {Date|null} nextScheduledRun - Next scheduled run timestamp
 */

/**
 * @typedef {Object} DetectionDefect
 * @property {string} file - File path where defect was found
 * @property {number} line - Line number
 * @property {string} category - Defect category
 * @property {string} severity - Severity level (high, medium, low)
 * @property {string} description - Defect description
 * @property {string} suggestion - Suggested fix
 */

/**
 * @typedef {Object} ReportSummary
 * @property {Object.<string, number>} categories - Defect categories and counts
 * @property {Object.<string, number>} severity - Severity distribution
 * @property {Object.<string, number>} fileTypes - File type analysis
 */

/**
 * @typedef {Object} ReportMetadata
 * @property {number} duration - Analysis duration in milliseconds
 * @property {string} aiProvider - AI provider used
 * @property {DetectionConfig} configSnapshot - Configuration at time of analysis
 */

/**
 * @typedef {Object} DetectionReport
 * @property {string} id - Report unique identifier
 * @property {string} sessionId - Session identifier
 * @property {Date} timestamp - Report creation timestamp
 * @property {string} groupName - Group name
 * @property {string} groupPath - Group path
 * @property {number} filesScanned - Number of files scanned
 * @property {number} defectsFound - Number of defects found
 * @property {ReportSummary} summary - Summary statistics
 * @property {DetectionDefect[]} defects - Detailed defect information
 * @property {ReportMetadata} metadata - Analysis metadata
 * @property {string} status - Report status (completed, failed, interrupted)
 */

/**
 * @typedef {Object} DetectionSession
 * @property {string} id - Session unique identifier
 * @property {string} status - Session status (running, paused, completed, failed)
 * @property {Object} progress - Current progress state
 * @property {DetectionConfig} config - Configuration snapshot
 * @property {Date} startedAt - Session start timestamp
 * @property {Date|null} completedAt - Session completion timestamp
 * @property {string|null} errorMessage - Error message if failed
 */

/**
 * @typedef {Object} FileInfo
 * @property {string} path - File path
 * @property {string} name - File name
 * @property {string} extension - File extension
 * @property {number} size - File size in bytes
 * @property {Date} lastModified - Last modification timestamp
 * @property {string} content - File content
 */

/**
 * @typedef {Object} BatchResult
 * @property {number} batchIndex - Batch index
 * @property {DetectionDefect[]} defects - Defects found in batch
 * @property {string[]} processedFiles - Files processed in batch
 * @property {Object[]} errors - Errors encountered in batch
 */

/**
 * @typedef {Object} AIResponse
 * @property {string} content - AI response content
 * @property {boolean} isComplete - Whether response is complete
 * @property {Object} metadata - Response metadata
 */

/**
 * @typedef {Object} ServiceResponse
 * @property {boolean} success - Whether operation was successful
 * @property {*} [data] - Response data
 * @property {string} [error] - Error message if failed
 */

export default {};

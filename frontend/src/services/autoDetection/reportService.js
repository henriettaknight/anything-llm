/**
 * Frontend Report Management Service
 * Manages report listing, viewing, deletion, export, and history
 */

import ReportStorage from '@/utils/AutoDetectionEngine/storage/reportStorage';

/**
 * Report change listeners
 */
const reportChangeListeners = new Set();

/**
 * Report Service
 * Manages detection reports with localStorage persistence
 */
class ReportService {
  constructor() {
    this.isInitialized = false;
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
      // Perform any initialization tasks
      // Clean up old reports on initialization
      ReportStorage.cleanupOldReports();
      
      this.isInitialized = true;
    } catch (error) {
      console.error('Error initializing report service:', error);
      this.isInitialized = true;
    }
  }

  /**
   * Get all reports
   * @returns {Promise<Object>} Result with reports list
   */
  async getReports() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const reports = ReportStorage.list();
      
      return {
        success: true,
        reports: reports
      };
    } catch (error) {
      console.error('Error getting reports:', error);
      return {
        success: false,
        error: error.message,
        reports: []
      };
    }
  }

  /**
   * Get paginated reports
   * @param {number} page - Page number (1-based)
   * @param {number} pageSize - Number of reports per page
   * @returns {Promise<Object>} Result with paginated reports
   */
  async getReportsPaginated(page = 1, pageSize = 10) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const result = ReportStorage.listPaginated(page, pageSize);
      
      return {
        success: true,
        ...result
      };
    } catch (error) {
      console.error('Error getting paginated reports:', error);
      return {
        success: false,
        error: error.message,
        reports: [],
        pagination: {
          currentPage: 1,
          pageSize,
          totalReports: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false
        }
      };
    }
  }

  /**
   * Get a specific report by ID
   * @param {string} reportId - Report ID
   * @returns {Promise<Object>} Result with report data
   */
  async getReport(reportId) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const report = ReportStorage.get(reportId);
      
      if (!report) {
        return {
          success: false,
          error: 'Report not found'
        };
      }

      return {
        success: true,
        report: report
      };
    } catch (error) {
      console.error('Error getting report:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Save a report
   * @param {Object} report - Report data
   * @returns {Promise<Object>} Result with success status
   */
  async saveReport(report) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const saved = ReportStorage.save(report);
      
      if (!saved) {
        return {
          success: false,
          error: 'Failed to save report'
        };
      }

      // Notify listeners
      this.notifyReportChange('created', report);

      return {
        success: true,
        reportId: report.id
      };
    } catch (error) {
      console.error('Error saving report:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Delete a report
   * @param {string} reportId - Report ID
   * @returns {Promise<Object>} Result with success status
   */
  async deleteReport(reportId) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Get report before deletion for notification
      const report = ReportStorage.get(reportId);
      
      const deleted = ReportStorage.delete(reportId);
      
      if (!deleted) {
        return {
          success: false,
          error: 'Failed to delete report'
        };
      }

      // Notify listeners
      if (report) {
        this.notifyReportChange('deleted', report);
      }

      return {
        success: true
      };
    } catch (error) {
      console.error('Error deleting report:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Delete multiple reports
   * @param {Array<string>} reportIds - Array of report IDs
   * @returns {Promise<Object>} Result with deletion results
   */
  async deleteMultipleReports(reportIds) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const results = ReportStorage.deleteMultiple(reportIds);
      
      // Notify listeners for each deleted report
      results.success.forEach(reportId => {
        this.notifyReportChange('deleted', { id: reportId });
      });

      return {
        success: true,
        results: results
      };
    } catch (error) {
      console.error('Error deleting multiple reports:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Delete all reports
   * @returns {Promise<Object>} Result with success status
   */
  async deleteAllReports() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const deleted = ReportStorage.deleteAll();
      
      if (!deleted) {
        return {
          success: false,
          error: 'Failed to delete all reports'
        };
      }

      // Notify listeners
      this.notifyReportChange('cleared', null);

      return {
        success: true
      };
    } catch (error) {
      console.error('Error deleting all reports:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Filter reports by criteria
   * @param {Object} filters - Filter criteria
   * @returns {Promise<Object>} Result with filtered reports
   */
  async filterReports(filters = {}) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const reports = ReportStorage.filter(filters);
      
      return {
        success: true,
        reports: reports
      };
    } catch (error) {
      console.error('Error filtering reports:', error);
      return {
        success: false,
        error: error.message,
        reports: []
      };
    }
  }

  /**
   * Export report as CSV
   * @param {string} reportId - Report ID
   * @returns {Promise<Object>} Result with success status
   */
  async exportReportAsCSV(reportId) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const report = ReportStorage.get(reportId);
      
      if (!report) {
        return {
          success: false,
          error: 'Report not found'
        };
      }

      // Convert report to CSV format
      const csv = this.convertReportToCSV(report);
      
      // Create download
      this.downloadFile(csv, `report-${reportId}.csv`, 'text/csv');

      return {
        success: true
      };
    } catch (error) {
      console.error('Error exporting report as CSV:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Export report as JSON
   * @param {string} reportId - Report ID
   * @returns {Promise<Object>} Result with success status
   */
  async exportReportAsJSON(reportId) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const json = ReportStorage.exportReport(reportId);
      
      if (!json) {
        return {
          success: false,
          error: 'Report not found'
        };
      }

      // Create download
      this.downloadFile(json, `report-${reportId}.json`, 'application/json');

      return {
        success: true
      };
    } catch (error) {
      console.error('Error exporting report as JSON:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Export all reports as JSON
   * @returns {Promise<Object>} Result with success status
   */
  async exportAllReports() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const json = ReportStorage.exportAll();
      
      if (!json) {
        return {
          success: false,
          error: 'No reports to export'
        };
      }

      // Create download
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      this.downloadFile(json, `all-reports-${timestamp}.json`, 'application/json');

      return {
        success: true
      };
    } catch (error) {
      console.error('Error exporting all reports:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get storage statistics
   * @returns {Promise<Object>} Result with statistics
   */
  async getStats() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const stats = ReportStorage.getStats();
      
      return {
        success: true,
        stats: stats
      };
    } catch (error) {
      console.error('Error getting stats:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Clean up old reports
   * @returns {Promise<Object>} Result with cleanup count
   */
  async cleanupOldReports() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const deletedCount = ReportStorage.cleanupOldReports();
      
      // Notify listeners
      if (deletedCount > 0) {
        this.notifyReportChange('cleanup', { deletedCount });
      }

      return {
        success: true,
        deletedCount: deletedCount
      };
    } catch (error) {
      console.error('Error cleaning up old reports:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Convert report to CSV format
   * @param {Object} report - Report data
   * @returns {string} CSV string
   */
  convertReportToCSV(report) {
    const lines = [];
    
    // Header
    lines.push('# Auto Detection Report');
    lines.push(`# Generated: ${report.createdAt}`);
    lines.push(`# Session ID: ${report.sessionId}`);
    lines.push(`# Group: ${report.groupName}`);
    lines.push(`# Path: ${report.groupPath}`);
    lines.push(`# Files Scanned: ${report.filesScanned}`);
    lines.push(`# Defects Found: ${report.defectsFound}`);
    lines.push('');
    
    // Defects table
    if (report.defects && report.defects.length > 0) {
      lines.push('File,Line,Category,Severity,Description');
      
      report.defects.forEach(defect => {
        const file = this.escapeCSV(defect.file || '');
        const line = defect.line || '';
        const category = this.escapeCSV(defect.category || '');
        const severity = this.escapeCSV(defect.severity || '');
        const description = this.escapeCSV(defect.description || '');
        
        lines.push(`${file},${line},${category},${severity},${description}`);
      });
    }
    
    return lines.join('\n');
  }

  /**
   * Escape CSV field
   * @param {string} field - Field value
   * @returns {string} Escaped field
   */
  escapeCSV(field) {
    if (typeof field !== 'string') {
      return field;
    }
    
    // If field contains comma, quote, or newline, wrap in quotes and escape quotes
    if (field.includes(',') || field.includes('"') || field.includes('\n')) {
      return `"${field.replace(/"/g, '""')}"`;
    }
    
    return field;
  }

  /**
   * Download file
   * @param {string} content - File content
   * @param {string} filename - File name
   * @param {string} mimeType - MIME type
   */
  downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /**
   * Subscribe to report changes
   * @param {Function} listener - Callback function (action, report) => void
   * @returns {Function} Unsubscribe function
   */
  onReportChange(listener) {
    if (typeof listener !== 'function') {
      throw new Error('Listener must be a function');
    }

    reportChangeListeners.add(listener);

    // Return unsubscribe function
    return () => {
      reportChangeListeners.delete(listener);
    };
  }

  /**
   * Notify report change listeners
   * @param {string} action - Action type (created, deleted, cleared, cleanup)
   * @param {Object} report - Report data
   */
  notifyReportChange(action, report) {
    reportChangeListeners.forEach(listener => {
      try {
        listener(action, report);
      } catch (error) {
        console.error('Error in report change listener:', error);
      }
    });
  }

  /**
   * Get recent reports
   * @param {number} count - Number of reports to retrieve
   * @returns {Promise<Object>} Result with recent reports
   */
  async getRecentReports(count = 5) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const allReports = ReportStorage.list();
      const recentReports = allReports.slice(0, count);
      
      return {
        success: true,
        reports: recentReports
      };
    } catch (error) {
      console.error('Error getting recent reports:', error);
      return {
        success: false,
        error: error.message,
        reports: []
      };
    }
  }

  /**
   * Search reports by text
   * @param {string} searchText - Search text
   * @returns {Promise<Object>} Result with matching reports
   */
  async searchReports(searchText) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const allReports = ReportStorage.list();
      const searchLower = searchText.toLowerCase();
      
      const matchingReports = allReports.filter(report => {
        return (
          report.groupName.toLowerCase().includes(searchLower) ||
          report.groupPath.toLowerCase().includes(searchLower) ||
          report.sessionId.toLowerCase().includes(searchLower)
        );
      });
      
      return {
        success: true,
        reports: matchingReports
      };
    } catch (error) {
      console.error('Error searching reports:', error);
      return {
        success: false,
        error: error.message,
        reports: []
      };
    }
  }

  /**
   * Compare two reports
   * @param {string} reportId1 - First report ID
   * @param {string} reportId2 - Second report ID
   * @returns {Promise<Object>} Result with comparison data
   */
  async compareReports(reportId1, reportId2) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const comparison = ReportStorage.compareReports(reportId1, reportId2);
      
      if (!comparison) {
        return {
          success: false,
          error: 'One or both reports not found'
        };
      }

      return {
        success: true,
        comparison: comparison
      };
    } catch (error) {
      console.error('Error comparing reports:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Compare reports across time period
   * @param {string} startDate - Start date (ISO string)
   * @param {string} endDate - End date (ISO string)
   * @returns {Promise<Object>} Result with period comparison
   */
  async compareReportsByPeriod(startDate, endDate) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const comparison = ReportStorage.compareReportsByPeriod(startDate, endDate);
      
      return {
        success: true,
        comparison: comparison
      };
    } catch (error) {
      console.error('Error comparing reports by period:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get trend analysis
   * @param {number} days - Number of days to analyze
   * @returns {Promise<Object>} Result with trend analysis
   */
  async getTrendAnalysis(days = 30) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const analysis = ReportStorage.getTrendAnalysis(days);
      
      return {
        success: true,
        analysis: analysis
      };
    } catch (error) {
      console.error('Error getting trend analysis:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get reports grouped by date
   * @param {string} groupBy - Grouping period ('day', 'week', 'month')
   * @returns {Promise<Object>} Result with grouped reports
   */
  async getReportsGroupedByDate(groupBy = 'day') {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const allReports = ReportStorage.list();
      const grouped = {};

      allReports.forEach(report => {
        const date = new Date(report.createdAt);
        let key;

        switch (groupBy) {
          case 'day':
            key = date.toISOString().split('T')[0];
            break;
          case 'week':
            const weekStart = new Date(date);
            weekStart.setDate(date.getDate() - date.getDay());
            key = weekStart.toISOString().split('T')[0];
            break;
          case 'month':
            key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            break;
          default:
            key = date.toISOString().split('T')[0];
        }

        if (!grouped[key]) {
          grouped[key] = [];
        }
        grouped[key].push(report);
      });

      return {
        success: true,
        grouped: grouped,
        groupBy: groupBy
      };
    } catch (error) {
      console.error('Error grouping reports by date:', error);
      return {
        success: false,
        error: error.message,
        grouped: {}
      };
    }
  }
}

// Create singleton instance
const reportService = new ReportService();

export default reportService;

/**
 * Report Storage Service
 * Manages report persistence using localStorage
 * Provides save, retrieve, list, and cleanup capabilities
 */

const REPORT_STORAGE_PREFIX = 'autoDetection_report_';
const REPORT_INDEX_KEY = 'autoDetection_report_index';
const MAX_REPORTS = 100; // Maximum number of reports to keep
const REPORT_RETENTION_DAYS = 90; // Days to keep reports

/**
 * Report Storage Service
 */
class ReportStorage {
  /**
   * Save a report to localStorage
   * @param {Object} report - Report object to save
   * @returns {boolean} Success status
   */
  static save(report) {
    try {
      if (!this.validateReport(report)) {
        throw new Error('Invalid report format');
      }

      const reportId = report.id || this.generateId();
      const reportToSave = {
        ...report,
        id: reportId,
        createdAt: report.createdAt || new Date().toISOString()
      };

      // Save the report
      const key = this.getReportKey(reportId);
      localStorage.setItem(key, JSON.stringify(reportToSave));

      // Update index
      this.addToIndex(reportId, {
        id: reportId,
        sessionId: reportToSave.sessionId,
        groupName: reportToSave.groupName,
        groupPath: reportToSave.groupPath,
        filesScanned: reportToSave.filesScanned,
        defectsFound: reportToSave.defectsFound,
        status: reportToSave.status,
        createdAt: reportToSave.createdAt
      });

      // Cleanup old reports if needed
      this.cleanupOldReports();

      return true;
    } catch (error) {
      console.error('Error saving report:', error);
      return false;
    }
  }

  /**
   * Retrieve a report by ID
   * @param {string} reportId - Report ID
   * @returns {Object|null} Report object or null if not found
   */
  static get(reportId) {
    try {
      const key = this.getReportKey(reportId);
      const stored = localStorage.getItem(key);
      
      if (!stored) {
        return null;
      }

      return JSON.parse(stored);
    } catch (error) {
      console.error('Error retrieving report:', error);
      return null;
    }
  }

  /**
   * Get all reports (metadata only)
   * @returns {Array} Array of report metadata
   */
  static list() {
    try {
      const index = this.getIndex();
      
      // Sort by creation date (newest first)
      return index.sort((a, b) => 
        new Date(b.createdAt) - new Date(a.createdAt)
      );
    } catch (error) {
      console.error('Error listing reports:', error);
      return [];
    }
  }

  /**
   * Get reports with pagination
   * @param {number} page - Page number (1-based)
   * @param {number} pageSize - Number of reports per page
   * @returns {Object} Paginated results
   */
  static listPaginated(page = 1, pageSize = 10) {
    try {
      const allReports = this.list();
      const totalReports = allReports.length;
      const totalPages = Math.ceil(totalReports / pageSize);
      
      const startIndex = (page - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      const reports = allReports.slice(startIndex, endIndex);

      return {
        reports,
        pagination: {
          currentPage: page,
          pageSize,
          totalReports,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1
        }
      };
    } catch (error) {
      console.error('Error listing paginated reports:', error);
      return {
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
   * Filter reports by criteria
   * @param {Object} filters - Filter criteria
   * @returns {Array} Filtered reports
   */
  static filter(filters = {}) {
    try {
      let reports = this.list();

      if (filters.status) {
        reports = reports.filter(r => r.status === filters.status);
      }

      if (filters.groupName) {
        reports = reports.filter(r => 
          r.groupName.toLowerCase().includes(filters.groupName.toLowerCase())
        );
      }

      if (filters.startDate) {
        const startDate = new Date(filters.startDate);
        reports = reports.filter(r => new Date(r.createdAt) >= startDate);
      }

      if (filters.endDate) {
        const endDate = new Date(filters.endDate);
        reports = reports.filter(r => new Date(r.createdAt) <= endDate);
      }

      if (filters.minDefects !== undefined) {
        reports = reports.filter(r => r.defectsFound >= filters.minDefects);
      }

      return reports;
    } catch (error) {
      console.error('Error filtering reports:', error);
      return [];
    }
  }

  /**
   * Delete a report by ID
   * @param {string} reportId - Report ID to delete
   * @returns {boolean} Success status
   */
  static delete(reportId) {
    try {
      const key = this.getReportKey(reportId);
      localStorage.removeItem(key);
      this.removeFromIndex(reportId);
      return true;
    } catch (error) {
      console.error('Error deleting report:', error);
      return false;
    }
  }

  /**
   * Delete multiple reports
   * @param {Array<string>} reportIds - Array of report IDs to delete
   * @returns {Object} Deletion results
   */
  static deleteMultiple(reportIds) {
    const results = {
      success: [],
      failed: []
    };

    for (const reportId of reportIds) {
      if (this.delete(reportId)) {
        results.success.push(reportId);
      } else {
        results.failed.push(reportId);
      }
    }

    return results;
  }

  /**
   * Delete all reports
   * @returns {boolean} Success status
   */
  static deleteAll() {
    try {
      const reports = this.list();
      
      for (const report of reports) {
        const key = this.getReportKey(report.id);
        localStorage.removeItem(key);
      }

      localStorage.removeItem(REPORT_INDEX_KEY);
      return true;
    } catch (error) {
      console.error('Error deleting all reports:', error);
      return false;
    }
  }

  /**
   * Cleanup old reports based on retention policy
   * @returns {number} Number of reports deleted
   */
  static cleanupOldReports() {
    try {
      const reports = this.list();
      let deletedCount = 0;

      // Delete reports exceeding max count
      if (reports.length > MAX_REPORTS) {
        const toDelete = reports.slice(MAX_REPORTS);
        for (const report of toDelete) {
          this.delete(report.id);
          deletedCount++;
        }
      }

      // Delete reports exceeding retention period
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - REPORT_RETENTION_DAYS);

      const expiredReports = reports.filter(r => 
        new Date(r.createdAt) < cutoffDate
      );

      for (const report of expiredReports) {
        this.delete(report.id);
        deletedCount++;
      }

      return deletedCount;
    } catch (error) {
      console.error('Error cleaning up old reports:', error);
      return 0;
    }
  }

  /**
   * Get storage statistics
   * @returns {Object} Storage statistics
   */
  static getStats() {
    try {
      const reports = this.list();
      const totalReports = reports.length;
      
      let totalSize = 0;
      for (const report of reports) {
        const fullReport = this.get(report.id);
        if (fullReport) {
          totalSize += JSON.stringify(fullReport).length;
        }
      }

      const statusCounts = reports.reduce((acc, report) => {
        acc[report.status] = (acc[report.status] || 0) + 1;
        return acc;
      }, {});

      const totalDefects = reports.reduce((sum, report) => 
        sum + (report.defectsFound || 0), 0
      );

      const totalFilesScanned = reports.reduce((sum, report) => 
        sum + (report.filesScanned || 0), 0
      );

      return {
        totalReports,
        totalSize,
        totalSizeKB: (totalSize / 1024).toFixed(2),
        statusCounts,
        totalDefects,
        totalFilesScanned,
        oldestReport: reports.length > 0 ? reports[reports.length - 1].createdAt : null,
        newestReport: reports.length > 0 ? reports[0].createdAt : null
      };
    } catch (error) {
      console.error('Error getting storage stats:', error);
      return {
        totalReports: 0,
        totalSize: 0,
        totalSizeKB: '0.00',
        statusCounts: {},
        totalDefects: 0,
        totalFilesScanned: 0,
        oldestReport: null,
        newestReport: null
      };
    }
  }

  /**
   * Validate report structure
   * @param {Object} report - Report to validate
   * @returns {boolean} Validation result
   */
  static validateReport(report) {
    if (!report || typeof report !== 'object') {
      return false;
    }

    const requiredFields = [
      'sessionId',
      'groupName',
      'groupPath',
      'filesScanned',
      'defectsFound',
      'status'
    ];

    for (const field of requiredFields) {
      if (!(field in report)) {
        console.warn(`Missing required field: ${field}`);
        return false;
      }
    }

    if (typeof report.filesScanned !== 'number' || report.filesScanned < 0) {
      return false;
    }

    if (typeof report.defectsFound !== 'number' || report.defectsFound < 0) {
      return false;
    }

    const validStatuses = ['completed', 'failed', 'interrupted'];
    if (!validStatuses.includes(report.status)) {
      return false;
    }

    return true;
  }

  /**
   * Generate unique report ID
   * @returns {string} Unique ID
   */
  static generateId() {
    return `report_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get storage key for a report
   * @param {string} reportId - Report ID
   * @returns {string} Storage key
   */
  static getReportKey(reportId) {
    return `${REPORT_STORAGE_PREFIX}${reportId}`;
  }

  /**
   * Get report index
   * @returns {Array} Report index
   */
  static getIndex() {
    try {
      const stored = localStorage.getItem(REPORT_INDEX_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Error getting report index:', error);
      return [];
    }
  }

  /**
   * Add report to index
   * @param {string} reportId - Report ID
   * @param {Object} metadata - Report metadata
   */
  static addToIndex(reportId, metadata) {
    try {
      const index = this.getIndex();
      
      // Remove existing entry if present
      const filtered = index.filter(r => r.id !== reportId);
      
      // Add new entry
      filtered.push(metadata);
      
      localStorage.setItem(REPORT_INDEX_KEY, JSON.stringify(filtered));
    } catch (error) {
      console.error('Error adding to report index:', error);
    }
  }

  /**
   * Remove report from index
   * @param {string} reportId - Report ID
   */
  static removeFromIndex(reportId) {
    try {
      const index = this.getIndex();
      const filtered = index.filter(r => r.id !== reportId);
      localStorage.setItem(REPORT_INDEX_KEY, JSON.stringify(filtered));
    } catch (error) {
      console.error('Error removing from report index:', error);
    }
  }

  /**
   * Export report as JSON
   * @param {string} reportId - Report ID
   * @returns {string|null} JSON string or null
   */
  static exportReport(reportId) {
    try {
      const report = this.get(reportId);
      if (!report) {
        return null;
      }
      return JSON.stringify(report, null, 2);
    } catch (error) {
      console.error('Error exporting report:', error);
      return null;
    }
  }

  /**
   * Export all reports as JSON
   * @returns {string|null} JSON string or null
   */
  static exportAll() {
    try {
      const reports = this.list();
      const fullReports = reports.map(r => this.get(r.id)).filter(Boolean);
      return JSON.stringify(fullReports, null, 2);
    } catch (error) {
      console.error('Error exporting all reports:', error);
      return null;
    }
  }

  /**
   * Compare two reports
   * @param {string} reportId1 - First report ID
   * @param {string} reportId2 - Second report ID
   * @returns {Object|null} Comparison result
   */
  static compareReports(reportId1, reportId2) {
    try {
      const report1 = this.get(reportId1);
      const report2 = this.get(reportId2);
      
      if (!report1 || !report2) {
        return null;
      }

      return {
        report1: {
          id: report1.id,
          groupName: report1.groupName,
          createdAt: report1.createdAt,
          filesScanned: report1.filesScanned,
          defectsFound: report1.defectsFound
        },
        report2: {
          id: report2.id,
          groupName: report2.groupName,
          createdAt: report2.createdAt,
          filesScanned: report2.filesScanned,
          defectsFound: report2.defectsFound
        },
        comparison: {
          filesScannedDiff: report2.filesScanned - report1.filesScanned,
          defectsFoundDiff: report2.defectsFound - report1.defectsFound,
          defectsFoundPercentChange: report1.defectsFound > 0
            ? (((report2.defectsFound - report1.defectsFound) / report1.defectsFound) * 100).toFixed(2) + '%'
            : 'N/A',
          timeDiff: new Date(report2.createdAt) - new Date(report1.createdAt),
          timeDiffFormatted: this.formatTimeDiff(
            new Date(report2.createdAt) - new Date(report1.createdAt)
          )
        }
      };
    } catch (error) {
      console.error('Error comparing reports:', error);
      return null;
    }
  }

  /**
   * Compare reports across time period
   * @param {string} startDate - Start date (ISO string)
   * @param {string} endDate - End date (ISO string)
   * @returns {Object} Comparison statistics
   */
  static compareReportsByPeriod(startDate, endDate) {
    try {
      const reports = this.filter({ startDate, endDate });
      
      if (reports.length === 0) {
        return {
          period: { startDate, endDate },
          reportCount: 0,
          statistics: null
        };
      }

      const totalFilesScanned = reports.reduce((sum, r) => sum + r.filesScanned, 0);
      const totalDefectsFound = reports.reduce((sum, r) => sum + r.defectsFound, 0);
      const avgDefectsPerReport = (totalDefectsFound / reports.length).toFixed(2);
      const avgFilesPerReport = (totalFilesScanned / reports.length).toFixed(2);

      // Get full reports for detailed analysis
      const fullReports = reports.map(r => this.get(r.id)).filter(Boolean);
      
      // Aggregate defects by severity
      const severityCounts = { low: 0, medium: 0, high: 0 };
      const typeCounts = {};
      
      fullReports.forEach(report => {
        if (report.summary && report.summary.bySeverity) {
          severityCounts.low += report.summary.bySeverity.low || 0;
          severityCounts.medium += report.summary.bySeverity.medium || 0;
          severityCounts.high += report.summary.bySeverity.high || 0;
        }
        
        if (report.summary && report.summary.byType) {
          Object.entries(report.summary.byType).forEach(([type, count]) => {
            typeCounts[type] = (typeCounts[type] || 0) + count;
          });
        }
      });

      return {
        period: { startDate, endDate },
        reportCount: reports.length,
        statistics: {
          totalFilesScanned,
          totalDefectsFound,
          avgDefectsPerReport: parseFloat(avgDefectsPerReport),
          avgFilesPerReport: parseFloat(avgFilesPerReport),
          severityDistribution: severityCounts,
          topDefectTypes: Object.entries(typeCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([type, count]) => ({ type, count }))
        }
      };
    } catch (error) {
      console.error('Error comparing reports by period:', error);
      return {
        period: { startDate, endDate },
        reportCount: 0,
        statistics: null,
        error: error.message
      };
    }
  }

  /**
   * Get trend analysis for reports
   * @param {number} days - Number of days to analyze
   * @returns {Object} Trend analysis
   */
  static getTrendAnalysis(days = 30) {
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const reports = this.filter({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      });

      if (reports.length === 0) {
        return {
          period: { days, startDate: startDate.toISOString(), endDate: endDate.toISOString() },
          trend: 'no_data',
          data: []
        };
      }

      // Sort by date
      const sortedReports = reports.sort((a, b) => 
        new Date(a.createdAt) - new Date(b.createdAt)
      );

      // Calculate trend
      const firstHalf = sortedReports.slice(0, Math.floor(sortedReports.length / 2));
      const secondHalf = sortedReports.slice(Math.floor(sortedReports.length / 2));

      const firstHalfAvg = firstHalf.reduce((sum, r) => sum + r.defectsFound, 0) / firstHalf.length;
      const secondHalfAvg = secondHalf.reduce((sum, r) => sum + r.defectsFound, 0) / secondHalf.length;

      let trend = 'stable';
      if (secondHalfAvg > firstHalfAvg * 1.1) {
        trend = 'increasing';
      } else if (secondHalfAvg < firstHalfAvg * 0.9) {
        trend = 'decreasing';
      }

      return {
        period: { days, startDate: startDate.toISOString(), endDate: endDate.toISOString() },
        trend,
        data: sortedReports.map(r => ({
          date: r.createdAt,
          defectsFound: r.defectsFound,
          filesScanned: r.filesScanned
        })),
        statistics: {
          totalReports: reports.length,
          firstHalfAvg: firstHalfAvg.toFixed(2),
          secondHalfAvg: secondHalfAvg.toFixed(2),
          percentChange: firstHalfAvg > 0
            ? (((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100).toFixed(2) + '%'
            : 'N/A'
        }
      };
    } catch (error) {
      console.error('Error getting trend analysis:', error);
      return {
        period: { days },
        trend: 'error',
        data: [],
        error: error.message
      };
    }
  }

  /**
   * Format time difference
   * @param {number} milliseconds - Time difference in milliseconds
   * @returns {string} Formatted time difference
   */
  static formatTimeDiff(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days} day${days > 1 ? 's' : ''}`;
    } else if (hours > 0) {
      return `${hours} hour${hours > 1 ? 's' : ''}`;
    } else if (minutes > 0) {
      return `${minutes} minute${minutes > 1 ? 's' : ''}`;
    } else {
      return `${seconds} second${seconds !== 1 ? 's' : ''}`;
    }
  }
}

export default ReportStorage;

/**
 * @fileoverview Report Generation Service
 * Handles report creation, export, and management
 */

/**
 * @typedef {Object} DefectInfo
 * @property {string} type - Defect type
 * @property {string} description - Defect description
 * @property {number} line - Line number
 * @property {string} code - Code snippet
 * @property {'low'|'medium'|'high'} severity - Severity level
 * @property {string} recommendation - Fix recommendation
 */

/**
 * @typedef {Object} FileDetectionResult
 * @property {Object} file - File information
 * @property {DefectInfo[]} defects - List of defects
 * @property {number} scanTime - Scan time
 * @property {boolean} hasDefects - Whether file has defects
 */

/**
 * @typedef {Object} DetectionReport
 * @property {string} id - Report ID
 * @property {string} directoryName - Directory name
 * @property {string} [groupName] - Group name (root or folder name)
 * @property {number} timestamp - Timestamp
 * @property {number} totalFiles - Total files scanned
 * @property {number} filesWithDefects - Files with defects
 * @property {number} totalDefects - Total defects found
 * @property {FileDetectionResult[]} fileResults - File results
 * @property {Object} summary - Summary statistics
 * @property {Object} summary.bySeverity - Defects by severity
 * @property {Object} summary.byType - Defects by type
 * @property {number} duration - Detection duration
 */

const REPORT_STORAGE_KEY_PREFIX = 'detection_report_';

/**
 * Report Generation Service Implementation
 */
class ReportGenerationServiceImpl {
  /**
   * Generate comprehensive report from detection results
   * @param {Object} options - Report generation options
   * @param {string} options.directoryName - Directory name
   * @param {string} [options.groupName] - Group name
   * @param {string} [options.groupPath] - Group path
   * @param {FileDetectionResult[]} options.fileResults - File results
   * @param {number} options.startTime - Start time
   * @param {number} options.endTime - End time
   * @param {string} [options.aiProvider] - AI provider used
   * @param {Object} [options.configSnapshot] - Configuration snapshot
   * @param {string} [options.sessionId] - Session ID
   * @returns {DetectionReport} - Generated report
   */
  generateReport(options) {
    const {
      directoryName,
      groupName,
      groupPath,
      fileResults,
      startTime,
      endTime,
      aiProvider,
      configSnapshot,
      sessionId
    } = options;

    const totalFiles = fileResults.length;
    const filesWithDefects = fileResults.filter(file => file.hasDefects).length;
    
    let allDefects = [];
    fileResults.forEach(file => {
      if (file.hasDefects) {
        allDefects = allDefects.concat(file.defects);
      }
    });
    
    const totalDefects = allDefects.length;
    const duration = endTime - startTime;
    
    // Calculate comprehensive summary statistics
    const summary = this.generateSummaryStatistics(allDefects, fileResults);
    
    // Create metadata
    const metadata = this.generateMetadata({
      duration,
      aiProvider,
      configSnapshot,
      startTime,
      endTime,
      totalFiles,
      filesWithDefects,
      totalDefects
    });
    
    return {
      id: this.generateReportId(directoryName),
      sessionId: sessionId || this.generateSessionId(),
      directoryName,
      groupName: groupName || 'root',
      groupPath: groupPath || directoryName,
      timestamp: Date.now(),
      totalFiles,
      filesWithDefects,
      totalDefects,
      fileResults,
      summary,
      metadata,
      duration,
      status: 'completed',
      createdAt: new Date().toISOString()
    };
  }

  /**
   * Generate comprehensive summary statistics
   * @param {DefectInfo[]} defects - List of defects
   * @param {FileDetectionResult[]} fileResults - File results
   * @returns {Object} Summary statistics
   */
  generateSummaryStatistics(defects, fileResults) {
    return {
      // Defects by severity
      bySeverity: this.countBySeverity(defects),
      
      // Defects by type/category
      byType: this.countByType(defects),
      
      // Defects by file type
      byFileType: this.countByFileType(fileResults),
      
      // Additional statistics
      averageDefectsPerFile: fileResults.length > 0 
        ? (defects.length / fileResults.length).toFixed(2) 
        : 0,
      
      filesWithoutDefects: fileResults.filter(f => !f.hasDefects).length,
      
      // Top defect types
      topDefectTypes: this.getTopDefectTypes(defects, 5),
      
      // Severity distribution percentage
      severityDistribution: this.calculateSeverityDistribution(defects)
    };
  }

  /**
   * Generate report metadata
   * @param {Object} options - Metadata options
   * @returns {Object} Report metadata
   */
  generateMetadata(options) {
    const {
      duration,
      aiProvider,
      configSnapshot,
      startTime,
      endTime,
      totalFiles,
      filesWithDefects,
      totalDefects
    } = options;

    return {
      // Duration information
      duration,
      durationFormatted: this.formatDuration(duration),
      
      // AI provider information
      aiProvider: aiProvider || 'default',
      
      // Configuration snapshot
      configSnapshot: configSnapshot || {},
      
      // Timing information
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      
      // Processing statistics
      processingRate: duration > 0 
        ? ((totalFiles / duration) * 1000).toFixed(2) + ' files/sec'
        : 'N/A',
      
      // Quality metrics
      defectRate: totalFiles > 0 
        ? ((filesWithDefects / totalFiles) * 100).toFixed(2) + '%'
        : '0%',
      
      averageDefectsPerDefectiveFile: filesWithDefects > 0
        ? (totalDefects / filesWithDefects).toFixed(2)
        : 0,
      
      // System information
      generatedAt: new Date().toISOString(),
      reportVersion: '1.0.0'
    };
  }

  /**
   * Count defects by file type
   * @param {FileDetectionResult[]} fileResults - File results
   * @returns {Object} Count by file type
   */
  countByFileType(fileResults) {
    const counts = {};
    
    fileResults.forEach(result => {
      if (result.hasDefects) {
        const extension = this.getFileExtension(result.file.name || result.file.path);
        if (!counts[extension]) {
          counts[extension] = {
            files: 0,
            defects: 0
          };
        }
        counts[extension].files++;
        counts[extension].defects += result.defects.length;
      }
    });
    
    return counts;
  }

  /**
   * Get top defect types
   * @param {DefectInfo[]} defects - List of defects
   * @param {number} limit - Number of top types to return
   * @returns {Array} Top defect types with counts
   */
  getTopDefectTypes(defects, limit = 5) {
    const typeCounts = this.countByType(defects);
    
    return Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([type, count]) => ({ type, count }));
  }

  /**
   * Calculate severity distribution as percentages
   * @param {DefectInfo[]} defects - List of defects
   * @returns {Object} Severity distribution percentages
   */
  calculateSeverityDistribution(defects) {
    const total = defects.length;
    if (total === 0) {
      return { low: 0, medium: 0, high: 0 };
    }
    
    const counts = this.countBySeverity(defects);
    
    return {
      low: ((counts.low / total) * 100).toFixed(1) + '%',
      medium: ((counts.medium / total) * 100).toFixed(1) + '%',
      high: ((counts.high / total) * 100).toFixed(1) + '%'
    };
  }

  /**
   * Get file extension
   * @param {string} filename - File name
   * @returns {string} File extension
   */
  getFileExtension(filename) {
    const parts = filename.split('.');
    return parts.length > 1 ? parts[parts.length - 1] : 'unknown';
  }

  /**
   * Format duration in human-readable format
   * @param {number} milliseconds - Duration in milliseconds
   * @returns {string} Formatted duration
   */
  formatDuration(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Generate session ID
   * @returns {string} Session ID
   */
  generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Save report to localStorage
   * @param {DetectionReport|Object} report - Report to save
   */
  saveReport(report) {
    if (typeof window !== 'undefined') {
      try {
        // If it's CodeDetectionReport, convert to DetectionReport format
        let finalReport;
        
        if ('defects' in report && 'summary' in report && typeof report.summary === 'object' && 'auto' in report.summary) {
          // This is CodeDetectionReport, needs format conversion
          finalReport = this.convertCodeDetectionReport(report);
        } else {
          // This is DetectionReport, use directly
          finalReport = report;
        }
        
        // Save single report
        localStorage.setItem(
          `${REPORT_STORAGE_KEY_PREFIX}${finalReport.id}`,
          JSON.stringify(finalReport)
        );
        
        // Update report list
        const reportList = this.getAllReports();
        reportList.unshift(finalReport);
        
        // Keep only the latest 20 reports
        const limitedReports = reportList.slice(0, 20);
        
        localStorage.setItem(
          `${REPORT_STORAGE_KEY_PREFIX}list`,
          JSON.stringify(limitedReports)
        );
      } catch (error) {
        console.error('保存报告失败:', error);
      }
    }
  }

  /**
   * Get all reports
   * @returns {DetectionReport[]} - List of reports
   */
  getAllReports() {
    if (typeof window !== 'undefined') {
      try {
        const reportListJson = localStorage.getItem(`${REPORT_STORAGE_KEY_PREFIX}list`);
        if (reportListJson) {
          return JSON.parse(reportListJson);
        }
      } catch (error) {
        console.error('获取报告列表失败:', error);
      }
    }
    return [];
  }

  /**
   * Get reports by directory
   * @param {string} directoryName - Directory name
   * @returns {DetectionReport[]} - List of reports
   */
  getReportsByDirectory(directoryName) {
    const allReports = this.getAllReports();
    return allReports.filter(report => report.directoryName === directoryName);
  }

  /**
   * Get report by ID
   * @param {string} reportId - Report ID
   * @returns {DetectionReport|null} - Report or null
   */
  getReportById(reportId) {
    if (typeof window !== 'undefined') {
      try {
        const reportJson = localStorage.getItem(`${REPORT_STORAGE_KEY_PREFIX}${reportId}`);
        if (reportJson) {
          return JSON.parse(reportJson);
        }
      } catch (error) {
        console.error('获取报告失败:', error);
      }
    }
    return null;
  }

  /**
   * Delete report
   * @param {string} reportId - Report ID
   */
  deleteReport(reportId) {
    if (typeof window !== 'undefined') {
      try {
        // Delete single report
        localStorage.removeItem(`${REPORT_STORAGE_KEY_PREFIX}${reportId}`);
        
        // Update report list
        const reportList = this.getAllReports();
        const filteredReports = reportList.filter(report => report.id !== reportId);
        
        localStorage.setItem(
          `${REPORT_STORAGE_KEY_PREFIX}list`,
          JSON.stringify(filteredReports)
        );
      } catch (error) {
        console.error('删除报告失败:', error);
      }
    }
  }

  /**
   * Cleanup old reports
   */
  cleanupOldReports() {
    if (typeof window !== 'undefined') {
      try {
        const reportList = this.getAllReports();
        // Keep only the latest 10 reports
        if (reportList.length > 10) {
          const reportsToKeep = reportList.slice(0, 10);
          const reportsToDelete = reportList.slice(10);
          
          // Delete old reports
          reportsToDelete.forEach(report => {
            localStorage.removeItem(`${REPORT_STORAGE_KEY_PREFIX}${report.id}`);
          });
          
          // Update report list
          localStorage.setItem(
            `${REPORT_STORAGE_KEY_PREFIX}list`,
            JSON.stringify(reportsToKeep)
          );
        }
      } catch (error) {
        console.error('清理过期报告失败:', error);
      }
    }
  }

  /**
   * Export report as CSV
   * @param {DetectionReport} report - Report to export
   * @param {string} [language='zh-CN'] - Target language
   * @returns {string} - CSV content
   */
  exportReportAsCSV(report, language = 'zh-CN') {
    // CSV headers (according to 提示词.md table format)
    const headers = [
      'No',
      'Category', 
      'File',
      'Function/Symbol',
      'Snippet',
      'Lines',
      'Risk',
      'HowToTrigger',
      'SuggestedFix',
      'Confidence'
    ];
    
    let csv = headers.join(',') + '\n';
    
    // Collect all valid defects
    let defectIndex = 1;
    report.fileResults.forEach(fileResult => {
      if (fileResult.hasDefects && fileResult.defects.length > 0) {
        const validDefects = fileResult.defects.filter(defect => 
          !this.isPlaceholderDefectInMarkdown(defect)
        );
        
        validDefects.forEach(defect => {
          const descriptionParts = defect.description.split(' - ');
          const risk = this.escapeCSV(this.translateText(descriptionParts[0] || '', language));
          const howToTrigger = this.escapeCSV(this.translateText(descriptionParts.slice(1).join(' - ') || '', language));
          const functionSymbol = this.escapeCSV(defect.code.split('\n')[0] || defect.code);
          const lines = defect.line > 0 ? `L${defect.line}` : '';
          const confidence = defect.severity === 'high' ? 'High' : defect.severity === 'low' ? 'Low' : 'Medium';
          const translatedRecommendation = this.translateText(defect.recommendation, language);
          
          const row = [
            defectIndex++,
            this.escapeCSV(this.translateText(defect.type, language)),
            this.escapeCSV(fileResult.file.path),
            functionSymbol,
            this.escapeCSV(defect.code),
            lines,
            risk,
            howToTrigger,
            this.escapeCSV(translatedRecommendation),
            confidence
          ];
          
          csv += row.join(',') + '\n';
        });
      }
    });
    
    return csv;
  }

  /**
   * Export report as JSON with proper formatting
   * @param {DetectionReport} report - Report to export
   * @param {boolean} [pretty=true] - Whether to format JSON with indentation
   * @returns {string} - JSON content
   */
  exportReportAsJSON(report, pretty = true) {
    // Create a clean export structure
    const exportData = {
      reportInfo: {
        id: report.id,
        sessionId: report.sessionId,
        groupName: report.groupName,
        groupPath: report.groupPath,
        directoryName: report.directoryName,
        timestamp: report.timestamp,
        createdAt: report.createdAt,
        status: report.status
      },
      statistics: {
        totalFiles: report.totalFiles,
        filesWithDefects: report.filesWithDefects,
        totalDefects: report.totalDefects,
        duration: report.duration
      },
      summary: report.summary,
      metadata: report.metadata,
      defects: this.extractDefectsForExport(report.fileResults),
      fileResults: report.fileResults.map(fr => ({
        file: fr.file,
        hasDefects: fr.hasDefects,
        defectCount: fr.defects.length,
        scanTime: fr.scanTime
      }))
    };
    
    return pretty 
      ? JSON.stringify(exportData, null, 2)
      : JSON.stringify(exportData);
  }

  /**
   * Extract defects in a structured format for export
   * @param {FileDetectionResult[]} fileResults - File results
   * @returns {Array} Structured defects
   */
  extractDefectsForExport(fileResults) {
    const defects = [];
    
    fileResults.forEach(fileResult => {
      if (fileResult.hasDefects) {
        fileResult.defects.forEach(defect => {
          if (!this.isPlaceholderDefectInMarkdown(defect)) {
            defects.push({
              file: fileResult.file.path,
              fileName: fileResult.file.name,
              type: defect.type,
              severity: defect.severity,
              line: defect.line,
              code: defect.code,
              description: defect.description,
              recommendation: defect.recommendation
            });
          }
        });
      }
    });
    
    return defects;
  }

  /**
   * Export report with appropriate headers and format
   * @param {DetectionReport} report - Report to export
   * @param {string} format - Export format ('csv' or 'json')
   * @param {Object} [options] - Export options
   * @returns {Object} Export result with content and metadata
   */
  exportReport(report, format = 'csv', options = {}) {
    const { language = 'zh-CN', pretty = true } = options;
    
    let content;
    let mimeType;
    let extension;
    
    switch (format.toLowerCase()) {
      case 'csv':
        content = this.exportReportAsCSV(report, language);
        mimeType = 'text/csv;charset=utf-8;';
        extension = 'csv';
        break;
        
      case 'json':
        content = this.exportReportAsJSON(report, pretty);
        mimeType = 'application/json;charset=utf-8;';
        extension = 'json';
        break;
        
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
    
    return {
      content,
      mimeType,
      extension,
      filename: this.generateExportFilename(report, extension),
      size: new Blob([content]).size,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Generate export filename
   * @param {DetectionReport} report - Report
   * @param {string} extension - File extension
   * @returns {string} Filename
   */
  generateExportFilename(report, extension) {
    const groupName = report.groupName || 'report';
    const timestamp = new Date(report.timestamp).toISOString().replace(/[:.]/g, '-').split('T')[0];
    return `${groupName.toLowerCase()}_${timestamp}.${extension}`;
  }

  /**
   * Escape CSV field (handle commas, quotes, newlines)
   * @param {string} value - Value to escape
   * @returns {string} - Escaped value
   */
  escapeCSV(value) {
    if (!value) return '';
    
    // If contains comma, quote, or newline, wrap with quotes and escape internal quotes
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    
    return value;
  }
  
  /**
   * Check if defect is placeholder
   * @param {DefectInfo} defect - Defect to check
   * @returns {boolean} - True if placeholder
   */
  isPlaceholderDefectInMarkdown(defect) {
    const placeholders = ['----------', '-------', '------', '-----------------', '--------------', '-', ''];
    const values = [
      defect.type, 
      defect.description, 
      defect.code, 
      defect.recommendation
    ];
    
    return values.some(value => 
      placeholders.includes(value) || 
      value.includes('---') || 
      value.trim() === ''
    );
  }

  /**
   * Generate report file name
   * @param {string} directoryName - Directory name
   * @param {string} [groupName] - Group name
   * @returns {string} - File name
   */
  generateReportFileName(directoryName, groupName) {
    if (groupName) {
      // If group name provided, use simple file name (without extension)
      return groupName.toLowerCase();
    }
    
    // Otherwise use original logic
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeDirName = directoryName.replace(/[^a-zA-Z0-9]/g, '_');
    return `code_detection_report_${safeDirName}_${timestamp}`;
  }

  /**
   * Download report with proper headers and formatting
   * @param {DetectionReport} report - Report to download
   * @param {string} [groupName] - Group name
   * @param {string} [language='zh-CN'] - Target language
   * @param {string} [format='csv'] - Export format ('csv' or 'json')
   * @returns {Promise<void>}
   */
  downloadReport(report, groupName, language = 'zh-CN', format = 'csv') {
    return new Promise((resolve) => {
      if (typeof window === 'undefined') {
        // In Node.js environment, return directly
        resolve();
        return;
      }

      try {
        // Use the new export method
        const exportResult = this.exportReport(report, format, { language, pretty: true });
        
        // Create blob with proper MIME type
        const blob = new Blob([exportResult.content], { type: exportResult.mimeType });
        const url = URL.createObjectURL(blob);
        
        // Prioritize groupName parameter, then use groupName in report
        const finalGroupName = groupName || report.groupName;
        const fileName = finalGroupName 
          ? `${finalGroupName.toLowerCase()}.${exportResult.extension}`
          : exportResult.filename;
        
        console.log(`[downloadReport] 生成的文件名: ${fileName}, 格式: ${format}, 大小: ${exportResult.size} bytes`);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.style.display = 'none';
        document.body.appendChild(link);
        
        // Use setTimeout to ensure DOM updates before triggering click
        setTimeout(() => {
          link.click();
          
          // Delay cleanup to ensure download has triggered
          setTimeout(() => {
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            resolve();
          }, 100);
        }, 0);
        
        console.log(`触发下载: ${fileName}`);
      } catch (error) {
        console.error('下载报告失败:', error);
        resolve(); // Resolve even on error
      }
    });
  }

  /**
   * Download multiple reports in batch
   * @param {DetectionReport[]} reports - Reports to download
   * @param {string} [format='csv'] - Export format
   * @param {number} [delayMs=1000] - Delay between downloads
   * @returns {Promise<Object>} Download results
   */
  async downloadMultipleReports(reports, format = 'csv', delayMs = 1000) {
    const results = {
      success: [],
      failed: []
    };

    for (let i = 0; i < reports.length; i++) {
      const report = reports[i];
      
      try {
        console.log(`[${i + 1}/${reports.length}] 下载报告: ${report.groupName}`);
        await this.downloadReport(report, report.groupName, 'zh-CN', format);
        results.success.push(report.id);
        console.log(`  ✓ 下载成功`);
        
        // Add delay between downloads (except for last one)
        if (i < reports.length - 1) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      } catch (error) {
        console.error(`  ✗ 下载失败:`, error);
        results.failed.push({ id: report.id, error: error.message });
      }
    }

    return results;
  }

  /**
   * Save group reports
   * @param {Object[]} reports - Group reports
   * @returns {Promise<void>}
   */
  async saveGroupReports(reports) {
    console.log(`开始保存 ${reports.length} 个分组报告...`);
    
    for (let i = 0; i < reports.length; i++) {
      const report = reports[i];
      // Generate report file name
      const fileName = `${report.groupName.toLowerCase()}.csv`;
      
      console.log(`[${i + 1}/${reports.length}] 处理报告: ${fileName}`);
      
      // Convert to DetectionReport format
      const detectionReport = this.convertCodeDetectionReport(report);
      
      // 1. Save to localStorage (display in history)
      this.saveReport(detectionReport);
      console.log(`  ✓ 已保存到历史记录`);
      
      // 2. Download report file (using group name, CSV format)
      this.downloadReport(detectionReport, report.groupName);
      console.log(`  ✓ 已触发下载: ${fileName}`);
      
      // 3. Add delay to ensure browser has enough time to process download
      if (i < reports.length - 1) {
        console.log(`  ⏳ 等待 1 秒后继续...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    console.log(`✅ 所有报告已保存，共 ${reports.length} 个分组`);
    console.log(`📥 请检查浏览器下载文件夹`);
  }

  /**
   * Count defects by severity
   * @param {DefectInfo[]} defects - List of defects
   * @returns {Object} - Count by severity
   */
  countBySeverity(defects) {
    const counts = {
      low: 0,
      medium: 0,
      high: 0
    };
    
    defects.forEach(defect => {
      if (counts[defect.severity] !== undefined) {
        counts[defect.severity]++;
      }
    });
    
    return counts;
  }

  /**
   * Count defects by type
   * @param {DefectInfo[]} defects - List of defects
   * @returns {Object} - Count by type
   */
  countByType(defects) {
    const counts = {};
    
    defects.forEach(defect => {
      if (!counts[defect.type]) {
        counts[defect.type] = 0;
      }
      counts[defect.type]++;
    });
    
    return counts;
  }

  /**
   * Generate report ID
   * @param {string} directoryName - Directory name
   * @returns {string} - Report ID
   */
  generateReportId(directoryName) {
    const timestamp = Date.now();
    const hash = this.generateStringHash(`${directoryName}_${timestamp}`);
    return `${hash}_${timestamp}`;
  }

  /**
   * Convert CodeDetectionReport to DetectionReport format
   * @param {Object} codeReport - Code detection report
   * @returns {DetectionReport} - Detection report
   */
  convertCodeDetectionReport(codeReport) {
    // Convert CodeDetectionReport to DetectionReport format
    const fileResults = [];
    
    // Group defects by file
    const defectsByFile = new Map();
    
    codeReport.defects.forEach(defect => {
      // Filter out placeholder content
      if (this.isPlaceholderDefect(defect)) {
        return;
      }
      
      if (!defectsByFile.has(defect.file)) {
        defectsByFile.set(defect.file, []);
      }
      
      const fileDefects = defectsByFile.get(defect.file);
      
      // Improved line number extraction logic
      let lineNumber = 0;
      if (defect.lines && defect.lines.trim()) {
        const lineMatch = defect.lines.match(/L?(\d+)/);
        if (lineMatch) {
          lineNumber = parseInt(lineMatch[1]);
        }
      }
      
      // If extraction from lines field fails, try extracting from description
      if (lineNumber === 0 && defect.howToTrigger) {
        const descLineMatch = defect.howToTrigger.match(/L(\d+)/);
        if (descLineMatch) {
          lineNumber = parseInt(descLineMatch[1]);
        }
      }
      
      // According to 提示词.md required format, correctly separate each field
      fileDefects.push({
        type: defect.category,
        description: `${defect.risk} - ${defect.howToTrigger}`, // Maintain compatibility
        line: lineNumber,
        code: defect.snippet,
        severity: this.mapConfidenceToSeverity(defect.confidence),
        recommendation: defect.suggestedFix
      });
    });
    
    // Create FileDetectionResult array
    defectsByFile.forEach((defects, filePath) => {
      const fileInfo = {
        path: filePath,
        name: filePath.split('/').pop() || filePath,
        size: 0,
        lastModified: Date.now(),
        isDirectory: false
      };
      
      fileResults.push({
        file: fileInfo,
        defects: defects,
        scanTime: 0,
        hasDefects: defects.length > 0
      });
    });
    
    // Create DetectionReport
    return {
      id: codeReport.id,
      directoryName: 'Auto Detection Directory',
      groupName: 'groupName' in codeReport ? codeReport.groupName : undefined,
      timestamp: codeReport.timestamp,
      totalFiles: codeReport.filesScanned,
      filesWithDefects: defectsByFile.size,
      totalDefects: defectsByFile.size > 0 ? 
        Array.from(defectsByFile.values()).reduce((sum, defects) => sum + defects.length, 0) : 0,
      fileResults: fileResults,
      summary: {
        bySeverity: this.countBySeverity(Array.from(defectsByFile.values()).flat()),
        byType: this.countByType(Array.from(defectsByFile.values()).flat())
      },
      duration: 0
    };
  }
  
  /**
   * Check if defect is placeholder
   * @param {Object} defect - Defect to check
   * @returns {boolean} - True if placeholder
   */
  isPlaceholderDefect(defect) {
    const placeholders = ['----------', '-------', '------', '-----------------', '--------------', '-', ''];
    const values = [
      defect.category, 
      defect.risk, 
      defect.howToTrigger, 
      defect.snippet, 
      defect.suggestedFix
    ];
    
    return values.some(value => 
      placeholders.includes(value) || 
      value.includes('---') || 
      value.trim() === ''
    );
  }
  
  /**
   * Map confidence to severity
   * @param {string} confidence - Confidence level
   * @returns {'low'|'medium'|'high'} - Severity level
   */
  mapConfidenceToSeverity(confidence) {
    switch (confidence.toLowerCase()) {
      case 'high':
        return 'high';
      case 'medium':
        return 'medium';
      case 'low':
        return 'low';
      default:
        return 'medium';
    }
  }

  /**
   * Generate string hash
   * @param {string} str - String to hash
   * @returns {string} - Hash value
   */
  generateStringHash(str) {
    let hash = 0;
    if (str.length === 0) return hash.toString();
    
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    return Math.abs(hash).toString(36).substring(0, 8);
  }

  /**
   * Translate text
   * @param {string} text - Original text (usually Chinese)
   * @param {string} language - Target language
   * @returns {string} - Translated text
   */
  translateText(text, language) {
    if (language === 'zh-CN' || !text) {
      return text;
    }
    // Placeholder for translation - would use actual translation service
    return text;
  }
}

export const reportGenerationService = new ReportGenerationServiceImpl();

// Cleanup old reports on application startup
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    reportGenerationService.cleanupOldReports();
  });
}

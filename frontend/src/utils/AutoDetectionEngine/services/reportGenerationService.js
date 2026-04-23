/**
 * @fileoverview Report Generation Service
 * Handles report creation, export, and management with i18n support
 */

import * as XLSX from 'xlsx';
import ReportStorage from '../storage/reportStorage.js';
import { createTranslationService } from './translationService.js';
import { detectUserLanguage, needsTranslation } from '../utils/languageDetector.js';
import { enhancedTranslate, containsChinese, validateTranslation } from './translationEnhancer.js';

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
  constructor() {
    // Initialize translation service
    this.translationService = createTranslationService(true);
    console.log('✅ ReportGenerationService initialized with translation support');
  }
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
        // Use ReportStorage for consistent storage
        const { default: ReportStorage } = require('@/utils/AutoDetectionEngine/storage/reportStorage');
        
        // If it's CodeDetectionReport, convert to DetectionReport format
        let finalReport;
        
        if ('defects' in report && 'summary' in report && typeof report.summary === 'object' && 'auto' in report.summary) {
          // This is CodeDetectionReport, needs format conversion
          finalReport = this.convertCodeDetectionReport(report);
        } else {
          // This is DetectionReport, use directly
          finalReport = report;
        }
        
        // Save using ReportStorage for consistency
        ReportStorage.save(finalReport);
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
        const { default: ReportStorage } = require('@/utils/AutoDetectionEngine/storage/reportStorage');
        return ReportStorage.list();
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
        const { default: ReportStorage } = require('@/utils/AutoDetectionEngine/storage/reportStorage');
        return ReportStorage.get(reportId);
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
        const { default: ReportStorage } = require('@/utils/AutoDetectionEngine/storage/reportStorage');
        ReportStorage.delete(reportId);
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
        const { default: ReportStorage } = require('@/utils/AutoDetectionEngine/storage/reportStorage');
        ReportStorage.cleanupOldReports();
      } catch (error) {
        console.error('清理过期报告失败:', error);
      }
    }
  }

  /**
   * Export report as CSV
   * @param {DetectionReport} report - Report to export
   * @param {string} [targetLang='auto'] - Target language ('auto' means use original AI output without translation)
   * @returns {Promise<string>} - CSV content
   */
  async exportReportAsCSV(report, targetLang = 'auto') {
    console.log(`[DEBUG exportReportAsCSV] 开始导出 CSV, 目标语言: ${targetLang}`);
    console.log(`[DEBUG exportReportAsCSV] 报告数据:`, {
      groupName: report.groupName,
      hasFileResults: !!report.fileResults,
      fileResultsCount: report.fileResults?.length || 0,
      totalDefects: report.totalDefects,
      sampleFileResult: report.fileResults?.[0]
    });
    
    // Use Tab as separator - Excel auto-detects TSV and never misparses tabs inside field values.
    // This avoids all comma/semicolon/quote ambiguity that caused column misalignment.
    const SEP = '\t';
    
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
    
    // "sep=\t" is an Excel-specific directive that tells Excel to use Tab as the
    // column separator when opening a .csv file by double-clicking.
    // It must be the very first line (before BOM or headers).
    let csv = 'sep=\t\n' + headers.join(SEP) + '\n';

    const traceId = report.sessionId || report.id || 'unknown-session';
    console.log(
      `🔗 [DEFECT_PIPELINE][${traceId}] stage=csv-export-start group=${report.groupName || 'root'} fileResults=${report.fileResults?.length || 0} totalDefects=${report.totalDefects || 0}`
    );

    // Collect all valid defects
    let defectIndex = 1;
    for (const fileResult of report.fileResults) {
      if (fileResult.hasDefects && fileResult.defects.length > 0) {
        const validDefects = fileResult.defects.filter(defect => 
          !this.isPlaceholderDefectInMarkdown(defect)
        );
        
        for (const defect of validDefects) {
          // Use original fields directly without translation (AI already outputs in correct language)
          let risk = '';
          let howToTrigger = '';
          
          if (defect.risk && defect.howToTrigger) {
            // Use preserved original fields directly
            let defectRisk = defect.risk;
            let defectHowToTrigger = defect.howToTrigger;
            
            if (typeof defectRisk === 'object' && defectRisk !== null) {
              console.warn('⚠️ defect.risk is object:', defectRisk);
              defectRisk = defectRisk.zh || defectRisk.en || String(defectRisk);
            }
            
            if (typeof defectHowToTrigger === 'object' && defectHowToTrigger !== null) {
              console.warn('⚠️ defect.howToTrigger is object:', defectHowToTrigger);
              defectHowToTrigger = defectHowToTrigger.zh || defectHowToTrigger.en || String(defectHowToTrigger);
            }
            
            // No translation needed - use original AI output
            risk = this.escapeTSV(defectRisk);
            howToTrigger = this.escapeTSV(defectHowToTrigger);
          } else {
            // Fallback: split from description (may not exist in JSON-parsed defects)
            const descriptionParts = (defect.description || '').split(' - ');
            risk = this.escapeTSV(descriptionParts[0] || '');
            howToTrigger = this.escapeTSV(descriptionParts.slice(1).join(' - ') || '');
          }
          
          // function / functionSymbol (JSON parser uses 'function', legacy uses 'functionSymbol')
          const functionSymbol = this.escapeTSV(
            defect['function'] || defect.functionSymbol || (defect.code || '').split('\n')[0] || ''
          );
          
          // Use original snippet or code - replace newlines/tabs to keep single-line
          const rawSnippet = (defect.snippet || defect.code || '')
            .replace(/\r?\n/g, ' ')
            .replace(/\t/g, ' ')
            .replace(/"/g, "'")
            .trim();
          const snippet = this.escapeTSV(rawSnippet);
          
          // Use original lines string
          const lines = this.escapeTSV(defect.lines || (defect.line > 0 ? `L${defect.line}` : ''));
          
          // confidence: JSON parser uses 'confidence' string directly; legacy used 'severity' enum
          const rawConfidence = defect.confidence || defect.severity || '';
          const confidence = rawConfidence === 'high' ? 'High'
            : rawConfidence === 'low' ? 'Low'
            : rawConfidence || 'Medium';
          
          // suggestedFix / recommendation (JSON parser uses 'suggestedFix', legacy uses 'recommendation')
          let defectRecommendation = defect.suggestedFix || defect.recommendation || '';
          if (typeof defectRecommendation === 'object' && defectRecommendation !== null) {
            defectRecommendation = defectRecommendation.zh || defectRecommendation.en || String(defectRecommendation);
          }
          
          // category / type (JSON parser uses 'category', legacy uses 'type')
          let defectType = defect.category || defect.type || '';
          if (typeof defectType === 'object' && defectType !== null) {
            defectType = defectType.zh || defectType.en || String(defectType);
          }
          
          const row = [
            defectIndex++,
            this.escapeTSV(defectType),
            this.escapeTSV(fileResult.file.path),
            functionSymbol,   // Already escaped above
            snippet,          // Already escaped above
            lines,            // Already escaped above
            risk,             // Already escaped above
            howToTrigger,     // Already escaped above
            this.escapeTSV(defectRecommendation),
            this.escapeTSV(confidence)
          ];
          
          // Final safety check: ensure no objects in the row
          for (let i = 0; i < row.length; i++) {
            if (typeof row[i] === 'object' && row[i] !== null) {
              console.error(`❌ CSV row contains object at index ${i}:`, row[i]);
              row[i] = row[i].en || row[i].zh || String(row[i]);
            }
          }
          
          csv += row.join(SEP) + '\n';
        }
      }
    }
    
    const csvRows = csv.split('\n').length - 1;
    console.log(`[DEBUG exportReportAsCSV] 生成的 CSV 行数: ${csvRows}, 缺陷数: ${defectIndex - 1}`);
    console.log(
      `🔗 [DEFECT_PIPELINE][${traceId}] stage=csv-export-done group=${report.groupName || 'root'} csvRows=${csvRows} defects=${defectIndex - 1}`
    );

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
              lines: defect.lines, // 保留行号范围
              code: defect.code,
              snippet: defect.snippet, // 保留原始snippet
              functionSymbol: defect.functionSymbol, // 保留函数符号
              description: defect.description,
              risk: defect.risk, // 保留原始risk
              howToTrigger: defect.howToTrigger, // 保留原始howToTrigger
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
   * @returns {Promise<Object>} Export result with content and metadata
   */
  async exportReport(report, format = 'csv', options = {}) {
    const { targetLang = 'auto', pretty = true } = options;
    
    let content;
    let mimeType;
    let extension;
    
    switch (format.toLowerCase()) {
      case 'csv':
        content = await this.exportReportAsCSV(report, targetLang);
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
      filename: this.generateExportFilename(report, extension, targetLang),
      size: new Blob([content]).size,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Generate export filename
   * @param {DetectionReport} report - Report
   * @param {string} extension - File extension
   * @param {string} [targetLang='auto'] - Target language (not used anymore since AI outputs in correct language)
   * @returns {string} Filename
   */
  generateExportFilename(report, extension, targetLang = 'auto') {
    const groupName = report.groupName || 'report';
    const timestamp = new Date(report.timestamp).toISOString().replace(/[:.]/g, '-').split('T')[0];
    
    // No language suffix needed - AI already outputs in user's language
    return `${groupName.toLowerCase()}_${timestamp}.${extension}`;
  }

  /**
   * Escape CSV field (handle commas, quotes, newlines)
   * @param {string} value - Value to escape
   * @returns {string} - Escaped value
   */
  escapeCSV(value) {
    if (!value) return '';
    
    // Handle object values that might have been passed incorrectly
    if (typeof value === 'object' && value !== null) {
      console.warn('⚠️ escapeCSV: Received object instead of string:', value);
      
      // Try to extract a meaningful string representation
      if (value.en) {
        value = value.en;
      } else if (value.zh) {
        value = value.zh;
      } else if (value.toString && typeof value.toString === 'function') {
        value = value.toString();
      } else {
        value = JSON.stringify(value);
      }
    }
    
    // Ensure we have a string
    value = String(value);
    
    // Replace double-quotes with single-quotes to avoid nested "" CSV escaping.
    // Excel (especially Chinese locale) misparses fields with embedded "" sequences,
    // causing column misalignment. Single-quotes are safe and preserve readability.
    value = value.replace(/"/g, "'");
    
    // If contains comma, newline, or semicolon (semicolon can be treated as
    // column separator in some regional Excel/CSV settings), wrap with quotes
    if (value.includes(',') || value.includes('\n') || value.includes(';')) {
      return `"${value}"`;
    }
    
    return value;
  }

  /**
   * Escape a field value for TSV (Tab-Separated Values).
   * Since Tab is the separator, only tabs and newlines inside the value need to be removed.
   * No quoting needed - makes Excel parsing 100% reliable.
   * @param {string} value - Value to escape
   * @returns {string}
   */
  escapeTSV(value) {
    if (!value && value !== 0) return '';
    if (typeof value === 'object' && value !== null) {
      value = value.zh || value.en || JSON.stringify(value);
    }
    return String(value)
      .replace(/\r?\n/g, ' ')  // newline → space
      .replace(/\t/g, ' ');    // tab → space (cannot have literal tab in a TSV field)
  }

  /**
   * Sanitize a cell value for xlsx output (remove newlines/tabs, keep everything else as-is)
   * @private
   */
  _xlsxCell(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
      value = value.zh || value.en || JSON.stringify(value);
    }
    return String(value).replace(/\r?\n/g, ' ').replace(/\t/g, ' ').trim();
  }

  /**
   * Generate an xlsx Blob directly from report data using SheetJS.
   * Returns { blob, fileName }.
   * @param {DetectionReport} report
   * @param {string} groupName
   * @returns {{ blob: Blob, fileName: string }}
   */
  generateXLSXReport(report, groupName) {
    const headers = [
      'No', 'Category', 'File', 'Function/Symbol',
      'Snippet', 'Lines', 'Risk', 'HowToTrigger', 'SuggestedFix', 'Confidence'
    ];

    const rows = [headers];
    let defectIndex = 1;

    for (const fileResult of report.fileResults) {
      if (!fileResult?.defects?.length) continue;

      const validDefects = fileResult.defects.filter(
        defect => !this.isPlaceholderDefectInMarkdown(defect)
      );

      // Fallback: if all defects were filtered out but raw defects exist, keep raw defects to avoid empty xlsx.
      const defectsForExport = validDefects.length > 0 ? validDefects : fileResult.defects;
      if (validDefects.length === 0 && fileResult.defects.length > 0) {
        console.warn('[generateXLSXReport] All defects filtered as placeholders, fallback to raw defects', {
          file: fileResult.file?.path,
          rawCount: fileResult.defects.length
        });
      }

      for (const defect of defectsForExport) {
        // risk
        let defectRisk = defect.risk || '';
        if (typeof defectRisk === 'object') defectRisk = defectRisk.zh || defectRisk.en || '';

        // howToTrigger
        let defectHowToTrigger = defect.howToTrigger || '';
        if (typeof defectHowToTrigger === 'object') defectHowToTrigger = defectHowToTrigger.zh || defectHowToTrigger.en || '';

        // fallback from description
        if (!defectRisk && !defectHowToTrigger && defect.description) {
          const parts = defect.description.split(' - ');
          defectRisk = parts[0] || '';
          defectHowToTrigger = parts.slice(1).join(' - ') || '';
        }

        // suggestedFix / recommendation (JSON parser uses 'suggestedFix', legacy uses 'recommendation')
        let defectRecommendation = defect.suggestedFix || defect.recommendation || '';
        if (typeof defectRecommendation === 'object') defectRecommendation = defectRecommendation.zh || defectRecommendation.en || '';

        // category / type (JSON parser uses 'category', legacy uses 'type')
        let defectType = defect.category || defect.type || '';
        if (typeof defectType === 'object') defectType = defectType.zh || defectType.en || '';

        // confidence: JSON parser uses 'confidence' string directly; legacy used 'severity' enum
        const rawConfidence = defect.confidence || defect.severity || '';
        const confidence = rawConfidence === 'high' ? 'High'
          : rawConfidence === 'low' ? 'Low'
          : rawConfidence || 'Medium';

        // function / functionSymbol (JSON parser uses 'function', legacy uses 'functionSymbol')
        const functionSymbol = this._xlsxCell(defect['function'] || defect.functionSymbol || (defect.code || '').split('\n')[0] || '');
        const snippet = this._xlsxCell(defect.snippet || defect.code || '');
        const lines = this._xlsxCell(defect.lines || (defect.line > 0 ? `L${defect.line}` : ''));

        rows.push([
          defectIndex++,
          this._xlsxCell(defectType),
          this._xlsxCell(fileResult.file.path),
          functionSymbol,
          snippet,
          lines,
          this._xlsxCell(defectRisk),
          this._xlsxCell(defectHowToTrigger),
          this._xlsxCell(defectRecommendation),
          confidence
        ]);
      }
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Set column widths for readability
    ws['!cols'] = [
      { wch: 5 },   // No
      { wch: 10 },  // Category
      { wch: 35 },  // File
      { wch: 30 },  // Function/Symbol
      { wch: 50 },  // Snippet
      { wch: 15 },  // Lines
      { wch: 20 },  // Risk
      { wch: 30 },  // HowToTrigger
      { wch: 40 },  // SuggestedFix
      { wch: 10 },  // Confidence
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Defects');

    const wbBuf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbBuf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const fileName = `${groupName.toLowerCase()}.xlsx`;
    return { blob, fileName };
  }

  /**
   * Check if defect is placeholder
   * @param {DefectInfo} defect - Defect to check
   * @returns {boolean} - True if placeholder
   */
  isPlaceholderDefectInMarkdown(defect) {
    const placeholders = ['----------', '-------', '------', '-----------------', '--------------', '-'];
    // NOTE: empty string '' intentionally removed from placeholders list –
    // snippet/code fields are optional (AI may omit them).
    // Only require that `type` (category) is a non-empty, non-placeholder string.
    
    const typeValue = defect.type;
    
    // If type is missing or is a pure placeholder dash sequence, treat as placeholder
    return !typeValue ||
      placeholders.includes(typeValue) ||
      (typeof typeValue === 'string' && typeValue.includes('---')) ||
      (typeof typeValue === 'string' && typeValue.trim() === '');
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
   * Download report as ZIP package with HTML summary
   * @param {DetectionReport} report - Report to download
   * @param {string} [groupName] - Group name
   * @returns {Promise<void>}
   */
  async downloadReport(report, groupName) {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      console.log(`📦 [reportGenerationService.downloadReport] 开始打包下载报告为 ZIP 格式...`);
      console.log(`📦 [reportGenerationService.downloadReport] 分组名称: ${groupName || report.groupName || 'root'}`);
      
      // Import zipPackageService
      const { default: zipPackageService } = await import('./zipPackageService.js');
      
      // Prepare defect reports - use xlsx directly to avoid all CSV parsing issues
      const gName = groupName || report.groupName || 'root';
      const { blob: xlsxBlob } = this.generateXLSXReport(report, gName);
      const xlsxBuffer = await xlsxBlob.arrayBuffer();

      // Collect flat defects list for HTML statistics (no CSV parsing needed)
      const allDefects = [];
      for (const fr of (report.fileResults || [])) {
        if (fr.hasDefects && fr.defects?.length) {
          for (const d of fr.defects) {
            if (!this.isPlaceholderDefectInMarkdown(d)) {
              allDefects.push({ ...d, _filePath: fr.file?.path || '' });
            }
          }
        }
      }

      const defectReports = [{
        groupName: gName,
        xlsxBuffer,           // xlsx binary for ZIP packaging
        defects: allDefects,  // flat list for statistics
        filesScanned: report.totalFiles || 0,
        defectsFound: report.totalDefects || 0
      }];
      
      console.log(`📦 [reportGenerationService.downloadReport] 准备缺陷报告完成`);
      
      // Prepare token statistics (if available)
      let tokenStatistics = null;
      if (report.metadata?.tokenStats) {
        tokenStatistics = this.generateTokenStatisticsCSV(report.metadata.tokenStats);
        console.log(`📦 [reportGenerationService.downloadReport] 包含 token 统计`);
      }
      
      // Generate HTML report
      const htmlReport = zipPackageService.generateHTMLSummary({
        defectReports,
        tokenStats: report.metadata?.tokenStats,
        sessionId: report.sessionId
      });
      
      console.log(`📦 [reportGenerationService.downloadReport] HTML 报告生成完成`);
      
      // Generate file name using report's original timestamp
      const reportTimestamp = new Date(report.timestamp || report.createdAt || Date.now()).toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_')
        .substring(0, 19);
      const fileName = `report_${reportTimestamp}`;
      
      // Package and download as ZIP
      console.log(`📦 [reportGenerationService.downloadReport] 调用 zipPackageService.packageAndDownload...`);
      console.log(`📦 [reportGenerationService.downloadReport] 文件名: ${fileName}.zip`);
      await zipPackageService.packageAndDownload({
        defectReports,
        tokenStatistics,
        htmlReport,
        fileName
      });
      
      console.log(`✅ [reportGenerationService.downloadReport] ZIP 包下载完成`);
    } catch (error) {
      console.error('❌ [reportGenerationService.downloadReport] 下载失败:', error);
      throw error;
    }
  }

  /**
   * Generate token statistics CSV content
   * @private
   */
  generateTokenStatisticsCSV(tokenStats) {
    if (!tokenStats) return '';
    
    const headers = ['Metric', 'Value'];
    let csv = headers.join(',') + '\n';
    
    csv += `Total Files,${tokenStats.filesProcessed || 0}\n`;
    csv += `Total Tokens,${tokenStats.totalTokens || 0}\n`;
    csv += `Prompt Tokens,${tokenStats.totalPromptTokens || 0}\n`;
    csv += `Completion Tokens,${tokenStats.totalCompletionTokens || 0}\n`;
    csv += `Duration,${tokenStats.duration || 0}ms\n`;
    
    return csv;
  }

  /**
   * Download a single file
   * @private
   * @param {DetectionReport} report - Report to download
   * @param {string} groupName - Group name
   * @param {string} targetLang - Target language ('auto' means no translation)
   * @param {string} format - Export format
   * @returns {Promise<void>}
   */
  async downloadFile(report, groupName, targetLang, format) {
    return new Promise(async (resolve) => {
      try {
        console.log(`[downloadFile] Generating xlsx via SheetJS`);

        // Always generate xlsx directly - avoids all CSV separator/encoding issues
        const { blob, fileName } = this.generateXLSXReport(report, groupName);
        const url = URL.createObjectURL(blob);

        console.log(`[downloadFile] 生成的文件名: ${fileName}, 大小: ${blob.size} bytes`);

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
        console.error('下载文件失败:', error);
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
        await this.downloadReport(report, report.groupName, format);
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
      console.log(`[DEBUG] 原始报告数据:`, {
        groupName: report.groupName,
        defectsCount: report.defects?.length || 0,
        filesScanned: report.filesScanned,
        hasDefects: !!report.defects,
        sampleDefect: report.defects?.[0]
      });
      
      // Convert to DetectionReport format
      const detectionReport = this.convertCodeDetectionReport(report);
      console.log(`[DEBUG] 转换后的 DetectionReport:`);
      console.log(`  - groupName: ${detectionReport.groupName}`);
      console.log(`  - totalDefects: ${detectionReport.totalDefects}`);
      console.log(`  - fileResultsCount: ${detectionReport.fileResults?.length || 0}`);
      console.log(`  - hasFileResults: ${!!detectionReport.fileResults}`);
      console.log(`  - fileResults 是数组: ${Array.isArray(detectionReport.fileResults)}`);
      console.log(`  - fileResults[0]:`, detectionReport.fileResults?.[0]);
      console.log(`  - fileResults 完整:`, JSON.stringify(detectionReport.fileResults, null, 2));
      
      // 1. Save to localStorage using ReportStorage (display in history)
      const reportToSave = {
        id: detectionReport.id,
        sessionId: report.sessionId || `session_${Date.now()}`,
        groupName: detectionReport.groupName || report.groupName,
        groupPath: report.groupPath || '',
        filesScanned: detectionReport.totalFiles || report.filesScanned || 0,
        defectsFound: detectionReport.totalDefects || report.defectsFound || 0,
        status: 'completed',
        createdAt: report.createdAt || new Date().toISOString(),
        timestamp: report.timestamp || Date.now(),
        defects: report.defects || [],
        fileResults: detectionReport.fileResults || [],
        summary: detectionReport.summary || { bySeverity: {}, byType: {} }
      };
      
      console.log(`[DEBUG saveGroupReports] reportToSave 准备保存:`);
      console.log(`  - fileResults 长度: ${reportToSave.fileResults?.length || 0}`);
      console.log(`  - fileResults 是否为数组: ${Array.isArray(reportToSave.fileResults)}`);
      console.log(`  - fileResults 第一项:`, reportToSave.fileResults?.[0]);
      console.log(`  - defects 长度: ${reportToSave.defects?.length || 0}`);
      
      const saved = ReportStorage.save(reportToSave);
      if (saved) {
        console.log(`  ✓ 已保存到历史记录 (ReportStorage)`);
        console.log(`  📝 报告数据:`, {
          id: reportToSave.id,
          groupName: reportToSave.groupName,
          filesScanned: reportToSave.filesScanned,
          defectsFound: reportToSave.defectsFound,
          hasFileResults: !!reportToSave.fileResults,
          fileResultsCount: reportToSave.fileResults?.length || 0,
          hasDefects: !!reportToSave.defects,
          defectsCount: reportToSave.defects?.length || 0
        });
        console.log(`[DEBUG] 保存到 localStorage 的完整数据:`, JSON.stringify(reportToSave, null, 2));
      } else {
        console.warn(`  ⚠ 保存到历史记录失败`);
      }
      
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
   * Convert CodeReviewReport to DetectionReport format
   * @param {Object} codeReport - Code review report
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
      let linesRange = ''; // 保留原始的行号范围字符串
      
      if (defect.lines && defect.lines.trim()) {
        linesRange = defect.lines.trim(); // 保留原始格式，如 "L20–L30"
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
          linesRange = `L${lineNumber}`; // 如果从描述中提取，也保存为字符串格式
        }
      }
      
      // According to 提示词.md required format, correctly separate each field
      fileDefects.push({
        type: defect.category,
        description: `${defect.risk} - ${defect.howToTrigger}`, // Maintain compatibility (for display)
        line: lineNumber,
        lines: linesRange, // 保留原始行号范围字符串
        code: defect.snippet,
        severity: this.mapConfidenceToSeverity(defect.confidence),
        recommendation: defect.suggestedFix,
        // 保留原始字段，用于CSV导出
        risk: defect.risk,
        howToTrigger: defect.howToTrigger,
        functionSymbol: defect.function,
        snippet: defect.snippet
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
    
    // Only check critical fields that must have meaningful content
    // Don't filter out defects just because some optional fields are empty
    const criticalValues = [
      defect.category,  // Must have category
      defect.file       // Must have file
    ];
    
    // Check if critical fields are empty or placeholder
    return criticalValues.some(value => 
      !value || 
      placeholders.includes(value) || 
      (typeof value === 'string' && value.includes('---')) || 
      (typeof value === 'string' && value.trim() === '')
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
   * Translate text using enhanced hybrid translation service
   * @param {string} text - Original text (usually Chinese)
   * @param {string} targetLang - Target language code
   * @returns {Promise<string>} - Translated text
   */
  async translateText(text, targetLang) {
    if (!text || targetLang === 'zh' || targetLang === 'zh-CN') {
      return text;
    }
    
    // Handle object inputs that might have been passed incorrectly
    if (typeof text === 'object' && text !== null) {
      console.warn('⚠️ translateText: Received object instead of string:', text);
      
      // Try to extract a meaningful string representation
      if (text.zh) {
        text = text.zh;
      } else if (text.en) {
        text = text.en;
      } else if (text.toString && typeof text.toString === 'function') {
        text = text.toString();
      } else {
        text = JSON.stringify(text);
      }
    }
    
    // Ensure we have a string
    text = String(text);
    
    try {
      // Use enhanced translation with quality checks
      const result = await enhancedTranslate(
        text,
        (t, lang) => this.translationService.translateText(t, lang),
        targetLang,
        {
          maxRetries: 2,
          useMixedMode: true,
          validateResult: true
        }
      );
      
      // Log quality issues
      if (result.validation && !result.validation.isValid) {
        console.warn(`⚠️ Translation quality issues for: "${text.substring(0, 50)}..."`, result.validation.issues);
      }
      
      // Ensure result is a string
      let translatedText = result.text;
      if (typeof translatedText === 'object' && translatedText !== null) {
        console.error('❌ Translation result is object, converting to string:', translatedText);
        translatedText = translatedText.en || translatedText.zh || String(translatedText);
      }
      
      translatedText = String(translatedText);
      
      // Check if result still contains Chinese
      if (containsChinese(translatedText)) {
        console.error(`❌ Translation failed - still contains Chinese: "${translatedText}"`);
        console.error(`   Original: "${text}"`);
        
        // Last resort: return original with warning
        return `[TRANSLATION_INCOMPLETE] ${translatedText}`;
      }
      
      return translatedText;
    } catch (error) {
      console.error('Translation failed, using original text:', error);
      return String(text);
    }
  }

  /**
   * Translate entire report
   * @param {DetectionReport} report - Report to translate
   * @param {string} targetLang - Target language code
   * @returns {Promise<DetectionReport>} - Translated report
   */
  async translateReport(report, targetLang) {
    if (!report || targetLang === 'zh' || targetLang === 'zh-CN') {
      return report;
    }

    console.log(`🌐 Translating report to ${targetLang}...`);
    const startTime = Date.now();

    try {
      // Create a copy to avoid mutating original
      const translatedReport = JSON.parse(JSON.stringify(report));

      // Translate all file results
      for (const fileResult of translatedReport.fileResults) {
        if (fileResult.hasDefects && fileResult.defects) {
          // Translate each defect
          for (let i = 0; i < fileResult.defects.length; i++) {
            const defect = fileResult.defects[i];
            
            // Translate defect fields
            if (defect.type) {
              defect.type = await this.translateText(defect.type, targetLang);
            }
            if (defect.description) {
              defect.description = await this.translateText(defect.description, targetLang);
            }
            if (defect.recommendation) {
              defect.recommendation = await this.translateText(defect.recommendation, targetLang);
            }
            if (defect.risk) {
              defect.risk = await this.translateText(defect.risk, targetLang);
            }
            if (defect.howToTrigger) {
              defect.howToTrigger = await this.translateText(defect.howToTrigger, targetLang);
            }
            
            // Note: code, snippet, functionSymbol, file paths are NOT translated
          }
        }
      }

      const duration = Date.now() - startTime;
      console.log(`✅ Report translation completed in ${duration}ms`);

      // Add translation metadata
      if (!translatedReport.metadata) {
        translatedReport.metadata = {};
      }
      translatedReport.metadata.translatedTo = targetLang;
      translatedReport.metadata.translationDuration = duration;
      translatedReport.metadata.translatedAt = new Date().toISOString();

      return translatedReport;
    } catch (error) {
      console.error('❌ Report translation failed:', error);
      // Return original report on error
      return report;
    }
  }
}

export const reportGenerationService = new ReportGenerationServiceImpl();

// Cleanup old reports on application startup
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    reportGenerationService.cleanupOldReports();
  });
}


// Export default
export default reportGenerationService;

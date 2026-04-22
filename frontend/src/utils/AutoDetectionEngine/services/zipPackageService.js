/**
 * @fileoverview ZIP Package Service
 * Handles packaging detection reports and token statistics into a ZIP file
 */

import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { generateIntegratedReport } from './htmlReportTemplate.js';

/**
 * ZIP Package Service Implementation
 */
class ZipPackageServiceImpl {
  constructor() {
    console.log('📦 ZipPackageService initialized');
  }

  /**
   * Package all reports and statistics into a ZIP file
   * @param {Object} options - Package options
   * @param {Array<{groupName: string, xlsxBuffer: ArrayBuffer, defects: Array}>} options.defectReports - Defect reports
   * @param {string} options.tokenStatistics - Token statistics CSV content
   * @param {string} [options.htmlReport] - HTML summary report (optional)
   * @param {string} [options.fileName] - Custom file name (without extension)
   * @returns {Promise<void>}
   */
  async packageAndDownload(options) {
    const {
      defectReports = [],
      tokenStatistics = '',
      htmlReport = null,
      fileName = null
    } = options;

    try {
      console.log('📦 Starting ZIP packaging...');
      console.log('  - Defect reports:', defectReports.length);
      console.log('  - Has token statistics:', !!tokenStatistics);
      console.log('  - Has HTML report:', !!htmlReport);

      const zip = new JSZip();

      // 1. Add defect reports to defects/ folder
      if (defectReports.length > 0) {
        const defectsFolder = zip.folder('defects');
        
        for (const report of defectReports) {
          if (report.xlsxBuffer) {
            // New path: xlsx binary
            const xlsxFileName = `${report.groupName.toLowerCase()}.xlsx`;
            defectsFolder.file(xlsxFileName, report.xlsxBuffer);
            console.log(`  ✓ Added: defects/${xlsxFileName}`);
          } else if (report.csvContent) {
            // Legacy fallback
            const csvFileName = `${report.groupName.toLowerCase()}.csv`;
            defectsFolder.file(csvFileName, report.csvContent);
            console.log(`  ✓ Added: defects/${csvFileName}`);
          }
        }
      }

      // 2. Add token statistics to root
      if (tokenStatistics) {
        zip.file('token_statistics.xlsx', tokenStatistics);
        console.log('  ✓ Added: token_statistics.xlsx');
      }

      // 3. Add HTML summary report to root (optional)
      if (htmlReport) {
        zip.file('summary.html', htmlReport);
        console.log('  ✓ Added: summary.html');
      }

      // 4. Generate ZIP file
      console.log('📦 Generating ZIP file...');
      const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: {
          level: 6
        }
      });

      // 5. Generate file name with report_ prefix
      const timestamp = new Date().toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_')
        .substring(0, 19);
      const zipFileName = fileName || `report_${timestamp}`;

      // 6. Trigger download
      saveAs(blob, `${zipFileName}.zip`);

      console.log(`✅ ZIP package downloaded: ${zipFileName}.zip`);
      console.log(`  - Size: ${(blob.size / 1024).toFixed(2)} KB`);

    } catch (error) {
      console.error('❌ Failed to package ZIP:', error);
      throw error;
    }
  }

  /**
   * Generate HTML summary report
   * @param {Object} options - Report options
   * @param {Array} options.defectReports - Defect reports with defect details
   * @param {Object} options.tokenStats - Token statistics
   * @param {string} options.sessionId - Session ID
   * @returns {string} - HTML content
   */
  generateHTMLSummary(options) {
    const { defectReports = [], tokenStats = null, sessionId = '' } = options;

    // Calculate totals
    const totalFiles = defectReports.reduce((sum, r) => sum + (r.filesScanned || 0), 0);
    const totalDefects = defectReports.reduce((sum, r) => sum + (r.defectsFound || 0), 0);
    
    // Calculate files with defects from defects array (or fallback to csvContent parsing)
    let filesWithDefects = 0;
    const fileSet = new Set(); // 用于去重，避免同一文件被计算多次
    
    defectReports.forEach(report => {
      if (report.defects?.length) {
        // New path: use structured defects array
        report.defects.forEach(d => {
          if (d._filePath) fileSet.add(d._filePath);
        });
      } else if (report.csvContent) {
        // Legacy fallback: parse CSV
        const lines = report.csvContent.split('\n');
        // Skip header row
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          
          // Parse CSV line, File is the third column
          const match = line.match(/^\d+,[^,]+,([^,]+),/);
          if (match) {
            const fileName = match[1];
            fileSet.add(fileName);
          }
        }
      }
    });
    
    filesWithDefects = fileSet.size;
    
    // Calculate defect rate: (files with defects / total files) * 100
    const defectRate = totalFiles > 0 ? ((filesWithDefects / totalFiles) * 100).toFixed(1) : 0;

    // Calculate defect type counts
    const defectTypeCounts = {};
    
    // Also calculate per-report defect types
    defectReports.forEach(report => {
      report.defectsByType = {}; // 初始化每个报告的缺陷类型统计

      if (report.defects?.length) {
        // New path: use structured defects array
        report.defects.forEach(d => {
          let category = d.type || '';
          if (typeof category === 'object') category = category.zh || category.en || '';
          category = String(category).toUpperCase();
          if (!category) return;
          defectTypeCounts[category] = (defectTypeCounts[category] || 0) + 1;
          report.defectsByType[category] = (report.defectsByType[category] || 0) + 1;
        });
      } else if (report.csvContent) {
        // Legacy fallback: parse CSV
        const lines = report.csvContent.split('\n');
        // Skip header row
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          
          // Parse CSV line, Category is the second column
          const match = line.match(/^\d+,([A-Z]+),/);
          if (match) {
            const category = match[1];
            // 全局统计
            defectTypeCounts[category] = (defectTypeCounts[category] || 0) + 1;
            // 每个报告的统计
            report.defectsByType[category] = (report.defectsByType[category] || 0) + 1;
          }
        }
      }
    });

    // Read the integrated report template
    const html = this._generateIntegratedReport({
      totalFiles,
      totalDefects,
      defectRate,
      defectReports,
      defectTypeCounts,
      tokenStats,
      sessionId
    });

    return html;
  }

  _generateIntegratedReport(data) {
    return generateIntegratedReport(data);
  }
}

// Create singleton instance
const zipPackageService = new ZipPackageServiceImpl();

export default zipPackageService;

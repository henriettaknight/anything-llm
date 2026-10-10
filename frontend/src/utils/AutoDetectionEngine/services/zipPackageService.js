/**
 * @fileoverview ZIP Package Service
 * Handles packaging detection reports and token statistics into a ZIP file
 */

import JSZip from 'jszip';
import { saveAs } from 'file-saver';

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
   * @param {string|ArrayBuffer} options.tokenStatistics - Token statistics (真 xlsx ArrayBuffer)
   * @param {string} [options.fileName] - Custom file name (without extension)
   * @returns {Promise<void>}
   */
  async packageAndDownload(options) {
    const {
      defectReports = [],
      tokenStatistics = '',
      fileName = null
    } = options;

    try {
      console.log('📦 Starting ZIP packaging...');
      console.log('  - Defect reports:', defectReports.length);
      console.log('  - Has token statistics:', !!tokenStatistics);

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

      // 3. HTML 报告已移除：报告统一以 xlsx 交付（缺陷明细 xlsx + token_statistics.xlsx）

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
}

// Create singleton instance
const zipPackageService = new ZipPackageServiceImpl();

export default zipPackageService;

/**
 * ReportGenerator
 * Generates HTML reports and ZIP packages
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const TempFileManager = require('./TempFileManager');
const I18NModule = require('./I18NModule');
const SecurityModule = require('./SecurityModule');

class ReportGenerator {
  constructor() {
    this.tempFileManager = new TempFileManager();
    this.i18n = new I18NModule();
    this.security = new SecurityModule();
  }

  /**
   * Generate HTML report
   * @param {string} sessionId - Session ID
   * @param {string} locale - Language locale
   * @returns {Promise<string>} Path to generated report
   */
  async generateHTMLReport(sessionId, locale) {
    const sessionDir = this.tempFileManager.getSessionDir(sessionId);
    const reportPath = path.join(sessionDir, 'reports', 'report.html');

    await fs.mkdir(path.dirname(reportPath), { recursive: true });

    // Read statistics data
    const statsData = await this._readStatisticsData(sessionId);
    
    // Generate HTML content
    const htmlContent = this._generateHTMLContent(statsData, locale, sessionId);

    await fs.writeFile(reportPath, htmlContent, 'utf-8');
    return reportPath;
  }

  /**
   * Read statistics data from CSV files
   * @private
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object>} Statistics data
   */
  async _readStatisticsData(sessionId) {
    const sessionDir = this.tempFileManager.getSessionDir(sessionId);
    const csvPath = path.join(sessionDir, 'token_statistics.csv');

    try {
      const csvContent = await fs.readFile(csvPath, 'utf-8');
      const lines = csvContent.trim().split('\n');
      
      if (lines.length < 2) {
        return { modules: [], summary: null };
      }

      const headers = lines[0].split(',');
      const records = [];

      for (let i = 1; i < lines.length; i++) {
        const values = this._parseCSVLine(lines[i]);
        const record = {};
        
        headers.forEach((header, index) => {
          record[header] = values[index];
        });
        
        records.push(record);
      }

      // Separate modules and summary
      const modules = records.filter(r => r.record_type === 'module');
      const summary = records.find(r => r.record_type === 'summary');

      return { modules, summary };
    } catch (error) {
      console.warn(`Failed to read statistics data: ${error.message}`);
      return { modules: [], summary: null };
    }
  }

  /**
   * Parse CSV line handling quoted values
   * @private
   * @param {string} line - CSV line
   * @returns {Array<string>} Parsed values
   */
  _parseCSVLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    
    values.push(current);
    return values;
  }

  /**
   * Generate HTML content
   * @private
   * @param {Object} statsData - Statistics data
   * @param {string} locale - Language locale
   * @param {string} sessionId - Session ID
   * @returns {string} HTML content
   */
  _generateHTMLContent(statsData, locale, sessionId) {
    const { modules, summary } = statsData;
    const generatedAt = new Date();

    return `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.i18n.translate('token_statistics_report', locale)}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background: #f5f5f5;
      padding: 20px;
    }
    
    .container {
      max-width: 1400px;
      margin: 0 auto;
      background: white;
      padding: 40px;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    
    h1 {
      color: #2c3e50;
      margin-bottom: 10px;
      font-size: 32px;
    }
    
    .meta {
      color: #7f8c8d;
      margin-bottom: 30px;
      font-size: 14px;
    }
    
    h2 {
      color: #34495e;
      margin-top: 40px;
      margin-bottom: 20px;
      font-size: 24px;
      border-bottom: 2px solid #3498db;
      padding-bottom: 10px;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 30px;
      font-size: 14px;
    }
    
    th {
      background: #3498db;
      color: white;
      padding: 12px 8px;
      text-align: left;
      font-weight: 600;
      white-space: nowrap;
    }
    
    td {
      padding: 10px 8px;
      border-bottom: 1px solid #ecf0f1;
    }
    
    tr:hover {
      background: #f8f9fa;
    }
    
    .number {
      text-align: right;
      font-family: 'Courier New', monospace;
    }
    
    .summary-table {
      background: #ecf0f1;
    }
    
    .summary-table th {
      background: #2c3e50;
    }
    
    .cost-positive {
      color: #e74c3c;
    }
    
    .cost-negative {
      color: #27ae60;
    }
    
    .status-completed {
      color: #27ae60;
      font-weight: 600;
    }
    
    .empty-state {
      text-align: center;
      padding: 40px;
      color: #95a5a6;
    }
    
    @media print {
      body {
        background: white;
        padding: 0;
      }
      
      .container {
        box-shadow: none;
        padding: 20px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>${this.i18n.translate('token_statistics_report', locale)}</h1>
    <div class="meta">
      ${this.i18n.translate('session_id', locale)}: ${sessionId}<br>
      ${this.i18n.translate('generated_at', locale)}: ${this.i18n.formatDate(generatedAt, locale)} ${generatedAt.toLocaleTimeString(locale)}
    </div>

    ${this._generateModulesSection(modules, locale)}
    ${this._generateSummarySection(summary, locale)}
  </div>
</body>
</html>`;
  }

  /**
   * Generate modules section HTML
   * @private
   * @param {Array} modules - Module records
   * @param {string} locale - Language locale
   * @returns {string} HTML content
   */
  _generateModulesSection(modules, locale) {
    if (!modules || modules.length === 0) {
      return `
    <h2>${this.i18n.translate('module_statistics', locale)}</h2>
    <div class="empty-state">
      ${this.i18n.translate('no_module_data', locale)}
    </div>`;
    }

    const rows = modules.map(module => {
      const costDiff = parseFloat(module.cost_difference || 0);
      const costClass = costDiff > 0 ? 'cost-positive' : costDiff < 0 ? 'cost-negative' : '';
      
      return `
      <tr>
        <td>${this._escapeHtml(module.module_name || '')}</td>
        <td class="number">${this._formatNumber(module.file_count)}</td>
        <td class="number">${this._formatNumber(module.total_lines)}</td>
        <td class="number">${this._formatNumber(module.code_lines)}</td>
        <td class="number">${this._formatNumber(module.comment_lines)}</td>
        <td class="number">${this._formatNumber(module.total_tokens)}</td>
        <td class="number">${this._formatFloat(module.avg_tokens_per_line, 2)}</td>
        <td class="number">${this.i18n.formatCurrency(parseFloat(module.deepseek_cost_usd || 0), locale)}</td>
        <td class="number">${this.i18n.formatCurrency(parseFloat(module.claude_cost_usd || 0), locale)}</td>
        <td class="number ${costClass}">${this.i18n.formatCurrency(costDiff, locale)}</td>
        <td class="status-completed">${this.i18n.translateEnumValue('status', module.status || 'completed', locale)}</td>
      </tr>`;
    }).join('');

    return `
    <h2>${this.i18n.translate('module_statistics', locale)}</h2>
    <table>
      <thead>
        <tr>
          <th>${this.i18n.translate('module_name', locale)}</th>
          <th>${this.i18n.translate('file_count', locale)}</th>
          <th>${this.i18n.translate('total_lines', locale)}</th>
          <th>${this.i18n.translate('code_lines', locale)}</th>
          <th>${this.i18n.translate('comment_lines', locale)}</th>
          <th>${this.i18n.translate('total_tokens', locale)}</th>
          <th>${this.i18n.translate('avg_tokens_per_line', locale)}</th>
          <th>${this.i18n.translate('deepseek_cost_usd', locale)}</th>
          <th>${this.i18n.translate('claude_cost_usd', locale)}</th>
          <th>${this.i18n.translate('cost_difference', locale)}</th>
          <th>${this.i18n.translate('status', locale)}</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>`;
  }

  /**
   * Generate summary section HTML
   * @private
   * @param {Object} summary - Summary record
   * @param {string} locale - Language locale
   * @returns {string} HTML content
   */
  _generateSummarySection(summary, locale) {
    if (!summary) {
      return '';
    }

    const costDiff = parseFloat(summary.cost_difference || 0);
    const costClass = costDiff > 0 ? 'cost-positive' : costDiff < 0 ? 'cost-negative' : '';

    return `
    <h2>${this.i18n.translate('global_statistics', locale)}</h2>
    <table class="summary-table">
      <thead>
        <tr>
          <th>${this.i18n.translate('metric', locale)}</th>
          <th>${this.i18n.translate('value', locale)}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${this.i18n.translate('file_count', locale)}</td>
          <td class="number">${this._formatNumber(summary.file_count)}</td>
        </tr>
        <tr>
          <td>${this.i18n.translate('total_lines', locale)}</td>
          <td class="number">${this._formatNumber(summary.total_lines)}</td>
        </tr>
        <tr>
          <td>${this.i18n.translate('code_lines', locale)}</td>
          <td class="number">${this._formatNumber(summary.code_lines)}</td>
        </tr>
        <tr>
          <td>${this.i18n.translate('comment_lines', locale)}</td>
          <td class="number">${this._formatNumber(summary.comment_lines)}</td>
        </tr>
        <tr>
          <td>${this.i18n.translate('input_tokens', locale)}</td>
          <td class="number">${this._formatNumber(summary.input_tokens)}</td>
        </tr>
        <tr>
          <td>${this.i18n.translate('output_tokens', locale)}</td>
          <td class="number">${this._formatNumber(summary.output_tokens)}</td>
        </tr>
        <tr>
          <td>${this.i18n.translate('total_tokens', locale)}</td>
          <td class="number">${this._formatNumber(summary.total_tokens)}</td>
        </tr>
        <tr>
          <td>${this.i18n.translate('avg_tokens_per_line', locale)}</td>
          <td class="number">${this._formatFloat(summary.avg_tokens_per_line, 2)}</td>
        </tr>
        <tr>
          <td>${this.i18n.translate('deepseek_cost_usd', locale)}</td>
          <td class="number">${this.i18n.formatCurrency(parseFloat(summary.deepseek_cost_usd || 0), locale)}</td>
        </tr>
        <tr>
          <td>${this.i18n.translate('claude_cost_usd', locale)}</td>
          <td class="number">${this.i18n.formatCurrency(parseFloat(summary.claude_cost_usd || 0), locale)}</td>
        </tr>
        <tr>
          <td>${this.i18n.translate('cost_difference', locale)}</td>
          <td class="number ${costClass}">${this.i18n.formatCurrency(costDiff, locale)}</td>
        </tr>
      </tbody>
    </table>`;
  }

  /**
   * Escape HTML special characters
   * @private
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  _escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  /**
   * Format number with fallback
   * @private
   * @param {string|number} value - Value to format
   * @returns {string} Formatted number
   */
  _formatNumber(value) {
    const num = parseInt(value);
    return isNaN(num) ? '0' : num.toLocaleString();
  }

  /**
   * Format float with precision
   * @private
   * @param {string|number} value - Value to format
   * @param {number} precision - Decimal places
   * @returns {string} Formatted float
   */
  _formatFloat(value, precision) {
    const num = parseFloat(value);
    return isNaN(num) ? '0.00' : num.toFixed(precision);
  }

  /**
   * Generate ZIP package
   * Requirement 4.4: Package CSV files into ZIP format
   * Requirement 4.5: Use naming format token_statistics_[模块名]_[年月日_时分秒].zip
   * Requirement 5.6: Include report.html in ZIP package
   * Requirement 11.5: Compatible with Chrome, Firefox, Safari, Edge browsers
   * @param {string} sessionId - Session ID
   * @param {string} moduleName - Module name for filename
   * @param {string} locale - Language locale
   * @returns {Promise<string>} Path to generated ZIP file
   */
  async generateZIPPackage(sessionId, moduleName, locale) {
    const AdmZip = require('adm-zip');
    const sessionDir = this.tempFileManager.getSessionDir(sessionId);
    
    // Generate timestamp in format: YYYYMMDD_HHMMSS
    // Requirement 4.5: File naming format
    const now = new Date();
    const timestamp = now.toISOString()
      .replace(/[-:]/g, '')
      .replace('T', '_')
      .slice(0, 15); // YYYYMMDD_HHMMSS
    
    // Sanitize module name for filename (remove special characters)
    const sanitizedModuleName = moduleName.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '_');
    
    const zipFilename = `token_statistics_${sanitizedModuleName}_${timestamp}.zip`;
    const zipPath = path.join(sessionDir, 'downloads', zipFilename);

    // Ensure downloads directory exists
    await fs.mkdir(path.dirname(zipPath), { recursive: true });

    try {
      // Create ZIP archive
      const zip = new AdmZip();

      // Add token_statistics.csv (main statistics file)
      const statsPath = path.join(sessionDir, 'token_statistics.csv');
      try {
        const statsExists = await this._fileExists(statsPath);
        if (statsExists) {
          zip.addLocalFile(statsPath);
        }
      } catch (error) {
        console.warn(`Could not add token_statistics.csv: ${error.message}`);
      }

      // Add all token_files_*.csv files from details directory
      const detailsDir = path.join(sessionDir, 'details');
      try {
        const detailsExists = await this._fileExists(detailsDir);
        if (detailsExists) {
          const detailFiles = await fs.readdir(detailsDir);
          for (const file of detailFiles) {
            if (file.startsWith('token_files_') && file.endsWith('.csv')) {
              const filePath = path.join(detailsDir, file);
              zip.addLocalFile(filePath, 'details/');
            }
          }
        }
      } catch (error) {
        console.warn(`Could not add detail files: ${error.message}`);
      }

      // Add HTML report if it exists
      // Requirement 5.6: Include report.html in ZIP package
      const reportPath = path.join(sessionDir, 'reports', 'report.html');
      try {
        const reportExists = await this._fileExists(reportPath);
        if (reportExists) {
          zip.addLocalFile(reportPath, 'reports/');
        }
      } catch (error) {
        console.warn(`Could not add report.html: ${error.message}`);
      }

      // Add README file with instructions
      const readmeContent = this._generateReadmeContent(locale);
      zip.addFile('README.txt', Buffer.from(readmeContent, 'utf-8'));

      // Write ZIP file
      zip.writeZip(zipPath);

      console.log(`ZIP package created: ${zipPath}`);
      return zipPath;
    } catch (error) {
      console.error(`Error creating ZIP package: ${error.message}`);
      throw new Error(`ZIP_GENERATION_ERROR: ${error.message}`);
    }
  }

  /**
   * Check if file exists
   * @private
   * @param {string} filePath - File path to check
   * @returns {Promise<boolean>} Whether file exists
   */
  async _fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generate README content for ZIP package
   * @private
   * @param {string} locale - Language locale
   * @returns {string} README content
   */
  _generateReadmeContent(locale) {
    const templates = {
      'zh-CN': `Token 使用统计报告
==================

本压缩包包含以下文件：

1. token_statistics.csv - 模块级统计汇总表
2. details/token_files_*.csv - 各模块的文件详细记录
3. reports/report.html - 可视化 HTML 报告

使用说明：
- 使用 Excel、Google Sheets 或其他电子表格软件打开 CSV 文件
- 在浏览器中打开 report.html 查看可视化报告
- 所有文件使用 UTF-8 编码

计价模型：
- DeepSeek: 输入 $0.001/千Token，输出 $0.002/千Token
- Claude-3.5-Sonnet: 输入 $0.003/千Token，输出 $0.015/千Token

生成时间: ${new Date().toLocaleString(locale)}
`,
      'en-US': `Token Usage Statistics Report
=============================

This package contains the following files:

1. token_statistics.csv - Module-level statistics summary
2. details/token_files_*.csv - Detailed file records for each module
3. reports/report.html - Visual HTML report

Instructions:
- Open CSV files with Excel, Google Sheets, or other spreadsheet software
- Open report.html in a web browser to view the visual report
- All files are encoded in UTF-8

Pricing Models:
- DeepSeek: Input $0.001/1K tokens, Output $0.002/1K tokens
- Claude-3.5-Sonnet: Input $0.003/1K tokens, Output $0.015/1K tokens

Generated at: ${new Date().toLocaleString(locale)}
`,
      'ja-JP': `トークン使用統計レポート
========================

このパッケージには以下のファイルが含まれています：

1. token_statistics.csv - モジュールレベルの統計サマリー
2. details/token_files_*.csv - 各モジュールの詳細ファイル記録
3. reports/report.html - ビジュアルHTMLレポート

使用方法：
- Excel、Google Sheets、または他のスプレッドシートソフトウェアでCSVファイルを開く
- ブラウザでreport.htmlを開いてビジュアルレポートを表示
- すべてのファイルはUTF-8エンコーディングです

価格モデル：
- DeepSeek: 入力 $0.001/1Kトークン、出力 $0.002/1Kトークン
- Claude-3.5-Sonnet: 入力 $0.003/1Kトークン、出力 $0.015/1Kトークン

生成日時: ${new Date().toLocaleString(locale)}
`,
      'ko-KR': `토큰 사용 통계 보고서
====================

이 패키지에는 다음 파일이 포함되어 있습니다:

1. token_statistics.csv - 모듈 수준 통계 요약
2. details/token_files_*.csv - 각 모듈의 상세 파일 기록
3. reports/report.html - 시각화 HTML 보고서

사용 방법:
- Excel, Google Sheets 또는 다른 스프레드시트 소프트웨어로 CSV 파일 열기
- 브라우저에서 report.html을 열어 시각화 보고서 보기
- 모든 파일은 UTF-8 인코딩입니다

가격 모델:
- DeepSeek: 입력 $0.001/1K토큰, 출력 $0.002/1K토큰
- Claude-3.5-Sonnet: 입력 $0.003/1K토큰, 출력 $0.015/1K토큰

생성 시간: ${new Date().toLocaleString(locale)}
`,
    };

    return templates[locale] || templates['en-US'];
  }

  /**
   * Generate download link with signed token
   * Requirement 9.2: Generate unique signed token using encryption algorithm
   * Requirement 9.3: Validate signature token validity and expiration time
   * Requirement 9.4: Return 403 error if token is invalid or expired
   * Requirement 6.5: Set link expiration to 24 hours
   * @param {string} sessionId - Session ID
   * @param {string} zipPath - Path to ZIP file
   * @returns {Promise<Object>} Download link information
   */
  async generateDownloadLink(sessionId, zipPath) {
    // Requirement 6.5: Set expiration to 24 hours
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const filename = path.basename(zipPath);

    // Requirement 9.2: Generate HMAC-SHA256 signature using SecurityModule
    const token = this.security.generateDownloadToken(sessionId, filename, expiresAt);

    return {
      url: `/api/token-statistics/download/${sessionId}/${token}/${filename}`,
      token,
      expiresAt,
      filename,
    };
  }

  /**
   * Validate download token
   * Requirement 9.3: Validate signature token validity and expiration time
   * Requirement 9.4: Return 403 error if token is invalid or expired
   * @param {string} sessionId - Session ID
   * @param {string} token - Download token
   * @param {string} filename - ZIP filename
   * @returns {Promise<Object>} Validation result
   */
  async validateDownloadToken(sessionId, token, filename) {
    try {
      // Verify file exists and get its creation time
      const sessionDir = this.tempFileManager.getSessionDir(sessionId);
      const zipPath = path.join(sessionDir, 'downloads', filename);
      
      // Requirement 9.5: Validate file path to prevent path traversal
      const pathValidation = this.security.validateFilePath(zipPath, sessionDir);
      if (!pathValidation.valid) {
        return pathValidation;
      }

      // Verify file exists
      const fileExists = await this._fileExists(zipPath);
      if (!fileExists) {
        return {
          valid: false,
          statusCode: 404,
          error: 'FILE_NOT_FOUND',
          message: 'Download file not found or has been deleted',
        };
      }

      // Get file stats to determine expiration
      const stats = await fs.stat(zipPath);
      const expiresAt = new Date(stats.mtimeMs + 24 * 60 * 60 * 1000);

      // Requirement 9.3 & 9.4: Validate token using SecurityModule
      const validation = this.security.validateDownloadToken(sessionId, token, filename, expiresAt);
      
      if (!validation.valid) {
        return validation;
      }

      // Token is valid, return success with file path
      return {
        valid: true,
        zipPath,
        filename,
        expiresAt,
      };
    } catch (error) {
      console.error(`Error validating download token: ${error.message}`);
      return {
        valid: false,
        statusCode: 500,
        error: 'VALIDATION_ERROR',
        message: 'Token validation failed',
      };
    }
  }

  /**
   * Trigger browser download
   * Requirement 11.5: Compatible with Chrome, Firefox, Safari, Edge browsers
   * @param {Object} res - Express response object
   * @param {string} zipPath - Path to ZIP file
   * @param {string} filename - Download filename
   */
  async triggerBrowserDownload(res, zipPath, filename) {
    try {
      // Set headers for browser download compatibility
      // These headers work across Chrome, Firefox, Safari, and Edge
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      // Get file stats for Content-Length header
      const stats = await fs.stat(zipPath);
      res.setHeader('Content-Length', stats.size);

      // Stream file to response
      const fileStream = require('fs').createReadStream(zipPath);
      
      fileStream.on('error', (error) => {
        console.error(`Error streaming file: ${error.message}`);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Error downloading file' });
        }
      });

      fileStream.pipe(res);
    } catch (error) {
      console.error(`Error triggering download: ${error.message}`);
      throw error;
    }
  }
}

module.exports = ReportGenerator;

/**
 * Example Express endpoint for token statistics download
 * This demonstrates how to integrate the ZIP download functionality into an Express API
 * 
 * Requirements covered:
 * - 9.2: Generate unique signed token using encryption algorithm
 * - 9.3: Validate signature token validity and expiration time
 * - 9.4: Return 403 error if token is invalid or expired
 * - 11.5: Compatible with Chrome, Firefox, Safari, Edge browsers
 */

const express = require('express');
const ReportGenerator = require('./ReportGenerator');

const router = express.Router();
const reportGenerator = new ReportGenerator();

/**
 * Generate download link for a session
 * POST /api/token-statistics/generate-download
 * 
 * Body:
 * {
 *   "sessionId": "uuid",
 *   "moduleName": "模块名称",
 *   "locale": "zh-CN"
 * }
 */
router.post('/generate-download', async (req, res) => {
  try {
    const { sessionId, moduleName, locale = 'zh-CN' } = req.body;

    if (!sessionId || !moduleName) {
      return res.status(400).json({
        error: 'BAD_REQUEST',
        message: 'sessionId and moduleName are required',
      });
    }

    // Generate HTML report first
    await reportGenerator.generateHTMLReport(sessionId, locale);

    // Generate ZIP package
    const zipPath = await reportGenerator.generateZIPPackage(
      sessionId,
      moduleName,
      locale
    );

    // Generate signed download link
    const downloadLink = await reportGenerator.generateDownloadLink(
      sessionId,
      zipPath
    );

    res.json({
      success: true,
      download: {
        url: downloadLink.url,
        filename: downloadLink.filename,
        expiresAt: downloadLink.expiresAt,
        expiresIn: '24 hours',
      },
    });
  } catch (error) {
    console.error('Error generating download:', error);
    res.status(500).json({
      error: 'GENERATION_ERROR',
      message: error.message,
    });
  }
});

/**
 * Download ZIP file with token validation
 * GET /api/token-statistics/download/:sessionId/:token/:filename
 * 
 * Requirements:
 * - 9.3: Validate signature token validity and expiration time
 * - 9.4: Return 403 error if token is invalid or expired
 * - 11.5: Compatible with Chrome, Firefox, Safari, Edge browsers
 */
router.get('/download/:sessionId/:token/:filename', async (req, res) => {
  try {
    const { sessionId, token, filename } = req.params;

    // Validate download token
    // Requirement 9.3: Validate signature token validity and expiration time
    const validation = await reportGenerator.validateDownloadToken(
      sessionId,
      token,
      filename
    );

    if (!validation.valid) {
      // Requirement 9.4: Return 403 error if token is invalid or expired
      return res.status(403).json({
        error: validation.error,
        message: validation.message,
      });
    }

    // Trigger browser download
    // Requirement 11.5: Compatible with Chrome, Firefox, Safari, Edge browsers
    await reportGenerator.triggerBrowserDownload(
      res,
      validation.zipPath,
      validation.filename
    );
  } catch (error) {
    console.error('Error downloading file:', error);
    
    if (!res.headersSent) {
      res.status(500).json({
        error: 'DOWNLOAD_ERROR',
        message: error.message,
      });
    }
  }
});

/**
 * Check download link status
 * GET /api/token-statistics/download-status/:sessionId/:token/:filename
 */
router.get('/download-status/:sessionId/:token/:filename', async (req, res) => {
  try {
    const { sessionId, token, filename } = req.params;

    const validation = await reportGenerator.validateDownloadToken(
      sessionId,
      token,
      filename
    );

    if (!validation.valid) {
      return res.json({
        valid: false,
        error: validation.error,
        message: validation.message,
      });
    }

    // Get file info
    const fs = require('fs').promises;
    const stats = await fs.stat(validation.zipPath);
    const now = Date.now();
    const fileAge = now - stats.mtimeMs;
    const remainingTime = (24 * 60 * 60 * 1000) - fileAge;

    res.json({
      valid: true,
      filename: validation.filename,
      size: stats.size,
      createdAt: stats.mtime,
      expiresIn: Math.max(0, Math.floor(remainingTime / 1000 / 60)), // minutes
    });
  } catch (error) {
    console.error('Error checking download status:', error);
    res.status(500).json({
      error: 'STATUS_CHECK_ERROR',
      message: error.message,
    });
  }
});

module.exports = router;

/**
 * Usage example in main Express app:
 * 
 * const express = require('express');
 * const tokenStatsDownloadRouter = require('./token-statistics/download-endpoint-example');
 * 
 * const app = express();
 * app.use(express.json());
 * app.use('/api/token-statistics', tokenStatsDownloadRouter);
 * 
 * app.listen(3000, () => {
 *   console.log('Server running on port 3000');
 * });
 */

/**
 * Client-side usage example:
 * 
 * // 1. Generate download link
 * const response = await fetch('/api/token-statistics/generate-download', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({
 *     sessionId: 'your-session-id',
 *     moduleName: '测试模块',
 *     locale: 'zh-CN'
 *   })
 * });
 * 
 * const data = await response.json();
 * console.log('Download URL:', data.download.url);
 * 
 * // 2. Trigger download in browser
 * window.location.href = data.download.url;
 * 
 * // Or use a download link
 * <a href={data.download.url} download={data.download.filename}>
 *   下载统计报告
 * </a>
 */

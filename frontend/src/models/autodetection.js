import configService from "@/services/autoDetection/configService";
import detectionService from "@/services/autoDetection/detectionService";
import reportService from "@/services/autoDetection/reportService";

const AutoDetectionAPI = {
  // Get current configuration
  getConfig: async () => {
    try {
      const config = await configService.getConfig();
      return {
        success: true,
        config: {
          directory: config.targetDirectory || "",
          detectionTime: config.detectionTime || "",
          enabled: config.enabled || false,
        },
      };
    } catch (error) {
      console.error("Error fetching config:", error);
      return { success: false, error: error.message };
    }
  },

  // Save configuration
  saveConfig: async (config) => {
    try {
      const result = await configService.saveConfig({
        targetDirectory: config.directory || "",
        detectionTime: config.detectionTime || "",
        enabled: config.enabled || false,
        fileTypes: config.fileTypes || ['.h', '.cpp', '.c', '.hpp', '.cc'],
        excludePatterns: config.excludePatterns || [
          '**/node_modules/**',
          '**/build/**',
          '**/dist/**',
          '**/.git/**',
          '**/temp/**',
          '**/tmp/**'
        ],
        batchSize: config.batchSize || 10,
        retryAttempts: config.retryAttempts || 3,
        notificationEnabled: config.notificationEnabled !== false,
      });
      return result;
    } catch (error) {
      console.error("Error saving config:", error);
      return { success: false, error: error.message };
    }
  },

  // Start detection
  start: async () => {
    try {
      const result = await detectionService.start();
      return result;
    } catch (error) {
      console.error("Error starting detection:", error);
      return { success: false, error: error.message };
    }
  },

  // Set report generated callback
  setOnReportGenerated: (callback) => {
    detectionService.setOnReportGenerated(callback);
  },

  // Stop detection
  stop: async () => {
    try {
      const result = await detectionService.stop();
      return result;
    } catch (error) {
      console.error("Error stopping detection:", error);
      return { success: false, error: error.message };
    }
  },

  // Get detection status
  getStatus: async () => {
    try {
      const result = await detectionService.getStatus();
      return result;
    } catch (error) {
      console.error("Error fetching status:", error);
      return { success: false, error: error.message };
    }
  },

  // Get reports list
  getReports: async () => {
    try {
      const result = await reportService.getReports();
      
      // Transform reports to match UI expectations
      const transformedReports = result.reports.map(report => ({
        id: report.id,
        groupName: report.groupName,  // ✅ 保留 groupName
        timestamp: report.createdAt,
        scannedFiles: report.filesScanned,
        filesScanned: report.filesScanned,  // ✅ 添加 filesScanned
        defectsFound: report.defectsFound,
        directory: report.groupPath,
        groupPath: report.groupPath,  // ✅ 添加 groupPath
        createdAt: report.createdAt,  // ✅ 添加 createdAt
      }));

      return {
        success: true,
        reports: transformedReports,
      };
    } catch (error) {
      console.error("Error fetching reports:", error);
      return { success: false, error: error.message };
    }
  },

  // Download report
  downloadReport: async (reportId) => {
    try {
      console.log(`[DEBUG AutoDetectionAPI.downloadReport] 开始手动下载报告: ${reportId}`);
      
      // Get report from storage
      const report = await reportService.getReport(reportId);
      if (!report.success || !report.report) {
        return { success: false, error: 'Report not found' };
      }
      
      console.log(`[DEBUG AutoDetectionAPI.downloadReport] 获取到的报告:`, {
        reportId,
        groupName: report.report.groupName,
        hasFileResults: !!report.report.fileResults,
        fileResultsCount: report.report.fileResults?.length || 0,
        hasDefects: !!report.report.defects,
        defectsCount: report.report.defects?.length || 0
      });
      
      // Use reportGenerationService to download (same as auto-download)
      const { reportGenerationService } = await import('@/utils/AutoDetectionEngine/services/reportGenerationService.js');
      await reportGenerationService.downloadReport(report.report, report.report.groupName);
      
      return { success: true };
    } catch (error) {
      console.error("Error downloading report:", error);
      return { success: false, error: error.message };
    }
  },

  // Delete report
  deleteReport: async (reportId) => {
    try {
      const result = await reportService.deleteReport(reportId);
      return result;
    } catch (error) {
      console.error("Error deleting report:", error);
      return { success: false, error: error.message };
    }
  },

  // Save report
  saveReport: async (report) => {
    try {
      const result = await reportService.saveReport(report);
      return result;
    } catch (error) {
      console.error("Error saving report:", error);
      return { success: false, error: error.message };
    }
  },

  // Save directory handle to IndexedDB
  saveDirectoryHandle: async (handle, key = "autodetection-directory") => {
    try {
      if (!window.indexedDB) {
        throw new Error("IndexedDB not supported");
      }

      return new Promise((resolve, reject) => {
        const request = indexedDB.open("AnythingLLM", 1);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(["directoryHandles"], "readwrite");
          const store = transaction.objectStore("directoryHandles");
          const putRequest = store.put({ key, handle });

          putRequest.onerror = () => reject(putRequest.error);
          putRequest.onsuccess = () => resolve(true);
        };

        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains("directoryHandles")) {
            db.createObjectStore("directoryHandles", { keyPath: "key" });
          }
        };
      });
    } catch (error) {
      console.error("Error saving directory handle:", error);
      return false;
    }
  },

  // Restore directory handle from IndexedDB
  restoreDirectoryHandle: async (key = "autodetection-directory") => {
    try {
      if (!window.indexedDB) {
        throw new Error("IndexedDB not supported");
      }

      return new Promise((resolve, reject) => {
        const request = indexedDB.open("AnythingLLM", 1);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(["directoryHandles"], "readonly");
          const store = transaction.objectStore("directoryHandles");
          const getRequest = store.get(key);

          getRequest.onerror = () => reject(getRequest.error);
          getRequest.onsuccess = () => resolve(getRequest.result?.handle || null);
        };

        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains("directoryHandles")) {
            db.createObjectStore("directoryHandles", { keyPath: "key" });
          }
        };
      });
    } catch (error) {
      console.error("Error restoring directory handle:", error);
      return null;
    }
  },
};

export default AutoDetectionAPI;

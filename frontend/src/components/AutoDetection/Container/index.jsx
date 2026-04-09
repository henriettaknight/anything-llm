import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import AutoDetectionAPI from "@/models/autodetection";
import configService from "@/services/autoDetection/configService";
import { reportGenerationService } from "@/utils/AutoDetectionEngine/services/reportGenerationService";
import ConfigPanel from "./ConfigPanel";
import StatusPanel from "./StatusPanel";
import ReportPanel from "./ReportPanel";

export default function AutoDetectionContainer() {
  const { t } = useTranslation();
  const [config, setConfig] = useState({
    directory: "",
    detectionTime: "",
    projectType: "",
    enabled: false,
  });
  const [status, setStatus] = useState({
    status: "idle", // idle, running, paused, error
    progress: {
      completed: 0,
      total: 0,
    },
    timeToDetection: null,
    error: null,
  });
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [reportCreated, setReportCreated] = useState(false); // 标记报告是否已创建

  // Load initial config and reports on mount
  useEffect(() => {
    loadInitialData();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      console.log('🧹 Cleaning up AutoDetection component');
      // Component is unmounting, ensure all intervals are cleared
    };
  }, []);

  // Poll for status updates when detection is running
  useEffect(() => {
    if (status.status === "running") {
      const interval = setInterval(() => {
        loadStatus();
      }, 5000); // Poll every 5 seconds
      return () => {
        console.log('🛑 Clearing status polling interval');
        clearInterval(interval);
      };
    }
    // Also clear when status changes to completed or error
    if (status.status === "completed" || status.status === "error" || status.status === "idle") {
      console.log(`✅ Detection status is ${status.status}, polling stopped`);
    }
  }, [status.status]);

  // Generate report when detection completes (only if shouldGenerateReport flag is set)
  useEffect(() => {
    if (status.status === "completed" && status.detectionResult?.shouldGenerateReport) {
      // Detection just completed, create a report
      createReport();
      
      // Clear the flag to prevent re-generation on page refresh
      setStatus(prev => ({
        ...prev,
        detectionResult: {
          ...prev.detectionResult,
          shouldGenerateReport: false
        }
      }));
    }
  }, [status.status, status.detectionResult?.shouldGenerateReport]);

  // Update countdown timer every minute
  useEffect(() => {
    if (config.detectionTime && (status.status === "idle" || status.status === "waiting")) {
      const interval = setInterval(() => {
        updateTimeToDetection();
      }, 60000); // Update every minute
      updateTimeToDetection(); // Initial update
      return () => clearInterval(interval);
    }
  }, [config.detectionTime, status.status]);

  const loadInitialData = async () => {
    try {
      setLoading(true);
      await Promise.all([loadConfig(), loadReports(), loadStatus()]);
    } catch (error) {
      console.error("Failed to load initial data:", error);
      const errorMsg = typeof error === 'string' ? error : (error?.message || "Failed to load configuration");
      setStatus((prev) => ({
        ...prev,
        status: "error",
        error: errorMsg,
      }));
    } finally {
      setLoading(false);
    }
  };

  const loadConfig = useCallback(async () => {
    try {
      const config = await configService.getConfig();
      setConfig({
        directory: config.targetDirectory || "",
        detectionTime: config.detectionTime || "",
        projectType: config.projectType || "",
        enabled: config.enabled || false,
      });
    } catch (error) {
      console.error("Failed to load config:", error);
    }
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const result = await AutoDetectionAPI.getStatus();
      if (result.success) {
        const newStatus = result.status || {
          status: "idle",
          progress: { completed: 0, total: 0 },
          timeToDetection: null,
          error: null,
        };
        
        // 🔍 调试：记录状态轮询
        console.log('🔄 状态轮询结果:', {
          时间: new Date().toISOString(),
          新状态: newStatus.status,
          进度: newStatus.progress
        });
        
        // Only update if status actually changed or if still running
        setStatus(prevStatus => {
          // If previous status was completed/error and new status is the same, don't update
          if ((prevStatus.status === "completed" || prevStatus.status === "error") && 
              prevStatus.status === newStatus.status) {
            console.log(`⏸️ Skipping status update - already in final state: ${prevStatus.status}`);
            return prevStatus;
          }
          
          // Log status changes
          if (prevStatus.status !== newStatus.status) {
            console.log(`📊 Status changed: ${prevStatus.status} → ${newStatus.status}`);
            console.log('📊 状态变更时间:', new Date().toISOString());
            console.trace('状态变更调用栈:');
          }
          
          return newStatus;
        });
      }
    } catch (error) {
      console.error("Failed to load status:", error);
    }
  }, []);

  const loadReports = useCallback(async () => {
    try {
      const result = await AutoDetectionAPI.getReports();
      if (result.success) {
        setReports(result.reports || []);
      }
    } catch (error) {
      console.error("Failed to load reports:", error);
    }
  }, []);

  // 处理单个分组报告生成
  const handleGroupReportGenerated = useCallback(async (groupReport) => {
    try {
      // 先转换报告格式，从 defects 生成 fileResults
      const reportGenerationService = (await import('@/utils/AutoDetectionEngine/services/reportGenerationService.js')).default;
      
      // 构造用于转换的报告对象
      const reportForConversion = {
        id: `report_${groupReport.timestamp}_${groupReport.groupName}`,
        groupName: groupReport.groupName,
        filesScanned: groupReport.filesScanned,
        defectsFound: groupReport.defectsFound,
        defects: groupReport.defects || [],
        timestamp: groupReport.timestamp
      };
      
      // 转换为 DetectionReport 格式（包含 fileResults）
      const detectionReport = reportGenerationService.convertCodeDetectionReport(reportForConversion);
      
      // 准备保存的报告（使用转换后的 fileResults）
      const reportToSave = {
        id: detectionReport.id,
        sessionId: groupReport.sessionId,
        groupName: detectionReport.groupName,
        groupPath: groupReport.groupPath,
        filesScanned: detectionReport.totalFiles,
        defectsFound: detectionReport.totalDefects,
        status: 'completed',
        createdAt: groupReport.createdAt,
        timestamp: groupReport.timestamp,
        defects: groupReport.defects || [],
        fileResults: detectionReport.fileResults || [],  // ← 使用转换后的 fileResults
        summary: detectionReport.summary || { bySeverity: {}, byType: {} }
      };
      
      // 1. 保存到 localStorage
      const ReportStorage = (await import('@/utils/AutoDetectionEngine/storage/reportStorage.js')).default;
      const saved = ReportStorage.save(reportToSave);
      
      if (saved) {
        // 2. 立即刷新报告列表
        await loadReports();
        
        // 3. 不再为每个分组单独下载 ZIP 包
        // 最终的总 ZIP 包会在所有检测完成后由 detectionOrchestrator 生成
        console.log(`✅ 分组报告已保存: ${groupReport.groupName}`);
      }
    } catch (error) {
      console.error(`处理分组报告失败: ${groupReport.groupName}`, error);
    }
  }, [loadReports]);

  const updateTimeToDetection = useCallback(() => {
    if (!config.detectionTime) return;

    const now = new Date();
    const [hours, minutes] = config.detectionTime.split(":").map(Number);
    const targetTime = new Date();
    targetTime.setHours(hours, minutes, 0, 0);

    // If target time has passed today, set it for tomorrow
    if (targetTime <= now) {
      targetTime.setDate(targetTime.getDate() + 1);
    }

    const timeToDetection = targetTime.getTime() - now.getTime();
    setStatus((prev) => ({
      ...prev,
      timeToDetection,
    }));
  }, [config.detectionTime]);

  const saveConfig = async (newConfig) => {
    try {
      setIsSaving(true);
      console.log("Saving config:", newConfig);
      const result = await configService.saveConfig({
        targetDirectory: newConfig.directory || "",
        detectionTime: newConfig.detectionTime || "",
        projectType: newConfig.projectType || "",
        enabled: newConfig.enabled || false,
        fileTypes: newConfig.fileTypes || ['.h', '.cpp', '.c', '.hpp', '.cc'],
        excludePatterns: newConfig.excludePatterns || [
          '**/node_modules/**',
          '**/build/**',
          '**/dist/**',
          '**/.git/**',
          '**/temp/**',
          '**/tmp/**'
        ],
        batchSize: newConfig.batchSize || 10,
        retryAttempts: newConfig.retryAttempts || 3,
        notificationEnabled: newConfig.notificationEnabled !== false,
      });
      console.log("Save result:", result);
      if (result.success) {
        setConfig(newConfig);
        setStatus((prev) => ({
          ...prev,
          error: null,
        }));
        setIsSaving(false);
        return { success: true };
      } else {
        const errorMsg = typeof result.error === 'string' ? result.error : (result.error?.message || "Failed to save configuration");
        setStatus((prev) => ({
          ...prev,
          status: "error",
          error: errorMsg,
        }));
        setIsSaving(false);
        return { success: false, error: errorMsg };
      }
    } catch (error) {
      console.error("Failed to save config:", error);
      const errorMsg = typeof error === 'string' ? error : (error?.message || "Unknown error occurred");
      setStatus((prev) => ({
        ...prev,
        status: "error",
        error: errorMsg,
      }));
      setIsSaving(false);
      return { success: false, error: errorMsg };
    }
  };

  const startDetection = async () => {
    try {
      // Validate project type before starting
      if (!config.projectType) {
        const errorMsg = "Please select a project type before starting detection";
        setStatus((prev) => ({
          ...prev,
          status: "error",
          error: errorMsg,
        }));
        return { success: false, error: errorMsg };
      }

      // Reset status if previous detection is completed or waiting
      if (status.status === "completed" || status.status === "waiting") {
        setReportCreated(false); // 重置报告创建标志
        setStatus({
          status: "idle",
          progress: {
            completed: 0,
            total: 0,
            processedFiles: 0,
            totalFiles: 0,
            currentGroup: 0,
            totalGroups: 0,
            currentGroupName: '',
            currentFile: null
          },
          timeToDetection: null,
          error: null,
        });
      }

      // 检查是否设置了检测时间
      if (config.detectionTime) {
        const now = new Date();
        const [hours, minutes] = config.detectionTime.split(":").map(Number);
        const targetTime = new Date();
        targetTime.setHours(hours, minutes, 0, 0);

        // 如果还没到检测时间，设置为等待状态
        if (now < targetTime) {
          const timeToWait = targetTime.getTime() - now.getTime();
          
          setStatus((prev) => ({
            ...prev,
            status: "waiting",
            timeToDetection: timeToWait,
            error: null,
          }));
          
          // 设置定时器，到达检测时间时自动开始
          const timer = setTimeout(() => {
            startDetection();
          }, timeToWait);
          
          return { success: true, message: `等待中，将在 ${config.detectionTime} 开始检测` };
        }
      }

      // Get directory handle from config
      const handle = await AutoDetectionAPI.restoreDirectoryHandle();
      if (!handle) {
        const errorMsg = "No directory selected. Please configure a directory first.";
        setStatus((prev) => ({
          ...prev,
          status: "error",
          error: errorMsg,
        }));
        return { success: false, error: errorMsg };
      }

      // Set directory handle in detection service
      const detectionService = (await import('@/services/autoDetection/detectionService.js')).default;
      detectionService.setDirectoryHandle(handle);

      // 设置报告生成回调 - 每个分组检测完成后立即调用
      AutoDetectionAPI.setOnReportGenerated(async (groupReport) => {
        // 立即处理该分组的报告
        await handleGroupReportGenerated(groupReport);
      });

      // Load full config from configService
      const fullConfig = await configService.getConfig();
      console.log('Starting detection with config:', fullConfig);

      const result = await AutoDetectionAPI.start(fullConfig);
      if (result.success) {
        setStatus((prev) => ({
          ...prev,
          status: "running",
          error: null,
        }));
        return { success: true };
      } else {
        const errorMsg = typeof result.error === 'string' ? result.error : (result.error?.message || t("autodetection.error.startFailed", "Failed to start detection"));
        setStatus((prev) => ({
          ...prev,
          status: "error",
          error: errorMsg,
        }));
        return { success: false, error: errorMsg };
      }
    } catch (error) {
      console.error("Failed to start detection:", error);
      const errorMsg = typeof error === 'string' ? error : (error?.message || "Unknown error occurred");
      setStatus((prev) => ({
        ...prev,
        status: "error",
        error: errorMsg,
      }));
      return { success: false, error: errorMsg };
    }
  };

  const stopDetection = async () => {
    try {
      const result = await AutoDetectionAPI.stop();
      if (result.success) {
        setStatus((prev) => ({
          ...prev,
          status: "idle",
          progress: {
            completed: 0,
            total: 0,
            processedFiles: 0,
            totalFiles: 0,
            currentGroup: 0,
            totalGroups: 0,
            currentGroupName: '',
            currentFile: null
          },
          error: null,
        }));
        return { success: true };
      } else {
        const errorMsg = typeof result.error === 'string' ? result.error : (result.error?.message || t("autodetection.error.stopFailed", "Failed to stop detection"));
        setStatus((prev) => ({
          ...prev,
          error: errorMsg,
        }));
        return { success: false, error: errorMsg };
      }
    } catch (error) {
      console.error("Failed to stop detection:", error);
      const errorMsg = typeof error === 'string' ? error : (error?.message || "Unknown error occurred");
      setStatus((prev) => ({
        ...prev,
        error: errorMsg,
      }));
      return { success: false, error: errorMsg };
    }
  };

  const downloadReport = async (reportId) => {
    try {
      const result = await AutoDetectionAPI.downloadReport(reportId);
      if (result.success) {
        return { success: true };
      } else {
        const errorMsg = typeof result.error === 'string' ? result.error : (result.error?.message || t("autodetection.error.downloadFailed", "Failed to download report"));
        setStatus((prev) => ({
          ...prev,
          error: errorMsg,
        }));
        return { success: false, error: errorMsg };
      }
    } catch (error) {
      console.error("Failed to download report:", error);
      const errorMsg = typeof error === 'string' ? error : (error?.message || "Unknown error occurred");
      setStatus((prev) => ({
        ...prev,
        error: errorMsg,
      }));
      return { success: false, error: errorMsg };
    }
  };

  const deleteReport = async (reportId) => {
    try {
      const result = await AutoDetectionAPI.deleteReport(reportId);
      if (result.success) {
        await loadReports();
        return { success: true };
      } else {
        const errorMsg = typeof result.error === 'string' ? result.error : (result.error?.message || t("autodetection.error.deleteFailed", "Failed to delete report"));
        setStatus((prev) => ({
          ...prev,
          error: errorMsg,
        }));
        return { success: false, error: errorMsg };
      }
    } catch (error) {
      console.error("Failed to delete report:", error);
      const errorMsg = typeof error === 'string' ? error : (error?.message || "Unknown error occurred");
      setStatus((prev) => ({
        ...prev,
        error: errorMsg,
      }));
      return { success: false, error: errorMsg };
    }
  };

  const createReport = async () => {
    try {
      // 报告现在是在检测过程中通过 handleGroupReportGenerated 实时生成的
      // 这里只需要确保报告列表是最新的
      await loadReports();
    } catch (error) {
      console.error("Failed to refresh reports:", error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-theme-accent-primary mx-auto mb-4"></div>
          <p className="text-theme-text-secondary">{t("autodetection.loading", "Loading...")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-theme-bg-container">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-theme-text-primary mb-2">
              {t("autodetection.title", "Auto Detection")}
            </h1>
          </div>

          {/* Error Message */}
          {status.error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
              <p className="font-semibold">{t("autodetection.status.error", "Error")}</p>
              <p className="text-sm mt-1">{status.error}</p>
            </div>
          )}

          {/* Main Content Grid */}
          <div className="space-y-6">
            {/* Top Row: Config and Status */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Config Panel */}
              <div>
                <ConfigPanel
                  config={config}
                  onSave={saveConfig}
                  isSaving={isSaving}
                />
              </div>

              {/* Status Panel */}
              <div>
                <StatusPanel
                  status={status}
                  onStart={startDetection}
                  onStop={stopDetection}
                />
              </div>
            </div>

            {/* Bottom Row: Reports (Full Width) */}
            <div>
              <ReportPanel
                reports={reports}
                onDownload={downloadReport}
                onDelete={deleteReport}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

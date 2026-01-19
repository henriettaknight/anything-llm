import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import AutoDetectionAPI from "@/models/autodetection";
import ConfigPanel from "./ConfigPanel";
import StatusPanel from "./StatusPanel";
import ReportPanel from "./ReportPanel";

export default function AutoDetectionContainer() {
  const { t } = useTranslation();
  const [config, setConfig] = useState({
    directory: "",
    detectionTime: "",
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

  // Load initial config and reports on mount
  useEffect(() => {
    loadInitialData();
  }, []);

  // Poll for status updates when detection is running
  useEffect(() => {
    if (status.status === "running") {
      const interval = setInterval(() => {
        loadStatus();
      }, 5000); // Poll every 5 seconds
      return () => clearInterval(interval);
    }
  }, [status.status]);

  // Update countdown timer every minute
  useEffect(() => {
    if (config.enabled && config.detectionTime && status.status === "idle") {
      const interval = setInterval(() => {
        updateTimeToDetection();
      }, 60000); // Update every minute
      updateTimeToDetection(); // Initial update
      return () => clearInterval(interval);
    }
  }, [config.enabled, config.detectionTime, status.status]);

  const loadInitialData = async () => {
    try {
      setLoading(true);
      await Promise.all([loadConfig(), loadReports(), loadStatus()]);
    } catch (error) {
      console.error("Failed to load initial data:", error);
      setStatus((prev) => ({
        ...prev,
        status: "error",
        error: t("autodetection.error.loadFailed", "Failed to load configuration"),
      }));
    } finally {
      setLoading(false);
    }
  };

  const loadConfig = useCallback(async () => {
    try {
      const result = await AutoDetectionAPI.getConfig();
      if (result.success) {
        setConfig(result.config || {
          directory: "",
          detectionTime: "",
          enabled: false,
        });
      }
    } catch (error) {
      console.error("Failed to load config:", error);
    }
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const result = await AutoDetectionAPI.getStatus();
      if (result.success) {
        setStatus(result.status || {
          status: "idle",
          progress: { completed: 0, total: 0 },
          timeToDetection: null,
          error: null,
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
      const result = await AutoDetectionAPI.saveConfig(newConfig);
      if (result.success) {
        setConfig(newConfig);
        setStatus((prev) => ({
          ...prev,
          error: null,
        }));
        return { success: true };
      } else {
        setStatus((prev) => ({
          ...prev,
          status: "error",
          error: result.error || t("autodetection.error.saveFailed", "Failed to save configuration"),
        }));
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error("Failed to save config:", error);
      setStatus((prev) => ({
        ...prev,
        status: "error",
        error: error.message,
      }));
      return { success: false, error: error.message };
    } finally {
      setIsSaving(false);
    }
  };

  const startDetection = async () => {
    try {
      const result = await AutoDetectionAPI.start();
      if (result.success) {
        setStatus((prev) => ({
          ...prev,
          status: "running",
          error: null,
        }));
        return { success: true };
      } else {
        setStatus((prev) => ({
          ...prev,
          status: "error",
          error: result.error || t("autodetection.error.startFailed", "Failed to start detection"),
        }));
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error("Failed to start detection:", error);
      setStatus((prev) => ({
        ...prev,
        status: "error",
        error: error.message,
      }));
      return { success: false, error: error.message };
    }
  };

  const stopDetection = async () => {
    try {
      const result = await AutoDetectionAPI.stop();
      if (result.success) {
        setStatus((prev) => ({
          ...prev,
          status: "idle",
          error: null,
        }));
        return { success: true };
      } else {
        setStatus((prev) => ({
          ...prev,
          error: result.error || t("autodetection.error.stopFailed", "Failed to stop detection"),
        }));
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error("Failed to stop detection:", error);
      setStatus((prev) => ({
        ...prev,
        error: error.message,
      }));
      return { success: false, error: error.message };
    }
  };

  const downloadReport = async (reportId) => {
    try {
      const result = await AutoDetectionAPI.downloadReport(reportId);
      if (result.success) {
        return { success: true };
      } else {
        setStatus((prev) => ({
          ...prev,
          error: result.error || t("autodetection.error.downloadFailed", "Failed to download report"),
        }));
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error("Failed to download report:", error);
      setStatus((prev) => ({
        ...prev,
        error: error.message,
      }));
      return { success: false, error: error.message };
    }
  };

  const deleteReport = async (reportId) => {
    try {
      const result = await AutoDetectionAPI.deleteReport(reportId);
      if (result.success) {
        await loadReports();
        return { success: true };
      } else {
        setStatus((prev) => ({
          ...prev,
          error: result.error || t("autodetection.error.deleteFailed", "Failed to delete report"),
        }));
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error("Failed to delete report:", error);
      setStatus((prev) => ({
        ...prev,
        error: error.message,
      }));
      return { success: false, error: error.message };
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
            <p className="text-theme-text-secondary">
              {t("autodetection.description", "Configure and manage automatic code defect detection")}
            </p>
          </div>

          {/* Error Message */}
          {status.error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
              <p className="font-semibold">{t("autodetection.error", "Error")}</p>
              <p className="text-sm mt-1">{status.error}</p>
            </div>
          )}

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Config Panel - Takes 1 column on large screens */}
            <div className="lg:col-span-1">
              <ConfigPanel
                config={config}
                onSave={saveConfig}
                isSaving={isSaving}
              />
            </div>

            {/* Status and Reports - Takes 2 columns on large screens */}
            <div className="lg:col-span-2 space-y-6">
              <StatusPanel
                status={status}
                onStart={startDetection}
                onStop={stopDetection}
              />
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

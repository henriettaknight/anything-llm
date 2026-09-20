import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import AutoDetectionAPI from "@/models/autodetection";

export default function ConfigPanel({ config, onSave, isSaving }) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState({
    directory: config?.directory || "",
    detectionTime: config?.detectionTime || "",
    projectType: config?.projectType || "", // 空字符串表示未选择
    // 报告单元化（分阶段检测报告）：阈值默认 256KB、阶段下载默认开、文件数兜底默认 200
    reportUnitSizeThresholdKB: config?.reportUnitSizeThresholdKB ?? 256,
    stageDownloadEnabled: config?.stageDownloadEnabled ?? true,
    maxFilesPerUnit: config?.maxFilesPerUnit ?? 200,
  });
  const [errors, setErrors] = useState({});
  const [successMessage, setSuccessMessage] = useState("");
  const [directoryHandle, setDirectoryHandle] = useState(null);
  const [isSelectingDirectory, setIsSelectingDirectory] = useState(false);
  const [browserSupport, setBrowserSupport] = useState({
    fileSystemAPI: false,
    indexedDB: false,
  });

  // Check browser support on mount
  useEffect(() => {
    checkBrowserSupport();
    restoreDirectoryHandle();
  }, []);

  // Update form when config prop changes
  useEffect(() => {
    if (config) {
      setFormData({
        directory: config.directory || "",
        detectionTime: config.detectionTime || "",
        projectType: config.projectType || "",
        reportUnitSizeThresholdKB: config.reportUnitSizeThresholdKB ?? 256,
        stageDownloadEnabled: config.stageDownloadEnabled ?? true,
        maxFilesPerUnit: config.maxFilesPerUnit ?? 200,
      });
    }
  }, [config]);

  const checkBrowserSupport = () => {
    const hasFileSystemAPI =
      typeof window !== "undefined" &&
      typeof window.showDirectoryPicker === "function";
    const hasIndexedDB = typeof window !== "undefined" && window.indexedDB;

    setBrowserSupport({
      fileSystemAPI: hasFileSystemAPI,
      indexedDB: hasIndexedDB,
    });
  };

  const restoreDirectoryHandle = async () => {
    try {
      const handle = await AutoDetectionAPI.restoreDirectoryHandle();
      if (handle) {
        setDirectoryHandle(handle);
        // Verify the handle is still valid
        const permission = await handle.queryPermission({ mode: "read" });
        if (permission === "granted") {
          setFormData((prev) => ({
            ...prev,
            directory: handle.name,
          }));
        }
      }
    } catch (error) {
      console.error("Error restoring directory handle:", error);
    }
  };

  const handleSelectDirectory = async () => {
    // 移除浏览器检查，直接尝试使用 File System API
    try {
      setIsSelectingDirectory(true);
      const handle = await window.showDirectoryPicker();

      // Verify we have read permission
      const permission = await handle.queryPermission({ mode: "read" });
      if (permission !== "granted") {
        const newPermission = await handle.requestPermission({ mode: "read" });
        if (newPermission !== "granted") {
          throw new Error("Permission denied");
        }
      }

      // Save the handle to IndexedDB
      await AutoDetectionAPI.saveDirectoryHandle(handle);
      setDirectoryHandle(handle);
      setFormData((prev) => ({
        ...prev,
        directory: handle.name,
      }));
      setErrors((prev) => ({ ...prev, directory: "" }));
    } catch (error) {
      if (error.name === "AbortError") {
        // User cancelled the dialog
        return;
      }
      console.error("Error selecting directory:", error);
      
      // 显示更详细的错误信息
      let errorMessage = "Failed to select directory";
      if (error.name === "NotSupportedError") {
        errorMessage = "File System API is not supported in this browser or context";
      } else if (error.name === "SecurityError") {
        errorMessage = "Security error: File System API requires HTTPS or localhost";
      } else if (error.message) {
        errorMessage = `Failed to select directory: ${error.message}`;
      }
      
      setErrors({
        directory: errorMessage,
      });
    } finally {
      setIsSelectingDirectory(false);
    }
  };

  const validateTimeFormat = (time) => {
    if (!time) return false;
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    return timeRegex.test(time);
  };

  const handleTimeChange = (e) => {
    const value = e.target.value;
    setFormData((prev) => ({
      ...prev,
      detectionTime: value,
    }));

    // Clear error when user starts typing
    if (errors.detectionTime) {
      setErrors((prev) => ({ ...prev, detectionTime: "" }));
    }
  };

  const validateForm = () => {
    const newErrors = {};

    if (!formData.directory) {
      newErrors.directory = t(
        "autodetection.config.error.directoryRequired",
        "Please select a directory"
      );
    }

    if (!formData.projectType) {
      newErrors.projectType = t(
        "autodetection.config.error.projectTypeRequired",
        "Please select a project type"
      );
    }

    if (!formData.detectionTime) {
      newErrors.detectionTime = t(
        "autodetection.config.error.timeRequired",
        "Please enter a detection time"
      );
    } else if (!validateTimeFormat(formData.detectionTime)) {
      newErrors.detectionTime = t(
        "autodetection.config.error.invalidTimeFormat",
        "Time must be in HH:mm format (e.g., 14:30)"
      );
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) {
      console.log("Form validation failed");
      return;
    }

    console.log("Form validation passed, saving...");
    const result = await onSave({
      directory: formData.directory,
      detectionTime: formData.detectionTime,
      projectType: formData.projectType,
      enabled: true,
      fileTypes: ['ts', 'ts_famegame'].includes(formData.projectType)
        ? ['.ts', '.tsx', '.js', '.jsx']
        : ['.h', '.cpp', '.c', '.hpp', '.cc'], // TS 项目检测 TS/TSX，其余检测 C++ 文件
      excludePatterns: [
        '**/node_modules/**',
        '**/build/**',
        '**/dist/**',
        '**/.git/**',
        '**/temp/**',
        '**/tmp/**',
        ...(formData.projectType === 'ue_blueprint' ? [
          '**/Developers/**',
          '**/Collections/**',
          '**/__ExternalActors__/**',
          '**/__ExternalObjects__/**'
        ] : [])
      ],
      batchSize: 10,
      retryAttempts: 3,
      notificationEnabled: true,
      // 报告单元化（分阶段检测报告）
      reportUnitSizeThresholdKB: Number(formData.reportUnitSizeThresholdKB) || 0,
      stageDownloadEnabled: formData.stageDownloadEnabled !== false,
      maxFilesPerUnit: Number(formData.maxFilesPerUnit) || 200,
    });

    console.log("Save result:", result);
    if (!result.success) {
      setErrors({
        submit: result.error || t(
          "autodetection.config.error.saveFailed",
          "Failed to save configuration"
        ),
      });
      setSuccessMessage("");
    } else {
      // Clear errors on success
      setErrors({});
      setSuccessMessage(t("autodetection.config.saveSuccess", "Configuration saved successfully!"));
      // Clear success message after 3 seconds
      setTimeout(() => setSuccessMessage(""), 3000);
    }
  };

  const handleClearDirectory = () => {
    setFormData((prev) => ({
      ...prev,
      directory: "",
    }));
    setDirectoryHandle(null);
    setErrors((prev) => ({ ...prev, directory: "" }));
  };

  return (
    <div className="bg-theme-bg-secondary rounded-lg border border-theme-sidebar-border p-6 flex flex-col" style={{ minHeight: '500px' }}>
      <h2 className="text-xl font-semibold text-theme-text-primary mb-6">
        {t("autodetection.config.title", "Configuration")}
      </h2>

      {/* Browser Support Warning - 移除警告 */}
      {false && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded text-yellow-800 text-sm">
          <p className="font-semibold mb-1">
            {t("autodetection.config.warning.browserSupport", "Browser Compatibility")}
          </p>
          <p>
            {t(
              "autodetection.config.warning.fileSystemNotSupported",
              "Your browser does not support the File System API. Please use Chrome, Edge, or Opera 86+"
            )}
          </p>
        </div>
      )}

      <div className="space-y-4">
        {/* Directory Selection */}
        <div>
          <label className="block text-sm font-medium text-theme-text-primary mb-2">
            {t("autodetection.config.directory", "Target Directory")}
          </label>
          <div className="flex gap-2">
            <div className="flex-1">
              <input
                type="text"
                value={formData.directory}
                readOnly
                placeholder={t(
                  "autodetection.config.directoryPlaceholder",
                  "No directory selected"
                )}
                className="w-full px-3 py-2 bg-theme-bg-primary border border-theme-sidebar-border rounded text-theme-text-primary placeholder-theme-text-secondary focus:outline-none focus:ring-2 focus:ring-theme-accent-primary"
              />
            </div>
            <button
              onClick={handleSelectDirectory}
              disabled={isSelectingDirectory || isSaving}
              className="px-4 py-2 bg-gray-50 text-gray-800 rounded font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity border-2 border-gray-200"
            >
              {isSelectingDirectory
                ? t("autodetection.config.selecting", "Selecting...")
                : t("autodetection.config.selectButton", "Select")}
            </button>
            {formData.directory && (
              <button
                onClick={handleClearDirectory}
                disabled={isSaving}
                className="px-3 py-2 bg-theme-bg-primary text-theme-text-secondary rounded hover:bg-theme-bg-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors border-2 border-theme-sidebar-border"
                title={t("autodetection.config.clearButton", "Clear")}
              >
                ✕
              </button>
            )}
          </div>
          {errors.directory && (
            <p className="mt-1 text-sm text-red-600">{errors.directory}</p>
          )}
        </div>

        {/* Project Type Selection */}
        <div>
          <label className="block text-sm font-medium text-theme-text-primary mb-2">
            {t("autodetection.config.projectType", "Project Type")}
            <span className="text-red-500 ml-1">*</span>
          </label>
          <select
            value={formData.projectType}
            onChange={(e) => {
              setFormData(prev => ({ ...prev, projectType: e.target.value }));
              if (errors.projectType) {
                setErrors(prev => ({ ...prev, projectType: "" }));
              }
            }}
            disabled={isSaving}
            className="w-full px-3 py-2 bg-theme-bg-primary border border-theme-sidebar-border rounded text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-theme-accent-primary disabled:opacity-50"
          >
            <option value="">
              {t("autodetection.config.projectTypePlaceholder", "-- Please select project type --")}
            </option>
            <option value="ue_cpp">
              {t("autodetection.config.projectType.ueCpp", "UE5 C++ Project")}
            </option>
            <option value="ue4_cpp">
              {t("autodetection.config.projectType.ue4Cpp", "UE4 C++ Project")}
            </option>
            <option value="ue_blueprint">
              {t("autodetection.config.projectType.ueBlueprint", "UE5 Blueprint Project")}
            </option>
            <option value="cpp">
              {t("autodetection.config.projectType.cpp", "标准 C++ 项目 (Standard C++)")}
            </option>
            <option value="ts">
              {t("autodetection.config.projectType.ts", "TypeScript 项目（通用）")}
            </option>
            <option value="ts_famegame">
              {t("autodetection.config.projectType.ts_famegame", "TypeScript — FameGameEditor")}
            </option>
          </select>
          {errors.projectType && (
            <p className="mt-1 text-sm text-red-600">{errors.projectType}</p>
          )}
          <p className="mt-1 text-xs text-theme-text-secondary">
            {t(
              "autodetection.config.projectTypeHint",
              "Select the type of project to use the appropriate detection rules"
            )}
          </p>
        </div>

        {/* Time Input */}
        <div>
          <label className="block text-sm font-medium text-theme-text-primary mb-2">
            {t("autodetection.config.detectionTime", "Detection Time")}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="time"
              value={formData.detectionTime}
              onChange={handleTimeChange}
              disabled={isSaving}
              className="flex-1 px-3 py-2 bg-theme-bg-primary border border-theme-sidebar-border rounded text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-theme-accent-primary disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <span className="text-sm text-theme-text-secondary">
              {t("autodetection.config.timeFormat", "HH:mm")}
            </span>
          </div>
          {errors.detectionTime && (
            <p className="mt-1 text-sm text-red-600">{errors.detectionTime}</p>
          )}
          <p className="mt-1 text-xs text-theme-text-secondary">
            {t(
              "autodetection.config.timeHint",
              "Detection will run daily at this time"
            )}
          </p>
        </div>

        {/* ===== 报告单元化（分阶段检测报告）===== */}
        <div className="pt-2 border-t border-theme-sidebar-border mt-2">
          <p className="text-sm font-semibold text-theme-text-primary mb-3">
            {t("autodetection.config.reportUnit.section", "分阶段报告 (Report Units)")}
          </p>

          {/* 单元阈值 */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-theme-text-primary mb-2">
              {t("autodetection.config.reportUnit.threshold", "单元拆分阈值 (KB)")}
            </label>
            <input
              type="number"
              min={0}
              max={102400}
              step={64}
              value={formData.reportUnitSizeThresholdKB}
              onChange={(e) => {
                const v = Math.max(0, Math.min(102400, Number(e.target.value) || 0));
                setFormData((prev) => ({ ...prev, reportUnitSizeThresholdKB: v }));
              }}
              disabled={isSaving}
              className="w-full px-3 py-2 bg-theme-bg-primary border border-theme-sidebar-border rounded text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-theme-accent-primary disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <p className="mt-1 text-xs text-theme-text-secondary">
              {t(
                "autodetection.config.reportUnit.thresholdHint",
                "同目录累计文件大小超过该值即拆为新报告单元（a1/a2/root1…），每单元完成立即下载一份阶段报告。0 = 不拆分（全部完成后一次性出报告）"
              )}
            </p>
          </div>

          {/* 文件数兜底 */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-theme-text-primary mb-2">
              {t("autodetection.config.reportUnit.maxFiles", "单元文件数上限")}
            </label>
            <input
              type="number"
              min={1}
              max={10000}
              step={10}
              value={formData.maxFilesPerUnit}
              onChange={(e) => {
                const v = Math.max(1, Math.min(10000, Number(e.target.value) || 200));
                setFormData((prev) => ({ ...prev, maxFilesPerUnit: v }));
              }}
              disabled={isSaving}
              className="w-full px-3 py-2 bg-theme-bg-primary border border-theme-sidebar-border rounded text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-theme-accent-primary disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <p className="mt-1 text-xs text-theme-text-secondary">
              {t(
                "autodetection.config.reportUnit.maxFilesHint",
                "防止大量小文件挤进同一单元导致报告过大，一般无需调整"
              )}
            </p>
          </div>

          {/* 阶段下载开关 */}
          <div className="mb-1">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={formData.stageDownloadEnabled}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, stageDownloadEnabled: e.target.checked }));
                }}
                disabled={isSaving}
                className="w-4 h-4 rounded border-theme-sidebar-border bg-theme-bg-primary text-theme-accent-primary focus:ring-theme-accent-primary"
              />
              <span className="text-sm font-medium text-theme-text-primary">
                {t("autodetection.config.reportUnit.stageDownload", "启用阶段报告下载")}
              </span>
            </label>
            <p className="mt-1 text-xs text-theme-text-secondary">
              {t(
                "autodetection.config.reportUnit.stageDownloadHint",
                "开启后每单元完成即下载阶段报告小包；检测结束时仍会下载完整汇总包。首次使用 Chrome 会弹出「允许下载多个文件」授权，请选择允许"
              )}
            </p>
          </div>
        </div>

        {/* Submit Error */}
        {errors.submit && (
          <div className="p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm">
            {errors.submit}
          </div>
        )}

        {/* Success Message */}
        {successMessage && (
          <div className="p-3 bg-green-50 border border-green-200 rounded text-green-800 text-sm">
            {successMessage}
          </div>
        )}

        {/* Save Button */}
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="w-full px-4 py-2 bg-gray-50 text-gray-800 rounded font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity border-2 border-gray-200"
        >
          {isSaving
            ? t("autodetection.config.saving", "Saving...")
            : t("autodetection.config.saveButton", "Save Configuration")}
        </button>
      </div>
    </div>
  );
}

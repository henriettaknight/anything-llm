import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import AutoDetectionAPI from "@/models/autodetection";

export default function ConfigPanel({ config, onSave, isSaving }) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState({
    directory: config?.directory || "",
    detectionTime: config?.detectionTime || "",
  });
  const [errors, setErrors] = useState({});
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
      });
    }
  }, [config]);

  const checkBrowserSupport = () => {
    const hasFileSystemAPI =
      typeof window !== "undefined" &&
      (window.showDirectoryPicker !== undefined ||
        navigator.storage?.getDirectory !== undefined);
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
    if (!browserSupport.fileSystemAPI) {
      setErrors({
        directory: t(
          "autodetection.config.error.fileSystemNotSupported",
          "File System API is not supported in your browser"
        ),
      });
      return;
    }

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
      setErrors({
        directory: t(
          "autodetection.config.error.directorySelectionFailed",
          "Failed to select directory"
        ),
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
      return;
    }

    const result = await onSave({
      directory: formData.directory,
      detectionTime: formData.detectionTime,
      enabled: true,
    });

    if (!result.success) {
      setErrors({
        submit: result.error || t(
          "autodetection.config.error.saveFailed",
          "Failed to save configuration"
        ),
      });
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
    <div className="bg-theme-bg-secondary rounded-lg border border-theme-sidebar-border p-6">
      <h2 className="text-xl font-semibold text-theme-text-primary mb-6">
        {t("autodetection.config.title", "Configuration")}
      </h2>

      {/* Browser Support Warning */}
      {!browserSupport.fileSystemAPI && (
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
              disabled={isSelectingDirectory || isSaving || !browserSupport.fileSystemAPI}
              className="px-4 py-2 bg-theme-accent-primary text-white rounded font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            >
              {isSelectingDirectory
                ? t("autodetection.config.selecting", "Selecting...")
                : t("autodetection.config.selectButton", "Select")}
            </button>
            {formData.directory && (
              <button
                onClick={handleClearDirectory}
                disabled={isSaving}
                className="px-3 py-2 bg-theme-bg-primary border border-theme-sidebar-border text-theme-text-secondary rounded hover:bg-theme-bg-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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

        {/* Submit Error */}
        {errors.submit && (
          <div className="p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm">
            {errors.submit}
          </div>
        )}

        {/* Save Button */}
        <button
          onClick={handleSave}
          disabled={isSaving || !browserSupport.fileSystemAPI}
          className="w-full px-4 py-2 bg-theme-accent-primary text-white rounded font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity border-2 border-theme-sidebar-border"
        >
          {isSaving
            ? t("autodetection.config.saving", "Saving...")
            : t("autodetection.config.saveButton", "Save Configuration")}
        </button>
      </div>

      {/* Info Box */}
      <div className="mt-6 p-3 bg-theme-bg-primary border border-theme-sidebar-border rounded text-sm text-theme-text-secondary">
        <p className="font-semibold mb-2">
          {t("autodetection.config.info", "How it works")}
        </p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>
            {t(
              "autodetection.config.infoStep1",
              "Select a directory containing C++ source files"
            )}
          </li>
          <li>
            {t(
              "autodetection.config.infoStep2",
              "Set the time when detection should run daily"
            )}
          </li>
          <li>
            {t(
              "autodetection.config.infoStep3",
              "System will automatically scan and analyze files at the specified time"
            )}
          </li>
        </ul>
      </div>
    </div>
  );
}

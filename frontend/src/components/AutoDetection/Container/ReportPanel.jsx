import React, { useState } from "react";
import { useTranslation } from "react-i18next";

export default function ReportPanel({ reports, onDownload, onDelete }) {
  const { t } = useTranslation();
  const [isDownloading, setIsDownloading] = useState({});
  const [isDeleting, setIsDeleting] = useState({});
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const handleDownload = async (reportId) => {
    setIsDownloading((prev) => ({ ...prev, [reportId]: true }));
    try {
      const result = await onDownload(reportId);
      if (!result.success) {
        console.error("Download failed:", result.error);
      }
    } catch (error) {
      console.error("Error downloading report:", error);
    } finally {
      setIsDownloading((prev) => ({ ...prev, [reportId]: false }));
    }
  };

  const handleDelete = async (reportId) => {
    setIsDeleting((prev) => ({ ...prev, [reportId]: true }));
    try {
      const result = await onDelete(reportId);
      if (!result.success) {
        console.error("Delete failed:", result.error);
      }
      setDeleteConfirm(null);
    } catch (error) {
      console.error("Error deleting report:", error);
    } finally {
      setIsDeleting((prev) => ({ ...prev, [reportId]: false }));
    }
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const formatNumber = (num) => {
    return num?.toLocaleString() || "0";
  };

  return (
    <div className="bg-theme-bg-secondary rounded-lg border border-theme-sidebar-border p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-theme-text-primary">
          {t("autodetection.reports.title", "Reports")}
        </h2>
        {reports && reports.length > 0 && (
          <button
            onClick={() => {
              if (window.confirm(t("autodetection.reports.confirmDeleteAll", "Delete all reports?"))) {
                reports.forEach(report => handleDelete(report.id));
              }
            }}
            className="px-3 py-1 bg-gray-50 text-gray-800 text-sm rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity border border-gray-200"
            title={t("autodetection.reports.deleteAllButton", "Delete All")}
          >
            {t("autodetection.reports.deleteAllButton", "Delete All")}
          </button>
        )}
      </div>

      {reports && reports.length > 0 ? (
        <div className="space-y-3">
          {reports.map((report) => {
            return (
            <div
              key={report.id}
              className="bg-theme-bg-primary border border-theme-sidebar-border rounded-lg p-4 hover:border-theme-accent-primary transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  {/* Report Header */}
                  <div className="mb-2">
                    <p className="text-sm font-semibold text-theme-text-primary truncate">
                      {report.groupName || t("autodetection.reports.report", "Report")}
                    </p>
                  </div>
                  
                  {/* Report Timestamp */}
                  <p className="text-xs text-theme-text-secondary mb-2">
                    {formatDate(report.createdAt || report.timestamp)}
                  </p>

                  {/* Report Stats */}
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <div className="bg-theme-bg-secondary rounded p-2">
                      <p className="text-xs text-theme-text-secondary mb-1">
                        {t("autodetection.reports.scannedFiles", "Scanned Files")}
                      </p>
                      <p className="text-lg font-semibold text-theme-text-primary">
                        {formatNumber(report.filesScanned || report.scannedFiles)}
                      </p>
                    </div>
                    <div className="bg-theme-bg-secondary rounded p-2">
                      <p className="text-xs text-theme-text-secondary mb-1">
                        {t("autodetection.reports.defectsFound", "Defects Found")}
                      </p>
                      <p className="text-lg font-semibold text-theme-accent-primary">
                        {formatNumber(report.defectsFound)}
                      </p>
                    </div>
                  </div>

                  {/* Group Path Info */}
                  {(report.groupPath || report.directory) && (
                    <p className="text-xs text-theme-text-secondary mt-2 truncate">
                      {t("autodetection.reports.directory", "Directory")}: {report.groupPath || report.directory}
                    </p>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleDownload(report.id)}
                    disabled={isDownloading[report.id] || isDeleting[report.id]}
                    className="px-3 py-1 bg-theme-accent-primary text-white text-sm rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity whitespace-nowrap"
                    title={t("autodetection.reports.downloadButton", "Download")}
                  >
                    {isDownloading[report.id]
                      ? t("autodetection.reports.downloading", "Downloading...")
                      : t("autodetection.reports.download", "Download")}
                  </button>

                  <button
                    onClick={() => setDeleteConfirm(report.id)}
                    disabled={isDeleting[report.id] || deleteConfirm === report.id}
                    className="px-3 py-1 bg-gray-50 text-gray-800 text-sm rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity whitespace-nowrap border border-gray-200"
                    title={t("autodetection.reports.deleteButton", "Delete")}
                  >
                    {isDeleting[report.id]
                      ? t("autodetection.reports.deleting", "Deleting...")
                      : t("autodetection.reports.delete", "Delete")}
                  </button>
                </div>
              </div>

              {/* Delete Confirmation */}
              {deleteConfirm === report.id && (
                <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded">
                  <p className="text-sm text-gray-700 mb-2">
                    {t(
                      "autodetection.reports.deleteConfirm",
                      "Are you sure you want to delete this report?"
                    )}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleDelete(report.id)}
                      disabled={isDeleting[report.id]}
                      className="flex-1 px-2 py-1 bg-gray-50 text-gray-800 text-sm rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity border border-gray-200"
                    >
                      {t("autodetection.reports.confirmDelete", "Confirm Delete")}
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      disabled={isDeleting[report.id]}
                      className="flex-1 px-2 py-1 bg-theme-bg-secondary border border-theme-sidebar-border text-theme-text-primary text-sm rounded hover:bg-theme-bg-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {t("autodetection.reports.cancel", "Cancel")}
                    </button>
                  </div>
                </div>
              )}
            </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-3">
          <div className="text-2xl mb-1 text-theme-text-secondary opacity-50">📋</div>
          <p className="text-sm text-theme-text-secondary mb-1">
            {t("autodetection.reports.empty", "No reports yet")}
          </p>
          <p className="text-xs text-theme-text-secondary">
            {t(
              "autodetection.reports.emptyHint",
              "Reports will appear here after detection completes"
            )}
          </p>
        </div>
      )}

      {/* Info Box */}
      <div className="mt-6 p-3 bg-theme-bg-primary border border-theme-sidebar-border rounded text-sm text-theme-text-secondary">
        <p className="font-semibold mb-2">
          {t("autodetection.reports.info", "Report Information")}
        </p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>
            {t(
              "autodetection.reports.infoStep1",
              "Each report contains detection results in CSV format"
            )}
          </li>
          <li>
            {t(
              "autodetection.reports.infoStep2",
              "Download reports to analyze defects and trends"
            )}
          </li>
          <li>
            {t(
              "autodetection.reports.infoStep3",
              "Delete reports to manage storage space"
            )}
          </li>
        </ul>
      </div>
    </div>
  );
}

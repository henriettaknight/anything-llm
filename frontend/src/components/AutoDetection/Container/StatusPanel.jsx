import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";

export default function StatusPanel({ status, onStart, onStop }) {
  const { t } = useTranslation();
  const [countdownDisplay, setCountdownDisplay] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);

  // Update countdown display every minute
  useEffect(() => {
    if (status.timeToDetection !== null && status.status === "idle") {
      updateCountdownDisplay();
      const interval = setInterval(updateCountdownDisplay, 60000); // Update every minute
      return () => clearInterval(interval);
    }
  }, [status.timeToDetection, status.status]);

  const updateCountdownDisplay = () => {
    if (status.timeToDetection === null) {
      setCountdownDisplay("");
      return;
    }

    const totalSeconds = Math.floor(status.timeToDetection / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    if (days > 0) {
      setCountdownDisplay(
        t("autodetection.status.countdownDays", "{{days}}d {{hours}}h {{minutes}}m", {
          days,
          hours,
          minutes,
        })
      );
    } else if (hours > 0) {
      setCountdownDisplay(
        t("autodetection.status.countdownHours", "{{hours}}h {{minutes}}m", {
          hours,
          minutes,
        })
      );
    } else {
      setCountdownDisplay(
        t("autodetection.status.countdownMinutes", "{{minutes}}m", {
          minutes: Math.max(0, minutes),
        })
      );
    }
  };

  const getStatusDisplay = () => {
    switch (status.status) {
      case "running":
        return {
          label: t("autodetection.status.running", "Running"),
          color: "text-blue-600",
          bgColor: "bg-blue-50",
          borderColor: "border-blue-200",
          dotColor: "bg-blue-600",
        };
      case "paused":
        return {
          label: t("autodetection.status.paused", "Paused"),
          color: "text-yellow-600",
          bgColor: "bg-yellow-50",
          borderColor: "border-yellow-200",
          dotColor: "bg-yellow-600",
        };
      case "error":
        return {
          label: t("autodetection.status.error", "Error"),
          color: "text-red-600",
          bgColor: "bg-red-50",
          borderColor: "border-red-200",
          dotColor: "bg-red-600",
        };
      default: // idle
        return {
          label: t("autodetection.status.idle", "Idle"),
          color: "text-gray-600",
          bgColor: "bg-gray-50",
          borderColor: "border-gray-200",
          dotColor: "bg-gray-600",
        };
    }
  };

  const statusDisplay = getStatusDisplay();

  const handleStart = async () => {
    setIsStarting(true);
    try {
      await onStart();
    } finally {
      setIsStarting(false);
    }
  };

  const handleStop = async () => {
    setIsStopping(true);
    try {
      await onStop();
    } finally {
      setIsStopping(false);
    }
  };

  return (
    <div className="bg-theme-bg-secondary rounded-lg border border-theme-sidebar-border p-6 flex flex-col" style={{ minHeight: '500px' }}>
      <h2 className="text-xl font-semibold text-theme-text-primary mb-6">
        {t("autodetection.status.title", "Status")}
      </h2>

      <div className="space-y-6">
        {/* Status Badge */}
        <div className={`${statusDisplay.bgColor} border ${statusDisplay.borderColor} rounded-lg p-4`}>
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${statusDisplay.dotColor} animate-pulse`}></div>
            <div>
              <p className="text-sm text-theme-text-secondary">
                {t("autodetection.status.currentStatus", "Current Status")}
              </p>
              <p className={`text-lg font-semibold ${statusDisplay.color}`}>
                {statusDisplay.label}
              </p>
            </div>
          </div>
        </div>

        {/* Progress Display */}
        {status.status === "running" && (
          <div className="bg-theme-bg-primary rounded-lg p-4 border border-theme-sidebar-border">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-theme-text-primary">
                {t("autodetection.status.progress", "Progress")}
              </p>
              <p className="text-sm font-semibold text-theme-accent-primary">
                {status.progress.completed}/{status.progress.total}
              </p>
            </div>
            <div className="w-full bg-theme-sidebar-border rounded-full h-2">
              <div
                className="bg-theme-accent-primary h-2 rounded-full transition-all duration-300"
                style={{
                  width: `${
                    status.progress.total > 0
                      ? (status.progress.completed / status.progress.total) * 100
                      : 0
                  }%`,
                }}
              ></div>
            </div>
            <p className="text-xs text-theme-text-secondary mt-2">
              {t("autodetection.status.groupsDetected", "Groups detected: {{completed}}/{{total}}", {
                completed: status.progress.completed,
                total: status.progress.total,
              })}
            </p>
          </div>
        )}

        {/* Countdown Timer */}
        {status.status === "idle" && countdownDisplay && (
          <div className="bg-theme-bg-primary rounded-lg p-4 border border-theme-sidebar-border">
            <p className="text-sm text-theme-text-secondary mb-2">
              {t("autodetection.status.nextDetection", "Next Detection")}
            </p>
            <p className="text-2xl font-bold text-theme-accent-primary">
              {countdownDisplay}
            </p>
          </div>
        )}

        {/* Error Message */}
        {status.status === "error" && status.error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-sm font-semibold text-red-800 mb-2">
              {t("autodetection.status.errorOccurred", "Error Occurred")}
            </p>
            <p className="text-sm text-red-700 mb-3">{status.error}</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3">
          {status.status !== "running" ? (
            <button
              onClick={handleStart}
              disabled={isStarting || status.status === "error"}
              className="flex-1 px-4 py-2 bg-theme-accent-primary text-white rounded font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity border-2 border-theme-sidebar-border"
            >
              {isStarting
                ? t("autodetection.status.starting", "Starting...")
                : t("autodetection.status.startButton", "Start Detection")}
            </button>
          ) : (
            <button
              onClick={handleStop}
              disabled={isStopping}
              className="flex-1 px-4 py-2 bg-red-600 text-white rounded font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity border-2 border-theme-sidebar-border"
            >
              {isStopping
                ? t("autodetection.status.stopping", "Stopping...")
                : t("autodetection.status.stopButton", "Stop Detection")}
            </button>
          )}

          {status.status === "error" && (
            <button
              onClick={handleStart}
              disabled={isStarting}
              className="flex-1 px-4 py-2 bg-theme-accent-primary text-white rounded font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity border-2 border-theme-sidebar-border"
            >
              {isStarting
                ? t("autodetection.status.retrying", "Retrying...")
                : t("autodetection.status.retryButton", "Retry")}
            </button>
          )}
        </div>

        {/* Info Box */}
        <div className="bg-theme-bg-primary border border-theme-sidebar-border rounded-lg p-3 text-xs text-theme-text-secondary">
          <p className="font-semibold mb-2">
            {t("autodetection.status.info", "Status Information")}
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li>
              {t(
                "autodetection.status.infoIdle",
                "Idle: Waiting for the scheduled detection time"
              )}
            </li>
            <li>
              {t(
                "autodetection.status.infoRunning",
                "Running: Detection is in progress"
              )}
            </li>
            <li>
              {t(
                "autodetection.status.infoError",
                "Error: An error occurred during detection"
              )}
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

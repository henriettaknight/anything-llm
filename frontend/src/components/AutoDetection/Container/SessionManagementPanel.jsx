import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import SessionStorage, { SessionStatus } from "@/utils/AutoDetectionEngine/storage/sessionStorage";

export default function SessionManagementPanel({ onResumeSession, onDeleteSession }) {
  const { t } = useTranslation();
  const [incompleteSessions, setIncompleteSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    loadIncompleteSessions();
  }, []);

  const loadIncompleteSessions = () => {
    const sessions = SessionStorage.getIncompleteSessions();
    setIncompleteSessions(sessions);
  };

  const handleResumeSession = async (sessionId) => {
    setIsLoading(true);
    try {
      await onResumeSession(sessionId);
      loadIncompleteSessions();
    } catch (error) {
      console.error("恢复会话失败:", error);
      alert(`恢复会话失败: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteSession = (sessionId) => {
    if (confirm(t("autodetection.session.confirmDelete", "确定要删除此会话吗？"))) {
      SessionStorage.delete(sessionId);
      loadIncompleteSessions();
      if (onDeleteSession) {
        onDeleteSession(sessionId);
      }
    }
  };

  const handleViewDetails = (session) => {
    const fullSession = SessionStorage.load(session.id);
    setSelectedSession(fullSession);
  };

  const formatDuration = (milliseconds) => {
    if (!milliseconds) return "N/A";
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const getStatusColor = (status) => {
    switch (status) {
      case SessionStatus.RUNNING:
        return "text-blue-600 bg-blue-50 border-blue-200";
      case SessionStatus.PAUSED:
        return "text-yellow-600 bg-yellow-50 border-yellow-200";
      case SessionStatus.INTERRUPTED:
        return "text-orange-600 bg-orange-50 border-orange-200";
      case SessionStatus.FAILED:
        return "text-red-600 bg-red-50 border-red-200";
      default:
        return "text-gray-600 bg-gray-50 border-gray-200";
    }
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case SessionStatus.RUNNING:
        return t("autodetection.session.statusRunning", "运行中");
      case SessionStatus.PAUSED:
        return t("autodetection.session.statusPaused", "已暂停");
      case SessionStatus.INTERRUPTED:
        return t("autodetection.session.statusInterrupted", "已中断");
      case SessionStatus.FAILED:
        return t("autodetection.session.statusFailed", "失败");
      default:
        return status;
    }
  };

  if (incompleteSessions.length === 0) {
    return (
      <div className="bg-theme-bg-secondary rounded-lg border border-theme-sidebar-border p-6">
        <h2 className="text-xl font-semibold text-theme-text-primary mb-4">
          {t("autodetection.session.title", "会话管理")}
        </h2>
        <p className="text-theme-text-secondary text-sm">
          {t("autodetection.session.noIncompleteSessions", "没有未完成的会话")}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-theme-bg-secondary rounded-lg border border-theme-sidebar-border p-6">
      <h2 className="text-xl font-semibold text-theme-text-primary mb-4">
        {t("autodetection.session.title", "会话管理")}
      </h2>

      <div className="space-y-4">
        {incompleteSessions.map((session) => (
          <div
            key={session.id}
            className="bg-theme-bg-primary border border-theme-sidebar-border rounded-lg p-4"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`px-2 py-1 text-xs font-medium rounded border ${getStatusColor(session.status)}`}>
                    {getStatusLabel(session.status)}
                  </span>
                  <span className="text-xs text-theme-text-secondary">
                    {formatDate(session.createdAt)}
                  </span>
                </div>
                <p className="text-sm text-theme-text-primary font-medium mb-1">
                  {t("autodetection.session.sessionId", "会话 ID")}: {session.id.substring(0, 16)}...
                </p>
                <div className="text-xs text-theme-text-secondary space-y-1">
                  <p>
                    {t("autodetection.session.progress", "进度")}: {session.processedFiles}/{session.totalFiles} 
                    {session.totalFiles > 0 && ` (${session.percentage}%)`}
                  </p>
                  {session.totalDefectsFound > 0 && (
                    <p>
                      {t("autodetection.session.defectsFound", "发现缺陷")}: {session.totalDefectsFound}
                    </p>
                  )}
                  {session.duration && (
                    <p>
                      {t("autodetection.session.duration", "持续时间")}: {formatDuration(session.duration)}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => handleResumeSession(session.id)}
                disabled={isLoading || session.status === SessionStatus.RUNNING}
                className="px-3 py-1.5 text-sm bg-theme-accent-primary text-white rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              >
                {isLoading
                  ? t("autodetection.session.resuming", "恢复中...")
                  : t("autodetection.session.resume", "恢复")}
              </button>
              <button
                onClick={() => handleViewDetails(session)}
                className="px-3 py-1.5 text-sm bg-theme-bg-secondary text-theme-text-primary border border-theme-sidebar-border rounded hover:bg-theme-bg-primary transition-colors"
              >
                {t("autodetection.session.viewDetails", "查看详情")}
              </button>
              <button
                onClick={() => handleDeleteSession(session.id)}
                disabled={session.status === SessionStatus.RUNNING}
                className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              >
                {t("autodetection.session.delete", "删除")}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Session Details Modal */}
      {selectedSession && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-theme-bg-secondary rounded-lg border border-theme-sidebar-border max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-theme-text-primary">
                  {t("autodetection.session.sessionDetails", "会话详情")}
                </h3>
                <button
                  onClick={() => setSelectedSession(null)}
                  className="text-theme-text-secondary hover:text-theme-text-primary"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-4 text-sm">
                <div>
                  <p className="text-theme-text-secondary mb-1">
                    {t("autodetection.session.sessionId", "会话 ID")}
                  </p>
                  <p className="text-theme-text-primary font-mono text-xs break-all">
                    {selectedSession.id}
                  </p>
                </div>

                <div>
                  <p className="text-theme-text-secondary mb-1">
                    {t("autodetection.session.status", "状态")}
                  </p>
                  <span className={`px-2 py-1 text-xs font-medium rounded border ${getStatusColor(selectedSession.status)}`}>
                    {getStatusLabel(selectedSession.status)}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-theme-text-secondary mb-1">
                      {t("autodetection.session.startTime", "开始时间")}
                    </p>
                    <p className="text-theme-text-primary">
                      {formatDate(selectedSession.metadata.createdAt)}
                    </p>
                  </div>
                  <div>
                    <p className="text-theme-text-secondary mb-1">
                      {t("autodetection.session.lastUpdate", "最后更新")}
                    </p>
                    <p className="text-theme-text-primary">
                      {formatDate(selectedSession.metadata.updatedAt)}
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-theme-text-secondary mb-1">
                    {t("autodetection.session.progress", "进度")}
                  </p>
                  <div className="bg-theme-bg-primary rounded p-3 border border-theme-sidebar-border">
                    <div className="flex justify-between mb-2">
                      <span className="text-theme-text-primary">
                        {selectedSession.progress.processedFiles}/{selectedSession.progress.totalFiles} {t("autodetection.status.progressFiles", "Files")}
                      </span>
                      <span className="text-theme-accent-primary font-semibold">
                        {selectedSession.progress.percentage}%
                      </span>
                    </div>
                    <div className="w-full bg-theme-sidebar-border rounded-full h-2">
                      <div
                        className="bg-theme-accent-primary h-2 rounded-full transition-all"
                        style={{ width: `${selectedSession.progress.percentage}%` }}
                      ></div>
                    </div>
                    {selectedSession.progress.currentFile && (
                      <p className="text-xs text-theme-text-secondary mt-2">
                        {t("autodetection.session.currentFile", "Current File")}: {selectedSession.progress.currentFile}
                      </p>
                    )}
                  </div>
                </div>

                {selectedSession.progress.totalDefectsFound > 0 && (
                  <div>
                    <p className="text-theme-text-secondary mb-1">
                      {t("autodetection.session.defectsFound", "发现缺陷")}
                    </p>
                    <p className="text-theme-text-primary">
                      {selectedSession.progress.totalDefectsFound} {t("autodetection.session.defectsLabel", "defects")} 
                      （{selectedSession.progress.filesWithDefects} {t("autodetection.session.filesLabel", "files")}）
                    </p>
                  </div>
                )}

                {selectedSession.results?.failedFiles?.length > 0 && (
                  <div>
                    <p className="text-theme-text-secondary mb-1">
                      {t("autodetection.session.failedFiles", "失败文件")}
                    </p>
                    <div className="bg-red-50 border border-red-200 rounded p-3 max-h-40 overflow-y-auto">
                      {selectedSession.results.failedFiles.map((file, index) => (
                        <div key={index} className="text-xs mb-2 last:mb-0">
                          <p className="text-red-800 font-medium">{file.name}</p>
                          <p className="text-red-600">{file.error}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedSession.error && (
                  <div>
                    <p className="text-theme-text-secondary mb-1">
                      {t("autodetection.session.error", "错误信息")}
                    </p>
                    <div className="bg-red-50 border border-red-200 rounded p-3">
                      <p className="text-red-700 text-xs">{selectedSession.error}</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-6 flex gap-3">
                <button
                  onClick={() => {
                    handleResumeSession(selectedSession.id);
                    setSelectedSession(null);
                  }}
                  disabled={isLoading || selectedSession.status === SessionStatus.RUNNING}
                  className="flex-1 px-4 py-2 bg-theme-accent-primary text-white rounded font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                >
                  {t("autodetection.session.resume", "恢复会话")}
                </button>
                <button
                  onClick={() => setSelectedSession(null)}
                  className="px-4 py-2 bg-theme-bg-primary text-theme-text-primary border border-theme-sidebar-border rounded font-medium hover:bg-theme-bg-secondary transition-colors"
                >
                  {t("autodetection.session.close", "关闭")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

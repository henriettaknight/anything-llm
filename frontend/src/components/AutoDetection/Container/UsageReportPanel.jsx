import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import UsageLogsAPI from "@/models/usageLogs";
import ReportPanel from "./ReportPanel";
import UsageDetailTab from "./UsageDetailTab";

/**
 * 用量明细 + 报告 双 Tab 容器
 * - Tab 1「用量明细」：从后端 /api/usage-logs/code-review 拉取当前用户的数据
 * - Tab 2「报告」：原 ReportPanel 嵌入（逻辑零改动，仅传 embedded）
 */
export default function UsageReportPanel({ reports, onDownload, onDelete }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("usage"); // 默认进入用量明细
  const [usageData, setUsageData] = useState({ records: [], pagination: null, summary: null });
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  const loadUsage = useCallback(async () => {
    setLoading(true);
    const result = await UsageLogsAPI.getCodeReviewUsage({ page, pageSize: 20 });
    if (result.success) {
      setUsageData(result);
    } else {
      setUsageData({ records: [], pagination: null, summary: null });
    }
    setLoading(false);
  }, [page]);

  useEffect(() => {
    if (activeTab === "usage") loadUsage();
  }, [activeTab, loadUsage]);

  const handlePageChange = (newPage) => {
    setPage(newPage);
  };

  const reportsCount = reports?.length || 0;

  return (
    <div className="bg-theme-bg-secondary rounded-lg border border-theme-sidebar-border p-6">
      {/* Tab 栏 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex gap-2 border-b border-theme-sidebar-border">
          <TabButton active={activeTab === "usage"} onClick={() => setActiveTab("usage")}>
            {t("autodetection.usage.tab", "用量明细")}
          </TabButton>
          <TabButton active={activeTab === "report"} onClick={() => setActiveTab("report")}>
            {t("autodetection.reports.tab", "报告")}
            {reportsCount > 0 && (
              <span className="ml-1 text-xs text-theme-text-secondary bg-theme-bg-primary px-1.5 py-0.5 rounded-full">
                {reportsCount}
              </span>
            )}
          </TabButton>
        </div>
      </div>

      {/* Tab 内容 */}
      {activeTab === "usage" ? (
        <UsageDetailTab
          data={usageData}
          loading={loading}
          page={page}
          onPageChange={handlePageChange}
        />
      ) : (
        <ReportPanel
          reports={reports}
          onDownload={onDownload}
          onDelete={onDelete}
          embedded
        />
      )}
    </div>
  );
}

/* ---------- 内部小组件 ---------- */

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
        active
          ? "border-theme-accent-primary text-theme-text-primary"
          : "border-transparent text-theme-text-secondary hover:text-theme-text-primary"
      }`}
    >
      {children}
    </button>
  );
}

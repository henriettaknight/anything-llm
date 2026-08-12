import React from "react";
import { useTranslation } from "react-i18next";
import { estimateFeeCNY, formatCNY, formatDurationMin } from "./usageFee";

/**
 * 用量明细子组件
 * - 5 个汇总卡片（调用次数 / 总Token / Prompt+Completion / 平均耗时(分钟) / 总费用(预估)）
 * - 明细表格（8 列，含费用列 DS/CL 双行）
 * - 分页
 * - 图例
 */
export default function UsageDetailTab({ data, loading, page, onPageChange }) {
  const { t } = useTranslation();
  const { records = [], pagination, summary } = data || {};

  if (loading) {
    return (
      <div className="py-8 text-center text-theme-text-secondary">
        {t("autodetection.usage.loading", "Loading...")}
      </div>
    );
  }

  if (!records || records.length === 0) {
    return (
      <div className="text-center py-6">
        <div className="text-2xl mb-1 opacity-50">📊</div>
        <p className="text-sm text-theme-text-secondary mb-1">
          {t("autodetection.usage.empty", "暂无用量数据")}
        </p>
        <p className="text-xs text-theme-text-secondary">
          {t("autodetection.usage.emptyHint", "代码检测完成后将自动统计")}
        </p>
      </div>
    );
  }

  // 汇总费用（基于 summary 的 prompt/completion 总数）
  const summaryFee = estimateFeeCNY({
    promptTokens: summary?.totalPromptTokens || 0,
    completionTokens: summary?.totalCompletionTokens || 0,
  });

  return (
    <div className="space-y-4">
      {/* 顶部 5 个汇总卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard
          label={t("autodetection.usage.summary.totalCalls", "总调用次数")}
          value={`${summary?.totalCalls || 0}`}
          unit={t("autodetection.usage.summary.callsUnit", "次")}
        />
        <SummaryCard
          label={t("autodetection.usage.summary.totalTokens", "总 Token")}
          value={(summary?.totalTokens || 0).toLocaleString()}
          accent
        />
        <SummaryCard
          label={t("autodetection.usage.summary.promptCompletion", "Prompt / Completion")}
          value={`${(summary?.totalPromptTokens || 0).toLocaleString()} / ${(summary?.totalCompletionTokens || 0).toLocaleString()}`}
          small
        />
        <SummaryCard
          label={t("autodetection.usage.summary.avgDuration", "平均耗时")}
          value={formatDurationMin(summary?.avgDurationMs || 0)}
          success
        />
        {/* 第 5 卡：总费用（预估）- 双行展示 DS / CL */}
        <SummaryCard
          label={t("autodetection.usage.summary.totalFee", "总费用（预估）")}
          warning
        >
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-theme-text-secondary">DeepSeek</span>
              <span className="text-yellow-500">{formatCNY(summaryFee.deepseek.cny)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-theme-text-secondary">Claude</span>
              <span className="text-yellow-500">{formatCNY(summaryFee.claude.cny)}</span>
            </div>
          </div>
        </SummaryCard>
      </div>

      {/* 明细表格（含费用列） */}
      <div className="overflow-x-auto rounded-lg border border-theme-sidebar-border">
        <table className="min-w-full text-sm">
          <thead className="bg-theme-bg-primary text-theme-text-secondary">
            <tr>
              <Th>{t("autodetection.usage.table.time", "时间")}</Th>
              <Th>{t("autodetection.usage.table.provider", "Provider")}</Th>
              <Th>{t("autodetection.usage.table.model", "模型")}</Th>
              <Th className="text-right">{t("autodetection.usage.table.prompt", "Prompt")}</Th>
              <Th className="text-right">{t("autodetection.usage.table.completion", "Completion")}</Th>
              <Th className="text-right">{t("autodetection.usage.table.total", "Total")}</Th>
              <Th className="text-right">{t("autodetection.usage.table.duration", "耗时")}</Th>
              <Th className="text-right">{t("autodetection.usage.table.fee", "费用（预估）")}</Th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => {
              const fee = estimateFeeCNY(r);
              return (
                <tr key={r.id} className="border-t border-theme-sidebar-border hover:bg-theme-bg-primary">
                  <Td>{new Date(r.occurredAt).toLocaleString()}</Td>
                  <Td>{r.provider || "-"}</Td>
                  <Td>{r.model || "-"}</Td>
                  <Td className="text-right">{r.promptTokens.toLocaleString()}</Td>
                  <Td className="text-right">{r.completionTokens.toLocaleString()}</Td>
                  <Td className="text-right font-medium text-theme-text-primary">
                    {r.totalTokens.toLocaleString()}
                  </Td>
                  <Td className="text-right">{formatDurationMin(r.durationMs)}</Td>
                  {/* 费用列：双行 DS / CL */}
                  <Td className="text-right">
                    <div className="text-xs">
                      <div>
                        <span className="text-theme-text-secondary">DS </span>
                        <span className="text-green-500">{formatCNY(fee.deepseek.cny)}</span>
                      </div>
                      <div>
                        <span className="text-theme-text-secondary">CL </span>
                        <span className="text-yellow-500">{formatCNY(fee.claude.cny)}</span>
                      </div>
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-theme-text-secondary">
            {t("autodetection.usage.pagination.total", "共 {{count}} 条", { count: pagination.total })}
            {" · "}
            {t("autodetection.usage.pagination.page", "第 {{page}} / {{totalPages}} 页", {
              page: pagination.page,
              totalPages: pagination.totalPages,
            })}
          </span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              className="px-3 py-1 bg-theme-bg-primary border border-theme-sidebar-border text-theme-text-primary text-sm rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            >
              {t("autodetection.usage.pagination.prev", "上一页")}
            </button>
            <button
              disabled={page >= pagination.totalPages}
              onClick={() => onPageChange(page + 1)}
              className="px-3 py-1 bg-theme-bg-primary border border-theme-sidebar-border text-theme-text-primary text-sm rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            >
              {t("autodetection.usage.pagination.next", "下一页")}
            </button>
          </div>
        </div>
      )}

      {/* 图例 */}
      <div className="text-xs text-theme-text-secondary border-t border-theme-sidebar-border pt-3 space-y-1">
        <div>
          <span className="text-green-500">●</span>{" "}
          {t("autodetection.usage.legend.deepseek", "DS = DeepSeek ($0.27/$1.10 per 1M)")}
        </div>
        <div>
          <span className="text-yellow-500">●</span>{" "}
          {t("autodetection.usage.legend.claude", "CL = Claude Sonnet 4.6 ($3/$15 per 1M)")}
        </div>
        <div>
          {t("autodetection.usage.legend.exchangeRate", "汇率按 1 USD = 7.2 CNY")}
        </div>
      </div>
    </div>
  );
}

/* ---------- 内部小组件 ---------- */

function SummaryCard({ label, value, unit, accent, success, warning, small, children }) {
  const valueColor = accent
    ? "text-blue-400"
    : success
    ? "text-green-500"
    : warning
    ? "text-yellow-500"
    : "text-theme-text-primary";
  return (
    <div className="bg-theme-bg-primary border border-theme-sidebar-border rounded-lg p-3">
      <div className="text-xs text-theme-text-secondary mb-1 truncate">{label}</div>
      {children ? (
        <div className={valueColor}>{children}</div>
      ) : (
        <div className={`${valueColor} ${small ? "text-sm" : "text-lg"} font-semibold`}>
          {value}
          {unit && <span className="text-xs text-theme-text-secondary ml-1">{unit}</span>}
        </div>
      )}
    </div>
  );
}

function Th({ children, className = "" }) {
  return <th className={`px-3 py-2 text-left font-medium ${className}`}>{children}</th>;
}

function Td({ children, className = "" }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}

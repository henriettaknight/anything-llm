/**
 * @fileoverview 用量明细页面的费用估算与格式化工具
 *
 * 定价表与汇率统一从 feeConfig.js 导入，与 tokenStatisticsService.js 共用同一份数据源，
 * 确保页面展示的费用与导出的 token_statistics.xlsx 完全一致。
 */

import { API_PRICING, USD_TO_CNY } from "@/utils/AutoDetectionEngine/services/feeConfig.js";

/**
 * 估算单次调用（或汇总）的费用（美元 + 人民币）。
 * 计算口径与 tokenStatisticsService.js 的 estimateCost 完全一致。
 *
 * @param {{promptTokens:number, completionTokens:number}} stats
 * @returns {{ deepseek: {usd:number, cny:number}, claude: {usd:number, cny:number} }}
 */
export function estimateFeeCNY(stats) {
  const prompt = stats.promptTokens || 0;
  const completion = stats.completionTokens || 0;
  const calc = (p) => {
    const usd = (prompt / 1e6) * p.inputPerM + (completion / 1e6) * p.outputPerM;
    return { usd, cny: usd * USD_TO_CNY };
  };
  return {
    deepseek: calc(API_PRICING.deepseek),
    claude:   calc(API_PRICING.claude),
  };
}

/** 格式化人民币显示，保留 2 位小数 */
export function formatCNY(cny) {
  return `¥${(cny || 0).toFixed(2)}`;
}

/** durationMs → "1.8 分钟"（保留 1 位小数） */
export function formatDurationMin(durationMs) {
  if (!durationMs) return "-";
  return `${(durationMs / 60000).toFixed(1)} 分钟`;
}

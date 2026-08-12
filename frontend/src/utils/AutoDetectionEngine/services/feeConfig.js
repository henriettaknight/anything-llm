/**
 * @fileoverview API 定价表与汇率配置（费用估算单一数据源）
 *
 * 本文件是费用估算的**唯一数据源**，供以下两处复用：
 *   1. tokenStatisticsService.js — 导出 token_statistics.xlsx 时的费用估算
 *   2. usageFee.js — 用量明细页面的费用估算展示
 *
 * 修改定价时只需改本文件，两处自动同步。
 *
 * 注意：本地 gemma4 模型无真实 API 费用，此处仅作等价成本参考。
 */

// 2026 公开 API 计费标准（美元 / 每百万 token）
export const API_PRICING = {
  deepseek: { label: 'DeepSeek (V3/R1)', inputPerM: 0.27, outputPerM: 1.10 },
  claude:   { label: 'Claude Sonnet 4.6', inputPerM: 3,    outputPerM: 15 }
};

// 美元 → 人民币换算汇率
export const USD_TO_CNY = 7.2;

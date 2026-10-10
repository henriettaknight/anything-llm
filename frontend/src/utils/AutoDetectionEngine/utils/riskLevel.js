/**
 * @fileoverview 风险等级（riskLevel）归一化工具
 *
 * 契约：缺陷风险等级严格限定为 P0 / P1 / P2 / P3 / Info。
 * 历史用过的 P4 统一并入 Info；其余非法值置空（避免污染报告与统计）。
 *
 * 该模块为纯函数，不依赖任何其他模块，便于在 Node 单测中直接抽取执行。
 */

/** 合法风险等级集合（归一化后的标准值） */
export const VALID_RISK_LEVELS = new Set(['P0', 'P1', 'P2', 'P3', 'Info']);

/**
 * 归一化风险等级字符串。
 * - 容错：大小写、首尾空格。
 * - P4 → Info（历史兼容）。
 * - 非法（含注入式字符串如 "P0; drop table"、未知等级、数字等）→ 空串。
 * @param {*} raw
 * @returns {string} 归一化后的 'P0'|'P1'|'P2'|'P3'|'Info' 或 ''
 */
export function normalizeRiskLevel(raw) {
  if (raw == null) return '';
  const s = String(raw).trim().toLowerCase();
  if (!s) return '';
  if (s === 'p0') return 'P0';
  if (s === 'p1') return 'P1';
  if (s === 'p2') return 'P2';
  if (s === 'p3') return 'P3';
  if (s === 'p4') return 'Info'; // 历史 P4 并入 Info
  if (s === 'info') return 'Info';
  return ''; // 非法值置空
}

/**
 * 风险等级排序权重（P0 最高 → Info 最低），用于报告排序/统计。
 * @param {string} level
 * @returns {number}
 */
export function riskLevelWeight(level) {
  switch (level) {
    case 'P0': return 0;
    case 'P1': return 1;
    case 'P2': return 2;
    case 'P3': return 3;
    case 'Info': return 4;
    default: return 5;
  }
}

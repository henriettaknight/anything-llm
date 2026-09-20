/**
 * @fileoverview Report Unit Service（报告单元化：分阶段检测报告）
 *
 * 将每个一级子目录 / root 的文件列表按累计大小（默认 256KB）贪心拆分为
 * 1..N 个报告单元（a1/a2/root1/root2…），每单元完成即产出一份阶段包，
 * 全部完成后仍有最终完整包（详见 doc/分阶段检测报告方案.md §2）。
 *
 * 拆分边界规则：
 * - 单文件本身超过阈值 → 独占一个单元（文件内容级拆分由 largeFileDetectionService 分块负责）
 * - 文件数兜底：超过 maxFilesPerUnit（默认 200）强制切分
 * - 必须在全局配对去重之后调用（被 .h 认领的 .cpp 已剔除，size 统计才准确）
 *
 * 断点续检依赖本模块的确定性：splitFilesIntoUnits 为纯函数
 * （同 files + 同 options → 同 units），恢复时重划分与首跑一致。
 */

import { serverLog } from './serverLogService.js';

/** 默认单元拆分阈值（字节）：256KB（可被 config.reportUnitSizeThresholdKB 覆盖；0 = 不拆分） */
export const DEFAULT_UNIT_THRESHOLD_BYTES = 256 * 1024;

/** 默认单元文件数上限兜底（防小文件堆积撑爆单元 xlsx 行数） */
export const DEFAULT_MAX_FILES_PER_UNIT = 200;

/**
 * 单元显示名：groupName + 1 起始序号（始终带序号，便于用户对应阶段下载）。
 * 例：('a', 0) → 'a1'；('root', 2) → 'root3'。
 * @param {string} groupName - 组名（一级目录名或 'root'）
 * @param {number} index - 0 起始序号
 * @returns {string}
 */
export function unitDisplayName(groupName, index) {
  return `${String(groupName || 'unit')}${index + 1}`;
}

/**
 * 按累计文件大小贪心拆分报告单元（纯函数）。
 *
 * @param {Array<Object>} files - 文件列表（含 path/name/size，保持原顺序扫描序）
 * @param {Object} [options]
 * @param {number} [options.thresholdBytes=DEFAULT_UNIT_THRESHOLD_BYTES] - 单元累计大小阈值；0 表示不拆分
 * @param {number} [options.maxFilesPerUnit=DEFAULT_MAX_FILES_PER_UNIT] - 单元文件数上限兜底
 * @returns {Array<Object>} units: [{ files: [...], sizeBytes }]（不含名称，名称由调用方按 unitDisplayName 拼）
 */
export function splitFilesIntoUnits(files, options = {}) {
  const thresholdBytes =
    typeof options.thresholdBytes === 'number' && options.thresholdBytes >= 0
      ? options.thresholdBytes
      : DEFAULT_UNIT_THRESHOLD_BYTES;
  const maxFilesPerUnit =
    typeof options.maxFilesPerUnit === 'number' && options.maxFilesPerUnit >= 1
      ? options.maxFilesPerUnit
      : DEFAULT_MAX_FILES_PER_UNIT;

  const list = Array.isArray(files) ? files : [];
  if (list.length === 0) return [];

  // 阈值 0 → 不拆分（兼容兜底：退化为旧行为一组一份报告）
  if (thresholdBytes === 0) {
    const sizeBytes = list.reduce((sum, f) => sum + (Number(f?.size) || 0), 0);
    return [{ files: list, sizeBytes }];
  }

  const units = [];
  let cur = [];
  let curSize = 0;

  for (const f of list) {
    const size = Number(f?.size) || 0;

    // 累计超阈值 → 封装当前单元
    if (cur.length > 0 && curSize + size > thresholdBytes) {
      units.push({ files: cur, sizeBytes: curSize });
      cur = [];
      curSize = 0;
    }

    cur.push(f);
    curSize += size;

    // 单文件独占：本身超阈值 或 触发文件数兜底 → 立即封装
    if (size > thresholdBytes || cur.length >= maxFilesPerUnit) {
      units.push({ files: cur, sizeBytes: curSize });
      cur = [];
      curSize = 0;
    }
  }

  // 收尾：剩余文件封装为最后一个单元
  if (cur.length > 0) {
    units.push({ files: cur, sizeBytes: curSize });
  }

  return units;
}

/**
 * 为一组文件生成完整的报告单元列表（含单元名与 plan 快照字段）。
 *
 * @param {string} groupName - 组名（一级目录名或 'root'）
 * @param {Array<Object>} files - 组内文件列表（已完成全局配对去重）
 * @param {Object} [options] - 同 splitFilesIntoUnits
 * @returns {Array<Object>} [{ unitName, files, sizeBytes }]
 */
export function buildReportUnits(groupName, files, options = {}) {
  const raw = splitFilesIntoUnits(files, options);
  const units = raw.map((u, i) => ({
    unitName: unitDisplayName(groupName, i),
    groupName,
    files: u.files,
    sizeBytes: u.sizeBytes,
  }));
  if (units.length > 1) {
    serverLog?.info(
      `[报告单元] 组 ${groupName} 拆分为 ${units.length} 个单元（阈值 ${options.thresholdBytes ?? DEFAULT_UNIT_THRESHOLD_BYTES}B，` +
        `总大小 ${units.reduce((s, u) => s + u.sizeBytes, 0)}B）`
    );
  }
  return units;
}

/**
 * 生成单元划分快照（断点续检的校验基准，存 localStorage 的 unitPlan）。
 * 快照记录每个单元的文件路径集合与大小——恢复时重新划分后比对，
 * 不一致则整单元重跑（保守策略：宁可重跑、不可错并）。
 *
 * @param {Array<Object>} units - buildReportUnits 的返回值
 * @returns {Array<Object>} [{ unitName, groupName, files: [path], sizeBytes }]
 */
export function buildUnitPlanSnapshot(units) {
  return (units || []).map((u) => ({
    unitName: u.unitName,
    groupName: u.groupName,
    files: (u.files || []).map((f) => f?.path).filter(Boolean),
    sizeBytes: u.sizeBytes || 0,
  }));
}

/**
 * 校验恢复时的单元划分与快照是否一致（文件集合与大小逐项比对）。
 *
 * @param {Array<Object>} currentUnits - 恢复时重新划分的单元（buildReportUnits 返回值）
 * @param {Array<Object>} snapshot - 首跑存的 unitPlan 快照（buildUnitPlanSnapshot 返回值）
 * @returns {{consistent: boolean, changedUnits: string[]}} consistent=完全一致；changedUnits=发生变化的单元名
 */
export function verifyUnitPlan(currentUnits, snapshot) {
  const changed = [];
  const snapByName = new Map((snapshot || []).map((s) => [s.unitName, s]));
  const curByName = new Map((currentUnits || []).map((u) => [u.unitName, u]));

  for (const [name, snap] of snapByName) {
    const cur = curByName.get(name);
    if (!cur) {
      changed.push(name); // 快照里的单元消失了（文件被删/移走）
      continue;
    }
    const curPaths = (cur.files || []).map((f) => f?.path).filter(Boolean).sort();
    const snapPaths = [...(snap.files || [])].sort();
    if (
      curPaths.length !== snapPaths.length ||
      curPaths.some((p, i) => p !== snapPaths[i]) ||
      (cur.sizeBytes || 0) !== (snap.sizeBytes || 0)
    ) {
      changed.push(name); // 文件集合或总大小变化
    }
  }

  // 当前出现快照中不存在的单元 → 也视为变化
  for (const name of curByName.keys()) {
    if (!snapByName.has(name)) changed.push(name);
  }

  return { consistent: changed.length === 0, changedUnits: changed };
}

/**
 * @fileoverview Global Header/Implementation Pairing Map Service
 *
 * 检测前一次性扫描全部待检文件，构建全局 .h ↔ .cpp 配对映射表，
 * 替代"逐文件同目录找兄弟"的旧逻辑（findSiblingByExtensions 仅同目录）。
 *
 * 修复两个问题（详见 doc/分阶段检测报告方案.md §3.0）：
 * 1. include/ + src/ 分离布局的项目（C++ 标准布局）此前完全配不上对；
 * 2. 口径不一致导致隐性漏检：旧 _filterPairedImplementationFiles 按基名整组剔除 .cpp，
 *    但 .h 检测时只在同目录找 .cpp → 跨目录场景下 .cpp 既没被合并也没被独立检测。
 *
 * 匹配优先级（双向对称）：
 *   1. 同目录同名（现行为，最高置信，向后兼容）
 *   2. 跨目录唯一同名（include/src 布局）
 *   3. 同基名多个候选且无法判定 → 不配对（保守，绝不误合并）
 *
 * ⚠️ 回归红线：反向配对（impl→header）结果仅作「声明骨架」（headerRef），
 *    绝不可赋给 pairedFile——防止大 .cpp 绕过大文件分块闸门。
 */

import { serverLog } from './serverLogService.js';

const HEADER_EXTENSIONS = ['.h', '.hpp', '.hxx'];
const IMPL_EXTENSIONS = ['.cpp', '.cc', '.cxx'];

/**
 * 取文件扩展名（小写）
 * @param {string} name - 文件名
 * @returns {string} 扩展名（含点，如 '.h'）或空字符串
 */
function extensionOf(name) {
  const dot = String(name || '').lastIndexOf('.');
  return dot > 0 ? String(name).slice(dot).toLowerCase() : '';
}

/**
 * 取文件基名（小写，不含扩展名）
 * @param {string} name - 文件名
 * @returns {string} 基名，如 'x.h' → 'x'
 */
function baseNameOf(name) {
  const dot = String(name || '').lastIndexOf('.');
  return dot > 0 ? String(name).slice(0, dot).toLowerCase() : String(name || '').toLowerCase();
}

/**
 * 取文件所在目录路径（与 fileInfo.path 的 '/' 分隔保持一致）
 * @param {string} path - 文件相对路径，如 'a/include/x.h'
 * @returns {string} 目录路径，如 'a/include'；根目录返回 ''
 */
function dirOf(path) {
  const p = String(path || '');
  const slash = p.lastIndexOf('/');
  return slash >= 0 ? p.slice(0, slash) : '';
}

/**
 * 按候选扩展名集合，在候选列表中挑选配对结果。
 * 匹配优先级：同目录同名 > 唯一同名（跨目录）> 多候选不配。
 * @param {Object} source - 源文件信息（含 name/path）
 * @param {Array<Object>} candidates - 同基名的另一侧文件信息列表
 * @param {Array<string>} extensions - 本侧允许的候选扩展名
 * @returns {Object|null} 匹配到的 FileInfo，或 null（不配对）
 * @private
 */
function pickCandidate(source, candidates, extensions) {
  if (!candidates || candidates.length === 0) return null;

  const sourceDir = dirOf(source.path);

  // 优先级 1：同目录同名（任一候选扩展名命中）
  for (const ext of extensions) {
    const sameDir = candidates.find((c) => dirOf(c.path) === sourceDir && extensionOf(c.name) === ext);
    if (sameDir) return sameDir;
  }

  // 优先级 2：全局唯一同名（跨目录，include/src 布局）
  const matches = candidates.filter((c) => extensions.includes(extensionOf(c.name)));
  if (matches.length === 1) return matches[0];

  // 优先级 3：多候选无法判定 → 保守不配
  if (matches.length > 1) {
    serverLog?.info(
      `[配对映射] ${source.path} 同基名存在 ${matches.length} 个候选（${matches.map((m) => m.path).join(', ')}），无法判定归属，不配对`
    );
  }
  return null;
}

/**
 * 构建全局配对映射表（纯函数：同输入同输出，断点续检依赖此确定性）。
 *
 * @param {Array<Object>} allFiles - 全部待检文件（含 name/path，扫描阶段已采集）
 * @returns {{pairOf: Function, pairOfHeader: Function, stats: Object}}
 *   pairOf(implPath)      → 配对头文件 FileInfo | null（.cpp → .h）
 *   pairOfHeader(hdrPath) → 配对实现文件 FileInfo | null（.h → .cpp）
 *   stats                 → { headers, impls, pairs } 建表统计
 */
export function buildPairingMap(allFiles) {
  const files = Array.isArray(allFiles) ? allFiles : [];

  /** @type {Map<string, Array<Object>>} 基名 → 头文件列表 */
  const headers = new Map();
  /** @type {Map<string, Array<Object>>} 基名 → 实现文件列表 */
  const impls = new Map();

  for (const f of files) {
    if (!f || !f.name) continue;
    const ext = extensionOf(f.name);
    const base = baseNameOf(f.name);
    if (HEADER_EXTENSIONS.includes(ext)) {
      if (!headers.has(base)) headers.set(base, []);
      headers.get(base).push(f);
    } else if (IMPL_EXTENSIONS.includes(ext)) {
      if (!impls.has(base)) impls.set(base, []);
      impls.get(base).push(f);
    }
  }

  /** @type {Map<string, Object>} implPath → 配对头 FileInfo */
  const implToHeader = new Map();
  /** @type {Map<string, Object>} headerPath → 配对实现 FileInfo */
  const headerToImpl = new Map();

  let pairCount = 0;
  for (const [base, implList] of impls) {
    const headerList = headers.get(base);
    if (!headerList) continue;
    for (const impl of implList) {
      const header = pickCandidate(impl, headerList, HEADER_EXTENSIONS);
      if (header) {
        implToHeader.set(impl.path, header);
        // 反向索引：同目录/唯一匹配天然互逆；若一对多（两个 .cpp 配同一 .h），
        // headerToImpl 保留首个——只有被认领的那个才承担「合并检测」职责，
        // 其余 .cpp 必须保持独立检测（见 claimedImpls 注释）
        if (!headerToImpl.has(header.path)) {
          headerToImpl.set(header.path, impl);
        }
        pairCount++;
      }
    }
  }

  // 被 .h 明确认领（承担合并检测职责）的实现文件路径集合。
  // 去重只能剔除这里的成员：pairOf 非空 ≠ 被认领——
  // 极端场景 a/x.cpp 与 y/x.cpp 都配到 a/x.h 时，仅同目录者优先被认领，
  // 若按 pairOf 剔除会把未被合并的 y/x.cpp 一并剔除，造成新的漏检。
  const claimedImpls = new Set(headerToImpl.values().map((f) => f.path));

  const stats = {
    headers: headers.size,
    impls: impls.size,
    pairs: pairCount,
    claimedImpls: claimedImpls.size,
  };
  serverLog?.info(
    `[配对映射] 建表完成：头文件基名 ${stats.headers} 个，实现文件基名 ${stats.impls} 个，配对 ${stats.pairs} 对（被认领实现文件 ${stats.claimedImpls} 个）`
  );

  return {
    /**
     * 实现文件 → 配对头文件（含跨目录）。
     * ⚠️ 结果仅作声明骨架 headerRef 来源，绝不可赋给 pairedFile。
     * @param {string} implPath
     * @returns {Object|null}
     */
    pairOf(implPath) {
      return implToHeader.get(implPath) || null;
    },
    /**
     * 头文件 → 配对实现文件（含跨目录，供 .h 合并 .cpp 检测）
     * @param {string} headerPath
     * @returns {Object|null}
     */
    pairOfHeader(headerPath) {
      return headerToImpl.get(headerPath) || null;
    },
    /**
     * 该实现文件是否被某个 .h 明确认领（其检测由 .h 合并承担）。
     * 去重剔除的唯一合法依据，保证「剔除口径 = 合并口径」。
     * @param {string} implPath
     * @returns {boolean}
     */
    isClaimedImpl(implPath) {
      return claimedImpls.has(implPath);
    },
    stats,
  };
}

/**
 * 工具：判断某实现文件是否已被同名 .h 认领（供全局去重使用）。
 * 与 headerToImpl 同源，保证「剔除口径 = 合并口径」，根治跨目录漏检。
 * @param {Object} pairingMap - buildPairingMap 的返回值
 * @param {Object} implFile - 实现文件信息
 * @returns {boolean}
 */
export function isPairedImpl(pairingMap, implFile) {
  if (!pairingMap || !implFile) return false;
  return pairingMap.isClaimedImpl?.(implFile.path) === true;
}

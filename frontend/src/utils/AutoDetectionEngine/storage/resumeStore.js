/**
 * @fileoverview Resume Store Service（断点续检 + chunk 缓存：IndexedDB 持久化）
 *
 * 存储分层（doc/分阶段检测报告方案.md §3.6.1 + 第三阶段方案 §12.1 融合）：
 * - localStorage（SessionStorage）：轻量清单——unitPlan / completedUnits / completedFiles / chunkProgress
 * - IndexedDB（本模块）：
 *   · unit_results / chunk_results：断点数据（会话级，COMPLETED 时 clearSession 清理）
 *   · chunk_cache（第三阶段）：**跨会话**块结果缓存（内容寻址：originalHash+chunkHash+model+promptVersion，
 *     长期保留，clearSession 不清；模型/提示词版本变更自然失效）
 *
 * 兼容性：非浏览器环境 / IndexedDB 不可用时全部方法静默 no-op（返回 null/空数组/false），
 * 检测主流程不受影响（断点降级为旧的文件级恢复、缓存降级为不命中）。
 */

const DB_NAME = 'AutoDetectionResumeDB';
const DB_VERSION = 2; // v2：新增 chunk_cache store（第三阶段 §12.1）
const UNIT_STORE = 'unit_results';    // 复合主键 [sessionId, unitName]
const CHUNK_STORE = 'chunk_results';  // 复合主键 [sessionId, filePath]
const CACHE_STORE = 'chunk_cache';    // 主键 cacheKey（内容寻址字符串，跨会话）

/** @type {Promise<IDBDatabase>|null} 数据库连接缓存 */
let dbPromise = null;

/**
 * 打开（并按需初始化）IndexedDB 连接
 * @returns {Promise<IDBDatabase|null>}
 * @private
 */
function openDB() {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(UNIT_STORE)) {
        db.createObjectStore(UNIT_STORE, { keyPath: ['sessionId', 'unitName'] });
      }
      if (!db.objectStoreNames.contains(CHUNK_STORE)) {
        db.createObjectStore(CHUNK_STORE, { keyPath: ['sessionId', 'filePath'] });
      }
      // v2：chunk 缓存 store（单列主键，内容寻址，跨会话）
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE, { keyPath: 'cacheKey' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      console.warn('[resumeStore] IndexedDB 打开失败，断点续检降级:', request.error?.message);
      dbPromise = null; // 允许后续重试
      resolve(null);
    };
  });
  return dbPromise;
}

/**
 * 在指定 store 上执行事务操作（通用封装）
 * @param {string} storeName - object store 名
 * @param {Function} executor - (store) => IDBRequest，返回要监听的请求
 * @param {string} mode - 事务模式 'readonly' | 'readwrite'
 * @returns {Promise<any>} 请求 result；数据库不可用时返回 null
 * @private
 */
async function runRequest(storeName, executor, mode = 'readonly') {
  const db = await openDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, mode);
      const request = executor(tx.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        console.warn(`[resumeStore] ${storeName} 操作失败:`, request.error?.message);
        resolve(null);
      };
    } catch (e) {
      console.warn(`[resumeStore] ${storeName} 事务异常:`, e?.message);
      resolve(null);
    }
  });
}

/**
 * 保存单元结果（单元完成时调用；同 key 覆盖写）
 *
 * @param {string} sessionId - 会话 ID
 * @param {string} unitName - 单元名（如 'a1' / 'root2'）
 * @param {Object} result - 单元结果 { groupName, groupPath, batches, aggregated, defectsFound, tokenRecords }
 * @returns {Promise<boolean>}
 */
export async function saveUnitResult(sessionId, unitName, result) {
  if (!sessionId || !unitName) return false;
  const record = {
    sessionId,
    unitName,
    groupName: result?.groupName || unitName,
    groupPath: result?.groupPath || '.',
    batches: result?.batches || [],
    aggregated: result?.aggregated || null,
    defectsFound: result?.defectsFound ?? 0,
    tokenRecords: result?.tokenRecords || [],
    savedAt: Date.now(),
  };
  const done = await runRequest(
    UNIT_STORE,
    (store) => store.put(record),
    'readwrite'
  );
  return done !== null;
}

/**
 * 读取单个单元结果
 * @param {string} sessionId
 * @param {string} unitName
 * @returns {Promise<Object|null>}
 */
export async function loadUnitResult(sessionId, unitName) {
  if (!sessionId || !unitName) return null;
  return runRequest(UNIT_STORE, (store) => store.get([sessionId, unitName]));
}

/**
 * 读取会话的全部单元结果
 * @param {string} sessionId
 * @returns {Promise<Array<Object>>} 按保存时间排序的单元结果列表
 */
export async function loadAllUnitResults(sessionId) {
  if (!sessionId) return [];
  const all = await runRequest(UNIT_STORE, (store) => store.getAll());
  if (!Array.isArray(all)) return [];
  return all.filter((r) => r.sessionId === sessionId).sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
}

/**
 * 追加大文件的块级进度与缺陷（每完成一块调用，IndexedDB 小事务不卡 UI）
 *
 * 🔧 doneSet 前置改造（第三阶段方案 §12.2）：完成块**集合**（乱序安全）替代 doneChunks 计数
 * （前缀语义）——为风险热点优先级调度（乱序送审）铺地基；按序执行时集合恒为前缀，行为不变。
 * 旧记录（仅 doneChunks）读取时自动转换为前缀集合，兼容已存断点。
 * perChunk（块号→该块缺陷）为第三阶段精确提取先验缺陷预留，flat defects 维持现状消费。
 *
 * @param {string} sessionId
 * @param {string} filePath - 大文件路径
 * @param {number} chunkIndex - 刚完成的块序号（0 起始，允许乱序到达）
 * @param {number} totalChunks - 总块数
 * @param {Array<Object>} chunkDefects - 该块产出的缺陷列表
 * @returns {Promise<boolean>}
 */
export async function appendChunkResult(sessionId, filePath, chunkIndex, totalChunks, chunkDefects) {
  if (!sessionId || !filePath) return false;
  const existing = await runRequest(CHUNK_STORE, (store) => store.get([sessionId, filePath]));

  // 完成块集合：新格式 doneSet；旧格式 doneChunks → 前缀集合兼容
  let doneSet = Array.isArray(existing?.doneSet) ? [...existing.doneSet] : [];
  if (doneSet.length === 0 && existing && existing.doneChunks > 0) {
    doneSet = Array.from({ length: existing.doneChunks }, (_, k) => k);
  }

  // 幂等保护（集合语义）：同一块重复追加只记一次
  if (doneSet.includes(chunkIndex)) {
    return true;
  }
  doneSet.push(chunkIndex);

  const record = existing || {
    sessionId,
    filePath,
    defects: [],
    perChunk: {},
    savedAt: Date.now(),
  };
  record.doneSet = doneSet;
  record.totalChunks = totalChunks || record.totalChunks || 0;
  if (Array.isArray(chunkDefects) && chunkDefects.length > 0) {
    record.defects = (record.defects || []).concat(chunkDefects);
    record.perChunk = record.perChunk || {};
    record.perChunk[String(chunkIndex)] = (record.perChunk[String(chunkIndex)] || []).concat(chunkDefects);
  }
  record.savedAt = Date.now();
  const done = await runRequest(CHUNK_STORE, (store) => store.put(record), 'readwrite');
  return done !== null;
}

/**
 * 读取大文件的块级进度与已累积缺陷
 * @param {string} sessionId
 * @param {string} filePath
 * @returns {Promise<{doneChunks: number, totalChunks: number, defects: Array}|null>}
 */
export async function loadChunkResult(sessionId, filePath) {
  if (!sessionId || !filePath) return null;
  return runRequest(CHUNK_STORE, (store) => store.get([sessionId, filePath]));
}

/**
 * 清理一个会话的全部断点数据（会话 COMPLETED / CANCELLED 时调用，防止长期占浏览器存储）
 * @param {string} sessionId
 * @returns {Promise<boolean>}
 */
export async function clearSession(sessionId) {
  if (!sessionId) return false;
  const db = await openDB();
  if (!db) return false;
  const results = await Promise.all([
    runRequest(UNIT_STORE, (store) => store.getAllKeys(), 'readonly'),
    runRequest(CHUNK_STORE, (store) => store.getAllKeys(), 'readonly'),
  ]);
  const [unitKeys, chunkKeys] = results;
  const unitTargets = (unitKeys || []).filter((k) => Array.isArray(k) && k[0] === sessionId);
  const chunkTargets = (chunkKeys || []).filter((k) => Array.isArray(k) && k[0] === sessionId);
  await Promise.all([
    runRequest(UNIT_STORE, (store) => {
      unitTargets.forEach((k) => store.delete(k));
      return store.getAllKeys(); // 触发 onsuccess 以确认事务提交
    }, 'readwrite'),
    runRequest(CHUNK_STORE, (store) => {
      chunkTargets.forEach((k) => store.delete(k));
      return store.getAllKeys();
    }, 'readwrite'),
  ]);
  console.log(`[resumeStore] 会话 ${sessionId} 断点数据已清理（单元 ${unitTargets.length}，块级 ${chunkTargets.length}）`);
  return true;
}

// ============================
// chunk 缓存（第三阶段 §12.1：跨会话、内容寻址）
// ============================

/**
 * 组装缓存键（内容寻址：原文件 hash + 块 hash + 模型 + 提示词版本）。
 * 任一维度变化 → 键变化 → 自然失效（不命中 → 重新送审）。
 * @param {Object} key - { originalHash, chunkHash, model, promptVersion }
 * @returns {string}
 */
export function buildCacheKey({ originalHash, chunkHash, model, promptVersion }) {
  return [originalHash, chunkHash, model || '', promptVersion || ''].join('::');
}

/**
 * 查询 chunk 缓存。
 * @param {Object} key - { originalHash, chunkHash, model, promptVersion }
 * @returns {Promise<{defects:Array, tokenUsage:Object|null, createdAt:number}|null>} 命中返回条目，否则 null
 */
export async function getChunkCache(key) {
  const cacheKey = buildCacheKey(key);
  const entry = await runRequest(CACHE_STORE, (store) => store.get(cacheKey));
  if (!entry) return null;
  return { defects: entry.defects || [], tokenUsage: entry.tokenUsage || null, createdAt: entry.createdAt };
}

/**
 * 写入 chunk 缓存（同键覆盖）。
 * @param {Object} key - { originalHash, chunkHash, model, promptVersion }
 * @param {Object} entry - { defects, tokenUsage, rawResponse? }
 * @returns {Promise<boolean>}
 */
export async function setChunkCache(key, entry) {
  const cacheKey = buildCacheKey(key);
  const record = {
    cacheKey,
    originalHash: key?.originalHash || '',
    chunkHash: key?.chunkHash || '',
    model: key?.model || '',
    promptVersion: key?.promptVersion || '',
    defects: entry?.defects || [],
    tokenUsage: entry?.tokenUsage || null,
    rawResponse: entry?.rawResponse || '',
    createdAt: Date.now(),
  };
  const done = await runRequest(CACHE_STORE, (store) => store.put(record), 'readwrite');
  return done !== null;
}

/**
 * 清空全部 chunk 缓存（诊断/容量压力用；不影响断点数据）。
 * @returns {Promise<boolean>}
 */
export async function clearChunkCache() {
  const db = await openDB();
  if (!db) return false;
  const done = await runRequest(CACHE_STORE, (store) => store.clear(), 'readwrite');
  return done !== null;
}

/**
 * chunk 缓存统计（诊断用）。
 * @returns {Promise<{entries:number}|null>}
 */
export async function getChunkCacheStats() {
  const count = await runRequest(CACHE_STORE, (store) => store.count());
  return count === null ? null : { entries: count };
}

export default {
  saveUnitResult,
  loadUnitResult,
  loadAllUnitResults,
  appendChunkResult,
  loadChunkResult,
  clearSession,
  buildCacheKey,
  getChunkCache,
  setChunkCache,
  clearChunkCache,
  getChunkCacheStats,
};

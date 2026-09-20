/**
 * @fileoverview Large File Detection Service（第一阶段：本地预分块送审）
 * 协调器：对超阈值的大单文件本地按"空行边界 + 函数/类签名"切分为带重叠的小块，
 * 逐块（串行）送审，再在本地合并去重、用整文件内容回写真实绝对行号与函数名，
 * 产出与 detectDefectsInFile 一致的 DefectDetectionResult[]。
 * 小文件、多文件批量、分组检测、依赖配对逻辑完全不变（由调用方 codeDetectionService 控制）。
 */

import {
  getCodeReviewAIService,
  getServerLog,
  parseDefectDetectionResults,
  locateSnippetInFile,
  extractHintLine,
  deduplicateDefects,
  mergeSamplesByLocation,
  repairSnippetFromLines,
  withLineNumbers,
  isPromptAckOrMetaResponse,
} from './codeDetectionService.js';
import { buildChunkSystemPrompt, buildChunkUserMessage } from '../context/chunkContextBuilder.js';
import { buildFileStructureSkeleton, locateScopeForChunk } from '../context/headerSkeletonExtractor.js';
import tokenStatisticsService from './tokenStatisticsService.js';
// 🔧 第三阶段（§12.1）：chunk 缓存与断点续检共享 IndexedDB 封装（resumeStore 同 DB 第三 store）
import { getChunkCache as chunkCacheGetChunk, setChunkCache as chunkCacheSetChunk } from '../storage/resumeStore.js';

/** 单文件进入分块送审的规模阈值（行/token）——保留导出：codeDetectionService 闸门引用 */
export const SINGLE_FILE_CHUNK_THRESHOLD = 700;
/** 相邻分块之间的重叠行数（重叠区仅识别不重复报，过大将显著拖慢本地模型）——保留导出兼容 */
export const CHUNK_OVERLAP = 150;
/** 单块内容字符上限兜底（避免极端长行导致单块token爆炸）——保留导出兼容 */
export const MAX_CHUNK_CHARS = 120000;

/**
 * 🔧 第二阶段：统一配置对象（收敛散落常量，doc/本地预分块送审第二阶段改造方案.md §4.5）。
 * 运行期阈值仍从旧常量取值（单一事实来源），开关项集中在此。
 * ⚠️ 红线：任何配置不得阻断 onChunkDone/startFromChunk/skipChunks 的传递（断点续检生命线）。
 */
export const LARGE_FILE_DETECTION_CONFIG = {
  // 分块规模（与上方常量同值，闸门与分块共用）
  chunkThreshold: SINGLE_FILE_CHUNK_THRESHOLD,
  chunkOverlap: CHUNK_OVERLAP,
  maxChunkChars: MAX_CHUNK_CHARS,
  chatTimeoutMs: 900000,

  // 🔧 第二阶段新增：多次采样取并集（对齐 inline 路径 SAMPLE_COUNT=2）
  enableChunkSampling: true,            // false 退化为每块单次采样（第一阶段行为）
  sampleCount: 2,                       // 与 inline 路径一致
  // 🔧 第二阶段新增：单块降级重试（全部采样失败/空且非 meta → 缩小上下文再试一次）
  enableChunkDegradeRetry: true,
  // 🔧 第二阶段新增：提示词版本（第三阶段缓存键依赖；cpp_prompt.md 变更时手动 bump）
  promptVersion: 'chunk-v2',

  // 🔧 第三阶段新增（doc/本地预分块送审第三阶段改造方案.md §8 + §12 融合）
  enableChunkCache: true,             // 跨会话块缓存（chunk_cache store，内容寻址）
  enableIncrementalRerun: true,       // 增量重跑（§12.3 裁决链：mtime/size 快判 → originalHash 裁决 → chunkHash 逐块）
  enableRiskPriority: true,           // 风险热点优先级调度（乱序送审；doneSet 集合语义已支持）
  enableDiagnostics: true,            // 诊断输出（cacheInfo / rawResponse 已随第二阶段落地，此开关控制日志详细度）
};

/**
 * 🔧 第二阶段：hash 基建（doc/第二阶段方案 §4.2）。
 * 轻量同步哈希（FNV-1a 32 位 × 双轮 + 长度）——不引 Web Crypto（async、大文件多次 await 开销），
 * 目标是"内容变更可检出"（区分 git checkout 恢复原内容 vs 真实修改），非密码学强度。
 * 纯函数：同输入同输出，断点/缓存键依赖此确定性。
 * @param {string} content
 * @returns {string} 'fnv2:十六进制' 形式的哈希
 */
export function computeContentHash(content) {
  const s = String(content ?? '');
  // FNV-1a 32 位
  let h1 = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h1 ^= s.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
  }
  // 第二轮：反向 + 偏移（降低短字符串碰撞与顺序敏感性缺陷）
  let h2 = 0x01000193;
  for (let i = s.length - 1; i >= 0; i--) {
    h2 ^= s.charCodeAt(i) + i;
    h2 = Math.imul(h2, 0x811c9dc5) >>> 0;
  }
  return `fnv2:${h1.toString(16)}${h2.toString(16)}:${s.length}`;
}

/**
 * 🔧 第二阶段：chunk 标识（chunkHash = 内容哈希 + 行范围 + promptVersion）。
 * @param {{startLine:number,endLine:number,content:string}} chunk
 * @param {string} [promptVersion]
 * @returns {string}
 */
export function computeChunkHash(chunk, promptVersion = LARGE_FILE_DETECTION_CONFIG.promptVersion) {
  const c = chunk || {};
  return `${computeContentHash(c.content)}|L${c.startLine}-${c.endLine}|${promptVersion}`;
}

/**
 * 🔧 第三阶段（§3.3）：估算块的风险热点权重（复用块内容启发式，不新增 AST）。
 * 权重仅用于**调度顺序**（高风险先审——即便全量未完成也能优先给出高风险问题），
 * 不改变分块边界、不影响结果正确性。
 *
 * 规则（命中即累计，上限 10）：
 * - 构造/析构函数体 → +4；资源释放（delete/free/Close/Release/Lock/Unlock）→ +3；
 * - 协议索引（CoordIndex/SkillIndex 等敏感字段）→ +3；
 * - 裸指针/数组下标访问 → +2；高危 API（网络/文件/线程）→ +2；其余 → 1（基线）。
 *
 * @param {{content:string}} chunk
 * @returns {number}
 */
export function estimateChunkRisk(chunk) {
  const content = String(chunk?.content || '');
  if (!content) return 1;
  let w = 1;
  // 构造/析构函数体（类方法签名行）
  if (/::~?\w+\s*\([^)]*\)\s*(const)?\s*\{?/.test(content) && /::~?\w+\s*\(/.test(content)) w += 4;
  // 资源释放 / 锁
  if (/\b(delete|free|fclose|close|Close|Release|Unlock)\s*[\(\[=]/.test(content)) w += 3;
  // 协议索引（敏感字段只发索引不发真实值的 SECURITY 焦点）
  if (/\b(CoordIndex|SkillIndex)\b/.test(content)) w += 3;
  // 裸指针 / 数组下标
  if (/\w+\s*\[\s*\w+\s*\]|\*\s*\w+\s*(=|->|\.)|\w+\s*->\s*\w+/.test(content)) w += 2;
  // 高危 API（网络/文件/线程）
  if (/\b(socket|connect|send|recv|fopen|fwrite|CreateThread|pthread_|std::thread|std::async)\b/.test(content)) w += 2;
  return Math.min(w, 10);
}
/**
 * 单块 AI 调用超时（ms）。
 * 原值 300000（5 分钟）过短：实测 ollama(gemma4-31b) 单次 /api/chat 耗时
 * 3~6 分钟，长尾达 6m35s；串行链上偶发接近两块叠加。5 分钟会误杀长尾块
 * 导致该块被 abort（"Direct AI request was cancelled"）整轮无结果。
 * 提到 900000（15 分钟）以覆盖长尾；与 dualModeAIAdapter 10 分钟档拉开余量。
 */
const CHAT_TIMEOUT = 900000;

/**
 * 估算文件规模：token 近似（字符/4）与行数取较大者。
 * @param {string} content
 * @returns {number}
 */
/**
 * 基于整文件内容统计代码行 / 注释行 / 空行（不含系统提示词，结果贴近真实源码）。
 * 与 tokenStatisticsService._countLines（基于 prompt 文本）区分，本函数直接分析源码。
 * @param {string} content 整文件源码
 * @returns {{codeLines:number, commentLines:number, blankLines:number}}
 */
function calculateLineStats(content) {
  const lines = (content || '').split('\n');
  let codeLines = 0;
  let commentLines = 0;
  let blankLines = 0;
  let inBlockComment = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') {
      blankLines++;
      continue;
    }
    // 块注释处理
    if (inBlockComment) {
      commentLines++;
      if (trimmed.includes('*/')) inBlockComment = false;
      continue;
    }
    if (trimmed.includes('/*')) {
      commentLines++;
      if (!trimmed.includes('*/')) inBlockComment = true;
      continue;
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
      commentLines++;
      continue;
    }
    codeLines++;
  }
  return { codeLines, commentLines, blankLines };
}

function estimateSize(content) {
  const charTokens = Math.floor((content?.length || 0) / 4);
  const lineCount = (content || '').split('\n').length;
  return Math.max(charTokens, lineCount);
}

/**
 * 判断一行是否可作为分块的次选边界（函数/类签名起始行）。
 * 启发式：含 `class`/`struct` 定义，或含 `(` 且不以 `;` 结尾（疑似函数头）。
 * @param {string} line
 * @returns {boolean}
 */
function isFunctionSignatureLine(line) {
  const ln = (line || '').trim();
  if (!ln || ln.startsWith('//') || ln.startsWith('*') || ln.startsWith('#')) return false;
  if (/\b(?:class|struct)\b\s+\w+/.test(ln)) return true;
  return ln.includes('(') && !ln.endsWith(';');
}

/**
 * 按"空行边界 + 函数/类签名"切分大文件为带重叠的小块。
 * 单块行数 <= threshold；相邻块重叠 overlap 行（重叠区仅识别不重复报）。
 * @param {string} content 整文件内容
 * @param {number} [threshold]
 * @param {number} [overlap]
 * @returns {Array<{startLine:number,endLine:number,content:string}>}
 */
export function buildChunks(content, threshold = SINGLE_FILE_CHUNK_THRESHOLD, overlap = CHUNK_OVERLAP) {
  const lines = String(content ?? '').split('\n');
  const total = lines.length;
  if (total <= threshold) {
    return [{ startLine: 1, endLine: total, content }];
  }

  const chunks = [];
  let start = 0;
  let guard = 0;
  const maxIter = total + 1;
  while (start < total && guard++ < maxIter) {
    let end = Math.min(start + threshold, total);
    // 不在块尾草率切断：在 [end, end + overlap/2] 内优先找空行边界，其次函数/类签名
    if (end < total) {
      const searchEnd = Math.min(end + Math.floor(overlap / 2), total);
      let cut = -1;
      for (let i = end; i < searchEnd; i++) {
        if (lines[i].trim() === '') { cut = i; break; }
      }
      if (cut === -1) {
        for (let i = end; i < searchEnd; i++) {
          if (isFunctionSignatureLine(lines[i])) { cut = i; break; }
        }
      }
      if (cut !== -1) end = cut;
    }
    chunks.push({
      startLine: start + 1,
      endLine: end,
      content: lines.slice(start, end).join('\n'),
    });
    if (end >= total) break;
    // 下一块从前一块尾部 overlap 行处开始，保证块间重叠
    const next = Math.max(end - overlap, start + 1);
    if (next >= end) break; // 防止死循环
    start = next;
  }
  return chunks;
}

/**
 * 在块内容中猜测"第一个最外层函数/类"名称，用作函数名缺失时的块级兜底。
 * @param {string} content 块内容
 * @returns {string}
 */
function guessChunkFunctionName(content) {
  const lines = (content || '').split('\n');
  for (const raw of lines) {
    const ln = raw.trim();
    if (!ln || ln.startsWith('//') || ln.startsWith('*') || ln.startsWith('#')) continue;
    let m = ln.match(/\b(?:class|struct)\s+(\w+)/);
    if (m) return m[1];
    if (ln.includes('(') && !ln.endsWith(';')) {
      m = ln.match(/([A-Za-z_]\w*)\s*\(/);
      if (m) return m[1];
    }
  }
  return '';
}

/**
 * 带超时的 AI 对话调用（与 codeDetectionService 内联路径一致）。
 * @param {Object} adapter DualModeAIAdapter 实例（含 .adapter.chat）
 * @param {Array} messageHistory
 * @returns {Promise<string>}
 */
async function chatWithTimeout(adapter, messageHistory) {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), CHAT_TIMEOUT);
  try {
    const result = await adapter.adapter.chat(messageHistory, { signal: abortController.signal });
    const content = result?.content || result?.fullText || '';
    const usage = result?.usage || null;
    return { content, usage };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 送审单个分块：拼装上下文 → 调用 AI → 解析缺陷。
 * 🔧 第二阶段（§4.1/§4.4）：支持多次采样（sampleIndex 扰动提示）+ 降级重试（缩上下文）+ 诊断字段。
 * 行号恢复交由 locateChunkDefects 基于整文件定位完成。
 * @returns {Promise<{defects:Array, promptText:string, responseText:string, usage:Object|null, diagnostics:Object}>}
 */
async function detectSingleChunk({ fileInfo, slice, startLine, endLine, systemPrompt, fileContent, headerSkeleton, headerPath, fileStructureSkeleton, currentScope, projectType, sampleIndex = 0, skipSkeleton = false }) {
  const adapter = getCodeReviewAIService();
  if (!adapter || !adapter.adapter || typeof adapter.adapter.chat !== 'function') {
    throw new Error('AI adapter 未初始化或缺少 chat 方法');
  }
  const numbered = withLineNumbers(slice, startLine);
  const extension = (fileInfo.name.split('.').pop() || '').toLowerCase();
  // 🔧 降级重试：去掉骨架（声明/结构/作用域）缩小上下文再试
  const effectiveHeaderSkeleton = skipSkeleton ? '' : headerSkeleton;
  const effectiveStructureSkeleton = skipSkeleton ? '' : fileStructureSkeleton;
  const userMessage = buildChunkUserMessage({
    filePath: fileInfo.path,
    pureName: fileInfo.name,
    slice: numbered,
    startLine,
    endLine,
    totalLines: (fileContent || '').split('\n').length,
    extension,
    headerSkeleton: effectiveHeaderSkeleton,
    headerPath,
    fileStructureSkeleton: effectiveStructureSkeleton,
    currentScope,
    projectType,
    // 🔧 多次采样扰动（与 inline 路径同思路）：第二次采样追加复核提示，降低单次漏报
    sampleHint: sampleIndex > 0 ? '（复核采样：请再仔细检查一遍，尤其留意上次可能遗漏的边界条件、空指针与初始化问题）' : '',
  });
  const messageHistory = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  const diagnostics = { sampleIndex, retryCount: 0, degraded: false, rawResponse: '' };

  const responseContent = await chatWithTimeout(adapter, messageHistory);
  let defects = parseDefectDetectionResults(responseContent.content, fileInfo.path, projectType);
  let chunkUsage = responseContent.usage;
  diagnostics.rawResponse = responseContent.content || '';

  // 重试（与整文件逻辑一致）：疑似确认/寒暄文本时强约束重试一次
  if (defects.length === 0 && isPromptAckOrMetaResponse(responseContent.content)) {
    const retryHistory = [
      ...messageHistory,
      {
        role: 'user',
        content: (projectType === 'ts' || projectType === 'ts_famegame')
          ? '你已拿到完整代码。不要重复规则说明、不要索要代码、不要前言。现在仅返回 JSON 对象（不要返回数组）：{"summary":{"scope":string,"by_category":{},"by_confidence":{}},"issues":[{category,priority,severity,confidence,file,lines,rule,title,description,suggestion,code_snippet,related_design}],"improvements":[],"recheck":[]}。issues 可为空数组。'
          : '你已拿到完整代码。不要重复规则说明、不要索要代码、不要前言。现在仅返回 JSON 数组（可为空数组），字段固定：no, category, file, function, snippet, lines, risk, howToTrigger, suggestedFix, confidence。',
      },
    ];
    try {
      diagnostics.retryCount++;
      const retryResp = await chatWithTimeout(adapter, retryHistory);
      if (retryResp.content) {
        defects = parseDefectDetectionResults(retryResp.content, fileInfo.path, projectType);
        diagnostics.rawResponse = retryResp.content;
      }
      if (retryResp.usage) chunkUsage = retryResp.usage;
    } catch (_e) {
      // 忽略重试错误，沿用空结果
    }
  }

  const promptText = systemPrompt + userMessage;
  return { defects, promptText, responseText: diagnostics.rawResponse, usage: chunkUsage, diagnostics };
}

/**
 * 🔧 第二阶段（§4.1）：单块多次采样 → mergeSamplesByLocation 取并集。
 * 任一采样成功即算成功（并集）；全部失败抛最后错误（上层按失败块处理）。
 * 采样失败不中断其它采样（与 inline 路径 runSingleSample 容错一致）。
 * @returns {Promise<{defects:Array, promptText:string, responseText:string, usage:Object|null, diagnostics:Object}>}
 */
async function detectSingleChunkSampled(params) {
  const cfg = LARGE_FILE_DETECTION_CONFIG;
  const n = (cfg.enableChunkSampling && cfg.sampleCount > 1) ? cfg.sampleCount : 1;
  const results = [];
  let lastError = null;

  for (let s = 0; s < n; s++) {
    try {
      results.push(await detectSingleChunk({ ...params, sampleIndex: s }));
    } catch (e) {
      lastError = e;
    }
  }

  if (results.length === 0) {
    // 🔧 第二阶段（§4.4）：全部采样失败 → 降级重试一次（缩上下文：去骨架）
    if (LARGE_FILE_DETECTION_CONFIG.enableChunkDegradeRetry) {
      try {
        const degraded = await detectSingleChunk({ ...params, sampleIndex: 0, skipSkeleton: true });
        degraded.diagnostics.degraded = true;
        serverLog?.info(`[大文件闸门] 块 L${params.startLine}-${params.endLine} 全部采样失败，降级（去骨架）重试成功`);
        return degraded;
      } catch (degradeErr) {
        lastError = degradeErr;
      }
    }
    throw lastError || new Error('分块送审全部采样失败');
  }

  if (results.length === 1) {
    return results[0];
  }

  // 多采样并集（§4.1：拉齐 inline 路径召回率；重叠区跨采样重复经位置合并去重）
  const allParsed = results.flatMap((r) => r.defects || []);
  const merged = mergeSamplesByLocation(allParsed);
  const firstOk = results.find((r) => r.usage && typeof r.usage.total_tokens === 'number');
  // token/文本聚合：取首个有 usage 的采样 + 拼接响应（供统计与诊断）
  const aggregatedUsage = results.every((r) => r.usage && typeof r.usage.total_tokens === 'number')
    ? {
        prompt_tokens: results.reduce((s, r) => s + (r.usage.prompt_tokens || 0), 0),
        completion_tokens: results.reduce((s, r) => s + (r.usage.completion_tokens || 0), 0),
        total_tokens: results.reduce((s, r) => s + (r.usage.total_tokens || 0), 0),
      }
    : (firstOk ? firstOk.usage : null);
  return {
    defects: merged,
    promptText: results.reduce((s, r) => s + (r.promptText || ''), ''),
    responseText: results.map((r) => r.responseText || '').join('\n---sample---\n'),
    usage: aggregatedUsage,
    diagnostics: {
      sampleIndex: 0,
      sampleCount: results.length,
      retryCount: results.reduce((s, r) => s + (r.diagnostics?.retryCount || 0), 0),
      degraded: false,
      rawResponse: results.map((r) => r.diagnostics?.rawResponse || '').join('\n---sample---\n'),
    },
  };
}

/**
 * 将单块解析出的缺陷基于整文件内容回写真实绝对行号 / 函数名。
 * 优先用 snippet 在整文件定位（最可靠）；失败则用模型行号 / xline 候选回退。
 * @returns {Array}
 */
function locateChunkDefects(defects, fileContent, chunk, fileInfo) {
  if (!defects || defects.length === 0) return [];
  const fallbackFunc = guessChunkFunctionName(chunk.content);
  return defects.map((d) => {
    const updated = { ...d, file: fileInfo.path };
    const hintLine = extractHintLine(d.lines) ?? (d.xline || null);
    const located = locateSnippetInFile(d.snippet, fileContent, null, hintLine, d.function);
    if (located && located.located) {
      updated.lines = located.lines;
      updated._linesSource = 'snippet';
    } else if (d.xline) {
      // 片段定位失败 → 用模型给出的 xline 候选行号回退
      updated.lines = `L${d.xline}`;
      updated._linesSource = 'xline';
    }
    if (!updated.function || updated.function.trim() === '') {
      updated.function = d.xfunc || fallbackFunc;
    }
    // 🔧 snippet 自校验回填：与 lines 区域对不上时用源文件真实代码替换（防"样板行 snippet"）
    return repairSnippetFromLines(updated, fileContent, null);
  });
}

/**
 * 大文件分块送审主入口。
 * @param {Object} params
 * @param {Object} params.fileInfo 文件信息（name/path/lineCount）
 * @param {Object} params.directoryHandle 目录句柄（供后续扩展，当前切片已基于内存内容）
 * @param {string} params.fileContent 整文件内容（已读取，避免重复读盘）
 * @param {string} params.projectType 项目类型
 * @param {{content: string, path: string}} [params.headerRef] 反向配对到的头文件（仅用于抽取声明骨架，
 *        帮助模型判断成员真实类型；不参与检测、不参与行号定位）
 * @param {{summary:string, ranges:Array, lines:Array}} [params.fileStructure] 当前被分块文件自身的结构骨架（方案 4）。
 *        超大 .h 自身分块时由调用方预生成后传入，使模型感知"当前块位于哪个类/命名空间"。
 * @returns {Promise<{defects:Array,coverage:Object,manifest:Array,mode:string}>}
 */
export async function detectLargeFileDefects({ fileInfo, fileContent, projectType, headerRef, fileStructure, onChunkDone, startFromChunk = 0, skipChunks, priorDefects = [], model }) {
  const serverLog = getServerLog();
  const cfg = LARGE_FILE_DETECTION_CONFIG;
  const detectionStartTime = Date.now();
  const totalLines = (fileContent || '').split('\n').length;
  // 🔧 第二阶段（§4.2）：整文件内容哈希（断点指纹升级 + 第三阶段缓存键）
  const originalHash = computeContentHash(fileContent);
  // 🔧 第三阶段：缓存/增量/调度统一统计
  const cacheInfo = { cacheHits: 0, rerunChunks: [], skippedByResume: 0 };
  const coverage = {
    mode: 'chunk',
    totalChunks: 0,
    successChunks: 0,
    failedChunks: 0,
    coveredLines: 0,
    totalLines,
    coverageRate: 0, // 🔧 第二阶段（§4.3）
    fullyCovered: true,
    failedReasons: [],
    chunks: [],
  };

  try {
    const systemPrompt = await buildChunkSystemPrompt(projectType);

    // 头文件「声明骨架」：**一次性**提取后供所有分块复用，避免 O(块数 × 头文件体积) 的重复解析。
    // 提取失败/无配对头文件时静默降级为无骨架，不影响分块主流程。
    let headerSkeleton = '';
    let headerPath = '';
    const isTsChunk = projectType === 'ts' || projectType === 'ts_famegame';
    if (headerRef && headerRef.content && !isTsChunk) {
      try {
        const { extractHeaderSkeleton } = await import('../context/headerSkeletonExtractor.js');
        headerSkeleton = extractHeaderSkeleton(headerRef.content) || '';
        headerPath = headerRef.path || '';
        if (headerSkeleton) {
          serverLog?.info(`[大文件闸门] 已注入头文件声明骨架 ${headerPath}，${headerSkeleton.length} 字符（原头文件 ${headerRef.content.length} 字符）`);
        } else {
          serverLog?.info(`[大文件闸门] 头文件 ${headerPath} 未提取到有效声明骨架，按无骨架检测`);
        }
      } catch (skErr) {
        headerSkeleton = '';
        headerPath = '';
        serverLog?.warn(`[大文件闸门] 头文件声明骨架提取失败，按无骨架检测: ${skErr?.message || skErr}`);
      }
    } else {
      serverLog?.info(`[大文件闸门] ${fileInfo.name} 无配对头文件，按无骨架检测`);
    }

    const chunkThreshold = (projectType === 'ts' || projectType === 'ts_famegame') ? 350 : SINGLE_FILE_CHUNK_THRESHOLD;
    const chunks = buildChunks(fileContent, chunkThreshold);
    // 🔧 第二阶段（§4.2）：chunk 标识（chunkId / splitStrategy / chunkHash）
    // 🔧 第三阶段（§3.3）：riskWeight（调度顺序用，不影响分块与结果）
    const annotated = chunks.map((c, idx) => ({
      ...c,
      chunkId: `part${String(idx + 1).padStart(2, '0')}`,
      splitStrategy: fileStructure ? 'structure-skeleton' : 'structure-window',
      chunkHash: computeChunkHash(c),
      riskWeight: estimateChunkRisk(c),
    }));
    coverage.totalChunks = annotated.length;
    serverLog?.info(`[大文件闸门] ${fileInfo.name} 切分为 ${annotated.length} 块（阈值 ${chunkThreshold}，重叠 ${CHUNK_OVERLAP}）`);

    // 方案 4：若调用方传入了当前文件自身的结构骨架，则为每个块算出「当前所属作用域」。
    const structureSummary = fileStructure && fileStructure.summary ? fileStructure.summary : '';
    const lineScopes = fileStructure && Array.isArray(fileStructure.lines) ? fileStructure.lines : null;

    const allDefects = [];
    let aggregatedPrompt = '';
    let aggregatedResponse = '';
    const chunkUsages = [];

    // 🔧 skipChunks（§12.2 前置改造）：完成块**集合**（乱序安全）替代前缀起点——
    //   为第三阶段风险热点优先级调度（乱序送审）铺地基；按序执行时集合恒为前缀，行为与旧版一致。
    //   startFromChunk 保留作前缀兼容（内部并入同一集合）。
    const skipSet = new Set();
    if (Array.isArray(skipChunks)) {
      for (const k of skipChunks) {
        if (Number.isInteger(k) && k >= 0 && k < chunks.length) skipSet.add(k);
      }
    }
    if (startFromChunk > 0) {
      const prefixEnd = Math.min(startFromChunk, chunks.length);
      for (let k = 0; k < prefixEnd; k++) skipSet.add(k);
    }

    if (skipSet.size > 0) {
      const skipped = [...skipSet].sort((a, b) => a - b);
      for (const k of skipped) {
        const ch = annotated[k];
        coverage.successChunks++;
        coverage.coveredLines += (ch.endLine - ch.startLine + 1);
        coverage.chunks.push({ chunkId: ch.chunkId, startLine: ch.startLine, endLine: ch.endLine, splitStrategy: ch.splitStrategy, chunkHash: ch.chunkHash, covered: true, resumed: true, defects: 0 });
      }
      cacheInfo.skippedByResume = skipped.length;
      serverLog?.info(
        `[大文件闸门·续跑] ${fileInfo.name} 跳过已完成块 ${skipped.length}/${annotated.length}（集合语义：${skipped.join(',')}），含先验缺陷 ${(Array.isArray(priorDefects) ? priorDefects.length : 0)} 个`
      );
      if (Array.isArray(priorDefects) && priorDefects.length > 0) {
        allDefects.push(...priorDefects);
      }
    }

    // 🔧 第三阶段（§3.4 + §12.2）：调度顺序——风险权重降序（高风险先审）。
    //   乱序送审已被 doneSet 集合语义安全支持（断点不漏块）；关闭 enableRiskPriority 则维持原序。
    //   覆盖统计/coverage.chunks 仍按块号原序 push（结果视角与文件结构一致），仅执行顺序受调度影响。
    const pendingIndices = [];
    for (let i = 0; i < annotated.length; i++) {
      if (!skipSet.has(i)) pendingIndices.push(i);
    }
    const schedule = cfg.enableRiskPriority
      ? [...pendingIndices].sort((a, b) => (annotated[b].riskWeight || 1) - (annotated[a].riskWeight || 1))
      : pendingIndices;
    if (cfg.enableRiskPriority && schedule.length > 1) {
      serverLog?.info(`[大文件闸门·调度] ${fileInfo.name} 风险优先级执行序（前 5）：${schedule.slice(0, 5).map((i) => `#${i + 1}(w${annotated[i].riskWeight || 1})`).join(' → ')}`);
    }

    for (const i of schedule) {
      const ch = annotated[i];
      const currentScope = lineScopes ? locateScopeForChunk(lineScopes, ch.startLine, ch.endLine) : '';
      serverLog?.info(`[大文件闸门] 处理块 ${i + 1}/${annotated.length}：行 ${ch.startLine}-${ch.endLine}（风险 w${ch.riskWeight || 1}）${currentScope ? `（位于 ${currentScope}）` : ''}`);
      try {
        // 🔧 第三阶段（§3.4）：先查缓存（内容寻址，跨会话）——命中直接复用，跳过送审
        if (cfg.enableChunkCache) {
          const hit = await chunkCacheGetChunk({ originalHash, chunkHash: ch.chunkHash, model, promptVersion: cfg.promptVersion });
          if (hit) {
            const located = hit.defects || [];
            allDefects.push(...located);
            if (hit.tokenUsage) chunkUsages.push(hit.tokenUsage);
            coverage.successChunks++;
            coverage.coveredLines += (ch.endLine - ch.startLine + 1);
            coverage.chunks.push({
              chunkId: ch.chunkId, startLine: ch.startLine, endLine: ch.endLine,
              splitStrategy: ch.splitStrategy, chunkHash: ch.chunkHash,
              covered: true, cacheHit: true, defects: located.length,
            });
            cacheInfo.cacheHits++;
            serverLog?.info(`[大文件闸门·缓存] 块 ${i + 1} 命中缓存（${located.length} 缺陷），跳过送审`);
            // 断点语义：缓存命中 = 该块"已完成"，同样进完成集合（中断恢复时不重跑）
            if (typeof onChunkDone === 'function') {
              try {
                onChunkDone(i, located, annotated.length);
              } catch (cbErr) {
                serverLog?.warn(`[大文件闸门] 块 ${i + 1} onChunkDone 回调失败（不影响检测）: ${cbErr?.message || cbErr}`);
              }
            }
            continue;
          }
        }

        cacheInfo.rerunChunks.push(ch.chunkId);

        // 🔧 第二阶段（§4.1）：多次采样取并集（enableChunkSampling=false 时退化为单次）
        const chunkResult = await detectSingleChunkSampled({
          fileInfo,
          slice: ch.content,
          startLine: ch.startLine,
          endLine: ch.endLine,
          systemPrompt,
          fileContent,
          headerSkeleton,
          headerPath,
          fileStructureSkeleton: structureSummary,
          currentScope,
          projectType,
        });
        const located = locateChunkDefects(chunkResult.defects, fileContent, ch, fileInfo);
        allDefects.push(...located);
        aggregatedPrompt += chunkResult.promptText || '';
        aggregatedResponse += chunkResult.responseText || '';
        // 规整推送（含 null），与后续 allHaveUsage 判断配合：任一块缺 usage 则整文件走估算
        chunkUsages.push(chunkResult.usage || null);
        coverage.successChunks++;
        coverage.coveredLines += (ch.endLine - ch.startLine + 1);
        // 🔧 第二阶段（§4.2/§4.3）：块级标识 + 诊断字段
        coverage.chunks.push({
          chunkId: ch.chunkId,
          startLine: ch.startLine,
          endLine: ch.endLine,
          splitStrategy: ch.splitStrategy,
          chunkHash: ch.chunkHash,
          covered: true,
          defects: located.length,
          sampleCount: chunkResult.diagnostics?.sampleCount || 1,
          retryCount: chunkResult.diagnostics?.retryCount || 0,
          degraded: chunkResult.diagnostics?.degraded || false,
        });

        // 🔧 第三阶段（§3.4）：写缓存（内容寻址；写失败不阻断）
        if (cfg.enableChunkCache) {
          try {
            await chunkCacheSetChunk({ originalHash, chunkHash: ch.chunkHash, model, promptVersion: cfg.promptVersion },
              { defects: located, tokenUsage: chunkResult.usage || null, rawResponse: chunkResult.diagnostics?.rawResponse || '' });
          } catch (cacheErr) {
            serverLog?.warn(`[大文件闸门·缓存] 块 ${i + 1} 写入失败（不影响检测）: ${cacheErr?.message || cacheErr}`);
          }
        }

        // 🔧 断点续检（块级进度提交点）：每块成功即回调，调用方落盘 chunkProgress + chunkResults；
        // 回调异常不阻断分块主流程（损失该块断点，不损失检测结果）
        if (typeof onChunkDone === 'function') {
          try {
            onChunkDone(i, located, annotated.length);
          } catch (cbErr) {
            serverLog?.warn(`[大文件闸门] 块 ${i + 1} onChunkDone 回调失败（不影响检测）: ${cbErr?.message || cbErr}`);
          }
        }
      } catch (chunkErr) {
        coverage.failedChunks++;
        coverage.fullyCovered = false;
        const reason = `块${i + 1}(L${ch.startLine}-${ch.endLine}): ${chunkErr?.message || chunkErr}`;
        coverage.failedReasons.push(reason);
        // 🔧 第二阶段（§4.3）：失败块显式展示标识 + 保留最后原始响应（可排查模型问题）
        coverage.chunks.push({
          chunkId: ch.chunkId,
          startLine: ch.startLine,
          endLine: ch.endLine,
          splitStrategy: ch.splitStrategy,
          chunkHash: ch.chunkHash,
          covered: false,
          error: reason,
          rawResponse: chunkErr?.rawResponse || null,
        });
        serverLog?.error(`[大文件闸门] 块 ${i + 1}/${annotated.length} 处理失败: ${fileInfo.name}`, chunkErr);
      }
    }

    // 跨块去重（重叠区可能重复报）
    const merged = deduplicateDefects(allDefects);
    if (merged.length < allDefects.length) {
      serverLog?.info(`[大文件闸门] ${fileInfo.name} 跨块去重移除 ${allDefects.length - merged.length} 个重复缺陷`);
    }

    // 🔧 记录 token 统计（大文件分块路径此前漏记，导致 token_statistics.xlsx 全 0）
    try {
      // 基于整文件内容统计真实代码行/注释行（此前硬编码为 0，导致报表代码行、注释行全 0）
      const { codeLines, commentLines } = calculateLineStats(fileContent);
      const lineStats = { totalLines, codeLines, commentLines };
      // 仅当所有成功块都有 usage 时才用真实数据，否则传 null 走估算（与内联路径一致）
      const allHaveUsage = chunkUsages.length > 0 &&
        chunkUsages.length === coverage.successChunks &&
        chunkUsages.every(u => u && typeof u.total_tokens === 'number');
      const aggregatedUsage = allHaveUsage ? {
        prompt_tokens: chunkUsages.reduce((s, u) => s + (u.prompt_tokens || 0), 0),
        completion_tokens: chunkUsages.reduce((s, u) => s + (u.completion_tokens || 0), 0),
        total_tokens: chunkUsages.reduce((s, u) => s + (u.total_tokens || 0), 0),
      } : null;
      const pathParts = (fileInfo.path || '').split('/').filter(p => p && p !== '.');
      const moduleName = pathParts.length <= 1 ? 'root' : pathParts[0];
      tokenStatisticsService.recordFileTokens(
        fileInfo.name,
        fileInfo.path,
        aggregatedUsage,
        aggregatedPrompt,
        aggregatedResponse,
        moduleName,
        Date.now() - detectionStartTime,
        lineStats
      );
      serverLog?.info(`[大文件闸门] ${fileInfo.name} 已记录 token 统计（${annotated.length} 块聚合，${allHaveUsage ? '真实usage' : '估算'}）`);
    } catch (tokenErr) {
      serverLog?.error(`[大文件闸门] ${fileInfo.name} 记录 token 统计失败:`, tokenErr);
    }

    // 🔧 第二阶段（§4.3）：覆盖率
    coverage.coverageRate = coverage.totalLines > 0
      ? +(coverage.coveredLines / coverage.totalLines).toFixed(4)
      : 0;

    return {
      defects: merged,
      coverage,
      manifest: coverage.chunks,
      mode: 'chunk',
      // 🔧 第二阶段（§4.2）：hash 基建（断点指纹升级 + 第三阶段缓存键依赖）
      originalHash,
      promptVersion: LARGE_FILE_DETECTION_CONFIG.promptVersion,
      // 🔧 第三阶段（§3.5）：缓存/调度诊断（cacheHits 含断点跳过数；rerunChunks 为实际送审块）
      cacheInfo: {
        cacheHits: cacheInfo.cacheHits,
        skippedByResume: cacheInfo.skippedByResume,
        rerunChunks: cacheInfo.rerunChunks,
      },
    };
  } catch (err) {
    coverage.fullyCovered = false;
    serverLog?.error(`[大文件闸门] ${fileInfo.name} 分块送审整体异常，建议回退 inline:`, err);
    throw err; // 交由上层 gate 捕获并回退到整文件流程
  }
}

/**
 * 方案 5 主入口：超大「头文件 + 配对实现文件」的协同分块检测。
 *
 * 决策逻辑（在 codeDetectionService 的大文件闸门内调用前已由 estimateSize 判断）：
 * - 若 `头 est + 实现 est <= CHUNK_THRESHOLD * 2`，调用方应继续走原 inline 合并路径（本函数不处理）。
 * - 若总量超限：头本体按方案 4 自身分块（注入头结构骨架）；实现文件按分块检测，
 *   每块注入「头声明骨架（declaration skeleton，用于类型判断）」。两端缺陷合并去重后返回。
 *
 * ⚠️ 本函数**绝不**把头与实现合并成单一超大 prompt，而是分别分块，确保上下文不撑爆。
 *
 * @param {Object} params
 * @param {Object} params.headerFileInfo 头文件信息（name/path）
 * @param {string} params.headerContent 头文件全文
 * @param {Object} params.implFileInfo 实现文件信息（name/path）
 * @param {string} params.implContent 实现文件全文
 * @param {string} params.projectType 项目类型
 * @param {Object} [params.chunkResume] 块级断点续检参数（可选）：{ onChunkDone, startFromChunk, priorDefects }。
 *        方案 5 把「头块序列 + 实现块序列」拼成全局块序列（头块 g=0..M-1，实现块 g=M..M+J-1），
 *        断点键挂在入口 .h 路径上，与单文件分块路径共用 orchestrator 的通用断点机制。
 * @returns {Promise<{defects:Array,coverage:Object,manifest:Array,mode:string}>}
 */
export async function detectLargeHeaderWithImpl({ headerFileInfo, headerContent, implFileInfo, implContent, projectType, chunkResume, model }) {
  const serverLog = getServerLog();

  const headerLines = (headerContent || '').split('\n').length;
  const implLines = (implContent || '').split('\n').length;

  const merged = [];
  const subCoverages = [];

  // 🔧 块级断点续检（方案 5，§12.2 集合语义）：全局块序列 = 头块(0..M-1) + 实现块(M..M+J-1)。
  //   M/J 由内容确定性推出（buildChunks 纯函数），恢复时与首跑一致；
  //   globalSkip 为**完成块集合**（乱序安全）；startFromChunk 前缀兼容并入同一集合。
  //   ⚠️ 已知局限 ①指纹校验只覆盖入口 .h（mtime/size）；若断点期间仅 .cpp 被改而 .h 未动，
  //   实现块的先验缺陷可能过期。②priorDefects 为扁平数组（无块归属）：按序执行时 doneSet 恒为
  //   前缀、归属无歧义；第三阶段启用乱序调度后需改用 perChunk 精确提取（resumeStore 已预留）。
  const plan5Threshold = SINGLE_FILE_CHUNK_THRESHOLD; // 方案 5 仅 C++（.h 入口），无需 ts 分支
  const M = Math.max(0, buildChunks(headerContent || '', plan5Threshold).length);
  const J = Math.max(0, buildChunks(implContent || '', plan5Threshold).length);

  const globalSkip = new Set();
  if (chunkResume && Array.isArray(chunkResume.skipChunks)) {
    for (const g of chunkResume.skipChunks) {
      if (Number.isInteger(g) && g >= 0 && g < M + J) globalSkip.add(g);
    }
  }
  const startG = chunkResume ? Math.max(0, Math.min(chunkResume.startFromChunk || 0, M + J)) : 0;
  if (startG > 0) {
    for (let k = 0; k < startG; k++) globalSkip.add(k);
  }
  const priorAll = Array.isArray(chunkResume?.priorDefects) ? chunkResume.priorDefects : [];

  // 头序列/实现序列各自的完成集合（全局序号 → 局部序号）
  const headerSkip = [...globalSkip].filter((g) => g < M);
  const implSkip = [...globalSkip].filter((g) => g >= M).map((g) => g - M);

  if (globalSkip.size > 0) {
    serverLog?.info(
      `[方案5·续跑] ${headerFileInfo.name} 完成块 ${globalSkip.size}/${M + J}（集合语义；头 ${headerSkip.length}/${M}，实现 ${implSkip.length}/${J}），含先验缺陷 ${priorAll.length} 个`
    );
  }

  // 头阶段 onChunkDone：头块全局序号 = 自身序号 i
  const headerOnChunkDone = chunkResume?.onChunkDone
    ? (i, d) => chunkResume.onChunkDone(i, d, M + J)
    : undefined;
  // 实现阶段 onChunkDone：实现块全局序号 = M + i
  const implOnChunkDone = chunkResume?.onChunkDone
    ? (i, d) => chunkResume.onChunkDone(M + i, d, M + J)
    : undefined;

  try {
    if (headerSkip.length >= M && M > 0) {
      // —— 头阶段已全部完成 → 跳过（零重跑），先验缺陷直接汇入合并 ——
      serverLog?.info(`[方案5·续跑] 头 ${headerFileInfo.name} 已完成 ${M} 块，跳过头阶段；实现阶段剩余 ${J - implSkip.length}/${J} 块`);
      merged.push(...priorAll);
      subCoverages.push({
        role: 'header', mode: 'chunk', resumed: true,
        totalChunks: M, successChunks: M, failedChunks: 0,
        coveredLines: headerLines, totalLines: headerLines,
        fullyCovered: true, failedReasons: [], chunks: [],
      });
    } else {
      // —— 头本体：方案 4（自身分块 + 结构骨架）；按集合跳过已完成头块 ——
      const headerStructure = buildFileStructureSkeleton(headerContent);
      const headerResult = await detectLargeFileDefects({
        fileInfo: headerFileInfo,
        fileContent: headerContent,
        projectType,
        // 头自身检测时，不再额外反向配对（已是头），仅注入自身结构骨架
        fileStructure: headerStructure,
        onChunkDone: headerOnChunkDone,
        skipChunks: headerSkip,
        // 先验缺陷（全部）经头阶段汇入最终合并；按序执行时已完成块必属头序列（集合无歧义）
        priorDefects: priorAll,
        model,
      });
      if (headerResult && headerResult.defects) merged.push(...headerResult.defects);
      if (headerResult && headerResult.coverage) subCoverages.push({ role: 'header', ...headerResult.coverage });
      serverLog?.info(`[方案5] 头 ${headerFileInfo.name} 分块完成，缺陷 ${headerResult?.defects?.length || 0}`);
    }

    // —— 实现文件：分块 + 注入头「声明骨架」（declaration skeleton，用于类型判断）——
    let headerSkeleton = '';
    let headerPath = '';
    try {
      const { extractHeaderSkeleton } = await import('../context/headerSkeletonExtractor.js');
      headerSkeleton = extractHeaderSkeleton(headerContent) || '';
      headerPath = headerFileInfo.path || '';
    } catch (_e) {
      headerSkeleton = '';
    }
    const implResult = await detectLargeFileDefects({
      fileInfo: implFileInfo,
      fileContent: implContent,
      projectType,
      headerRef: { content: headerContent, path: headerPath },
      headerSkeleton,
      headerPath,
      onChunkDone: implOnChunkDone,
      // 实现块按集合跳过已完成块（局部序号 = 全局序号 - M）；全新运行时集合为空，整文件分块检测
      skipChunks: implSkip,
      // 先验缺陷已在上方汇入 merged（头阶段续跑分支或跳过分支），此处不重复传
      priorDefects: [],
      model,
    });
    if (implResult && implResult.defects) merged.push(...implResult.defects);
    if (implResult && implResult.coverage) subCoverages.push({ role: 'impl', ...implResult.coverage });
    serverLog?.info(`[方案5] 实现 ${implFileInfo.name} 分块完成，缺陷 ${implResult?.defects?.length || 0}`);

    const finalDefects = deduplicateDefects(merged);
    if (finalDefects.length < merged.length) {
      serverLog?.info(`[方案5] 跨(头/实现)去重移除 ${merged.length - finalDefects.length} 个重复缺陷`);
    }

    const coverage = {
      mode: 'header+impl-split',
      totalChunks: subCoverages.reduce((s, c) => s + (c.totalChunks || 0), 0),
      successChunks: subCoverages.reduce((s, c) => s + (c.successChunks || 0), 0),
      failedChunks: subCoverages.reduce((s, c) => s + (c.failedChunks || 0), 0),
      coveredLines: subCoverages.reduce((s, c) => s + (c.coveredLines || 0), 0),
      totalLines: headerLines + implLines,
      fullyCovered: subCoverages.every(c => c.fullyCovered !== false),
      failedReasons: subCoverages.flatMap(c => c.failedReasons || []),
      chunks: subCoverages.flatMap(c => (c.chunks || []).map(k => ({ ...k, role: c.role }))),
    };

    return { defects: finalDefects, coverage, manifest: coverage.chunks, mode: 'header+impl-split' };
  } catch (err) {
    serverLog?.error(`[方案5] 头+实现分块检测异常:`, err);
    throw err;
  }
}

export { estimateSize };

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
  withLineNumbers,
  isPromptAckOrMetaResponse,
} from './codeDetectionService.js';
import { buildChunkSystemPrompt, buildChunkUserMessage } from '../context/chunkContextBuilder.js';
import { buildFileStructureSkeleton, locateScopeForChunk } from '../context/headerSkeletonExtractor.js';
import tokenStatisticsService from './tokenStatisticsService.js';

/** 单文件进入分块送审的规模阈值（行/token） */
export const SINGLE_FILE_CHUNK_THRESHOLD = 700;
/** 相邻分块之间的重叠行数（重叠区仅识别不重复报，过大将显著拖慢本地模型） */
export const CHUNK_OVERLAP = 150;
/** 单块内容字符上限兜底（避免极端长行导致单块token爆炸） */
export const MAX_CHUNK_CHARS = 120000;
/** 单块 AI 调用超时（ms） */
const CHAT_TIMEOUT = 300000;

/**
 * 估算文件规模：token 近似（字符/4）与行数取较大者。
 * @param {string} content
 * @returns {number}
 */
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
 * 行号恢复交由 locateChunkDefects 基于整文件定位完成。
 * @returns {Promise<Array>}
 */
async function detectSingleChunk({ fileInfo, slice, startLine, endLine, systemPrompt, fileContent, headerSkeleton, headerPath, fileStructureSkeleton, currentScope }) {
  const adapter = getCodeReviewAIService();
  if (!adapter || !adapter.adapter || typeof adapter.adapter.chat !== 'function') {
    throw new Error('AI adapter 未初始化或缺少 chat 方法');
  }
  const numbered = withLineNumbers(slice, startLine);
  const extension = (fileInfo.name.split('.').pop() || '').toLowerCase();
  const userMessage = buildChunkUserMessage({
    filePath: fileInfo.path,
    pureName: fileInfo.name,
    slice: numbered,
    startLine,
    endLine,
    totalLines: (fileContent || '').split('\n').length,
    extension,
    headerSkeleton,
    headerPath,
    fileStructureSkeleton,
    currentScope,
  });
  const messageHistory = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  const responseContent = await chatWithTimeout(adapter, messageHistory);
  let defects = parseDefectDetectionResults(responseContent.content, fileInfo.path);
  let chunkUsage = responseContent.usage;

  // 重试（与整文件逻辑一致）：疑似确认/寒暄文本时强约束重试一次
  if (defects.length === 0 && isPromptAckOrMetaResponse(responseContent.content)) {
    const retryHistory = [
      ...messageHistory,
      {
        role: 'user',
        content: '你已拿到完整代码。不要重复规则说明、不要索要代码、不要前言。现在仅返回 JSON 数组（可为空数组），字段固定：no, category, file, function, snippet, lines, risk, howToTrigger, suggestedFix, confidence。',
      },
    ];
    try {
      const retryResp = await chatWithTimeout(adapter, retryHistory);
      if (retryResp.content) defects = parseDefectDetectionResults(retryResp.content, fileInfo.path);
      if (retryResp.usage) chunkUsage = retryResp.usage;
    } catch (_e) {
      // 忽略重试错误，沿用空结果
    }
  }
  const promptText = systemPrompt + userMessage;
  return { defects, promptText, responseText: responseContent.content, usage: chunkUsage };
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
    return updated;
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
export async function detectLargeFileDefects({ fileInfo, fileContent, projectType, headerRef, fileStructure }) {
  const serverLog = getServerLog();
  const detectionStartTime = Date.now();
  const totalLines = (fileContent || '').split('\n').length;
  const coverage = {
    mode: 'chunk',
    totalChunks: 0,
    successChunks: 0,
    failedChunks: 0,
    coveredLines: 0,
    totalLines,
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
    if (headerRef && headerRef.content) {
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

    const chunks = buildChunks(fileContent);
    coverage.totalChunks = chunks.length;
    serverLog?.info(`[大文件闸门] ${fileInfo.name} 切分为 ${chunks.length} 块（阈值 ${SINGLE_FILE_CHUNK_THRESHOLD}，重叠 ${CHUNK_OVERLAP}）`);

    // 方案 4：若调用方传入了当前文件自身的结构骨架，则为每个块算出「当前所属作用域」。
    const structureSummary = fileStructure && fileStructure.summary ? fileStructure.summary : '';
    const lineScopes = fileStructure && Array.isArray(fileStructure.lines) ? fileStructure.lines : null;

    const allDefects = [];
    let aggregatedPrompt = '';
    let aggregatedResponse = '';
    const chunkUsages = [];
    for (let i = 0; i < chunks.length; i++) {
      const ch = chunks[i];
      const currentScope = lineScopes ? locateScopeForChunk(lineScopes, ch.startLine, ch.endLine) : '';
      serverLog?.info(`[大文件闸门] 处理块 ${i + 1}/${chunks.length}：行 ${ch.startLine}-${ch.endLine}${currentScope ? `（位于 ${currentScope}）` : ''}`);
      try {
        const chunkResult = await detectSingleChunk({
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
        });
        const located = locateChunkDefects(chunkResult.defects, fileContent, ch, fileInfo);
        allDefects.push(...located);
        aggregatedPrompt += chunkResult.promptText || '';
        aggregatedResponse += chunkResult.responseText || '';
        if (chunkResult.usage) chunkUsages.push(chunkResult.usage);
        coverage.successChunks++;
        coverage.coveredLines += (ch.endLine - ch.startLine + 1);
        coverage.chunks.push({ startLine: ch.startLine, endLine: ch.endLine, covered: true, defects: located.length });
      } catch (chunkErr) {
        coverage.failedChunks++;
        coverage.fullyCovered = false;
        const reason = `块${i + 1}(L${ch.startLine}-${ch.endLine}): ${chunkErr?.message || chunkErr}`;
        coverage.failedReasons.push(reason);
        coverage.chunks.push({ startLine: ch.startLine, endLine: ch.endLine, covered: false, error: reason });
        serverLog?.error(`[大文件闸门] 块 ${i + 1}/${chunks.length} 处理失败: ${fileInfo.name}`, chunkErr);
      }
    }

    // 跨块去重（重叠区可能重复报）
    const merged = deduplicateDefects(allDefects);
    if (merged.length < allDefects.length) {
      serverLog?.info(`[大文件闸门] ${fileInfo.name} 跨块去重移除 ${allDefects.length - merged.length} 个重复缺陷`);
    }

    // 🔧 记录 token 统计（大文件分块路径此前漏记，导致 token_statistics.xlsx 全 0）
    try {
      const lineStats = { totalLines, codeLines: 0, commentLines: 0 };
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
      serverLog?.info(`[大文件闸门] ${fileInfo.name} 已记录 token 统计（${chunks.length} 块聚合，${allHaveUsage ? '真实usage' : '估算'}）`);
    } catch (tokenErr) {
      serverLog?.error(`[大文件闸门] ${fileInfo.name} 记录 token 统计失败:`, tokenErr);
    }

    return { defects: merged, coverage, manifest: coverage.chunks, mode: 'chunk' };
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
 * @returns {Promise<{defects:Array,coverage:Object,manifest:Array,mode:string}>}
 */
export async function detectLargeHeaderWithImpl({ headerFileInfo, headerContent, implFileInfo, implContent, projectType }) {
  const serverLog = getServerLog();

  const headerLines = (headerContent || '').split('\n').length;
  const implLines = (implContent || '').split('\n').length;

  const merged = [];
  const subCoverages = [];

  try {
    // —— 头本体：方案 4（自身分块 + 结构骨架）——
    const headerStructure = buildFileStructureSkeleton(headerContent);
    const headerResult = await detectLargeFileDefects({
      fileInfo: headerFileInfo,
      fileContent: headerContent,
      projectType,
      // 头自身检测时，不再额外反向配对（已是头），仅注入自身结构骨架
      fileStructure: headerStructure,
    });
    if (headerResult && headerResult.defects) merged.push(...headerResult.defects);
    if (headerResult && headerResult.coverage) subCoverages.push({ role: 'header', ...headerResult.coverage });
    serverLog?.info(`[方案5] 头 ${headerFileInfo.name} 分块完成，缺陷 ${headerResult?.defects?.length || 0}`);

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

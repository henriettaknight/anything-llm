/**
 * @fileoverview Code Review Service
 * Orchestrates code analysis workflow and interfaces with AI providers
 */

import { getFileContent } from './fileMonitorService.js';
import { createAIAdapter } from '../utils/aiAdapter.js';
import {
  formatDetectionPrompt,
  parseDetectionResults,
  validateDetectionResults,
  retryDetection,
  cleanAIResponse,
  extractTableFromResponse,
} from '../utils/promptFormatter.js';
import { detectUserLanguage } from '../utils/languageDetector.js';
import tokenStatisticsService from './tokenStatisticsService.js';

/**
 * @typedef {Object} DefectDetectionResult
 * @property {string} category - Defect category
 * @property {string} file - File path
 * @property {string} function - Function/symbol name
 * @property {string} snippet - Code snippet
 * @property {string} lines - Line numbers
 * @property {string} risk - Risk description
 * @property {string} howToTrigger - How to trigger the defect
 * @property {string} suggestedFix - Suggested fix
 * @property {string} confidence - Confidence level
 */

/**
 * @typedef {Object} CodeDetectionReport
 * @property {string} id - Report ID
 * @property {number} timestamp - Timestamp
 * @property {number} filesScanned - Number of files scanned
 * @property {number} defectsFound - Number of defects found
 * @property {DefectDetectionResult[]} defects - List of defects
 * @property {Object} summary - Summary statistics
 * @property {number} summary.auto - AUTO category count
 * @property {number} summary.array - ARRAY category count
 * @property {number} summary.memf - MEMF category count
 * @property {number} summary.leak - LEAK category count
 * @property {number} summary.osres - OSRES category count
 * @property {number} summary.stl - STL category count
 * @property {number} summary.depr - DEPR category count
 * @property {number} summary.perf - PERF category count
 * @property {number} summary.class - CLASS category count
 * @property {number} summary.compile - COMPILE category count
 * @property {number} summary.security - SECURITY category count (网络协议索引约束)
 * @property {number} summary.seq - SEQ category count (动作/事件时序顺序)
 * @property {number} summary.initord - INITORD category count (跨实体初始化时序)
 */

/**
 * @typedef {CodeDetectionReport & {groupName: string, groupPath: string}} GroupDetectionReport
 */

/**
 * 给代码文本注入绝对行号前缀，每行前置 `L{行号}: `。
 * 让模型直接读到真实绝对行号，从源头消灭"靠数数计数导致的行号漂移"。
 * 行号从 startLine 开始，以原始文件文本计（与 locateSnippetInFile 的 fileContent 一致）。
 * 大文件分块送审时，逐块用真实绝对起始行号注入，使块内行号与原始文件对齐。
 * @param {string} raw 原始代码（不含行号前缀）
 * @param {number} [startLine=1] 起始绝对行号（块模式传块在原始文件中的起始行）
 * @returns {string} 带行号前缀的代码
 */
export function withLineNumbers(raw, startLine = 1) {
  const lines = String(raw ?? "").split("\n");
  return lines.map((line, i) => `L${startLine + i}: ${line}`).join("\n");
}

// Placeholder for AI service - will be replaced with actual implementation
let codeReviewAIService = null;
let serverLog = null;

/**
 * Initialize AI service and server log
 * This should be called before using the detection service
 * @param {Object} aiService - AI service instance
 * @param {Object} logService - Server log service instance
 */
export const initializeServices = (aiService, logService) => {
  codeReviewAIService = aiService;
  serverLog = logService;
};

/**
 * 获取已初始化的代码审查 AI 服务实例（DualModeAIAdapter）。
 * 供大文件分块送审服务复用同一 adapter，避免重复创建。
 * @returns {Object|null}
 */
export function getCodeReviewAIService() {
  return codeReviewAIService;
}

/**
 * 获取已初始化的服务端日志实例。
 * 供大文件分块送审服务输出分块/覆盖率日志。
 * @returns {Object|null}
 */
export function getServerLog() {
  return serverLog;
}

/**
 * Get UE static defect detection system prompt
 * @param {string} projectType - Project type ('ue_cpp' or 'ue_blueprint')
 * @returns {Promise<string>} - System prompt
 */
export async function getUEDefectDetectionPrompt(projectType) {
  // Validate projectType
  if (!projectType || !['ue_cpp', 'ue_blueprint', 'cpp'].includes(projectType)) {
    throw new Error(`Invalid project type: ${projectType}. Must be 'ue_cpp', 'ue_blueprint' or 'cpp'`);
  }

  try {
    // Detect user language
    const userLang = detectUserLanguage();
    
    serverLog?.info(`📝 尝试从 API 获取提示词... 项目类型: ${projectType}, 语言: ${userLang}`);
    const response = await fetch(`/api/prompts/ue-static-defect?type=${projectType}&lang=${userLang}`);
    
    if (response.ok) {
      const prompt = await response.text();
      const promptFile = projectType === 'cpp'
        ? (userLang === 'zh' ? 'cpp_prompt.md' : 'cpp_prompt_en.md')
        : projectType === 'ue_cpp' 
          ? (userLang === 'zh' ? 'ue5_cpp_prompt.md' : 'ue5_cpp_prompt_en.md')
          : (userLang === 'zh' ? 'ue5_blueprint_prompt.md' : 'ue5_blueprint_prompt_en.md');
      serverLog?.info(`✓ 成功从 API 获取提示词，长度: ${prompt.length} 字符`);
      serverLog?.info(`✓ 提示词来源: ${promptFile} 文件`);
      return prompt;
    } else {
      const errorData = await response.json().catch(() => ({}));
      serverLog?.warn(`⚠ API 返回错误状态 ${response.status}:`, errorData);
      throw new Error(`Failed to fetch prompt: ${response.status}`);
    }
  } catch (error) {
    serverLog?.error('❌ 从 API 获取提示词失败，改用本地兜底提示词:', error);
    const fallback = getEnhancedDefaultPrompt();
    serverLog?.info(`✓ 使用兜底提示词，长度: ${fallback.length}`);
    return fallback;
  }
}

/**
 * Get enhanced default prompt (used when file cannot be read)
 * @returns {string} - Default prompt
 */
function getEnhancedDefaultPrompt() {
  return `你是资深C++/UE5静态分析专家，对UE5 C++项目进行全面静态缺陷代码检测。

## 检测范围与要求
- 引擎/平台：Unreal Engine 5、C++、Windows（MSVC工具链）
- 只基于当前代码分析，不借助任何既知缺陷ID/清单
- 所有缺陷必须有明确代码依据，禁止基于逻辑推测

## 输出报告格式（必须遵守）
以 JSON 数组输出，每条缺陷为一个对象，字段如下：
- no: 序号，从1开始递增
- category: AUTO/ARRAY/MEMF/LEAK/OSRES/STL/DEPR/PERF/CLASS/COMPILE
- file: 相对路径
- function: 函数或符号名
- snippet: 关键代码（1-3行，用 \\n 连接多行）
- lines: 行号或范围（如 "L120" 或 "L118-L125"）
- risk: 风险说明
- howToTrigger: 触发/重现条件
- suggestedFix: 最小化入侵的修复建议
- confidence: High/Medium/Low

示例（只输出 JSON 数组，不要输出其他文本）：
```
[
  {
    "no": 1,
    "category": "AUTO",
    "file": "Player/LyraPlayerState.cpp",
    "function": "ComputeRank_Helper",
    "snippet": "int32 Bonus; return Base + Bonus;",
    "lines": "L123-L124",
    "risk": "未初始化使用",
    "howToTrigger": "直接调用时",
    "suggestedFix": "为Bonus赋初值或分支全覆盖",
    "confidence": "High"
  }
]
```

请严格遵守以上格式要求，只输出 JSON，不要输出 Markdown 表格或其他说明。`;
}

/**
 * 在同目录下按候选后缀查找与给定文件同名的兄弟文件。
 * @param {Object} sourceFile - 源文件信息（需含 name/path）
 * @param {string[]} candidateExtensions - 候选后缀（含点号），按优先级排列
 * @param {FileSystemDirectoryHandle} directoryHandle - 目录句柄
 * @returns {Promise<{content: string, path: string}|null>} - 命中的兄弟文件或 null
 */
async function findSiblingByExtensions(sourceFile, candidateExtensions, directoryHandle) {
  const baseName = sourceFile.name.substring(0, sourceFile.name.lastIndexOf('.'));
  const dirPath = sourceFile.path.substring(0, sourceFile.path.lastIndexOf('/'));

  for (const ext of candidateExtensions) {
    const siblingName = baseName + ext;

    try {
      const siblingPath = dirPath ? `${dirPath}/${siblingName}` : siblingName;

      const siblingFileInfo = {
        path: siblingPath,
        name: siblingName,
        lastModified: Date.now(),
        size: 0,
        isDirectory: false
      };

      const content = await getFileContent(siblingFileInfo, directoryHandle);
      if (content) {
        return { content, path: siblingPath };
      }
    } catch {
      // Continue trying next extension
    }
  }

  return null;
}

/**
 * Find paired implementation file (.h -> .cpp)
 * @param {Object} headerFile - Header file info
 * @param {FileSystemDirectoryHandle} directoryHandle - Directory handle
 * @returns {Promise<{content: string, path: string}|null>} - Paired file or null
 */
async function findPairedImplementationFile(headerFile, directoryHandle) {
  const possibleExtensions = ['.cpp', '.cc', '.cxx'];
  const found = await findSiblingByExtensions(headerFile, possibleExtensions, directoryHandle);

  if (found) {
    serverLog?.info(`✓ 找到配对的实现文件: ${found.path}，长度: ${found.content.length} 字符`);
    return found;
  }

  serverLog?.info(`未找到配对的实现文件（尝试了 ${possibleExtensions.join(', ')}）`);
  return null;
}

/**
 * 反向配对：实现文件 -> 头文件（.cpp/.cc/.cxx -> .h/.hpp/.hxx）。
 *
 * ⚠️ 与 {@link findPairedImplementationFile} 的用途**严格区分**：
 * 本函数的结果**仅用于抽取"声明骨架"喂给模型做类型判断**，
 * **绝不可**赋值给 `pairedFile`——否则会绕过大文件分块闸门
 * （`!pairedFile && estSize > CHUNK_THRESHOLD`），使超大 .cpp 走"头+实现全文合并"
 * 路径而撑爆上下文。
 *
 * @param {Object} implFile - 实现文件信息
 * @param {FileSystemDirectoryHandle} directoryHandle - Directory handle
 * @returns {Promise<{content: string, path: string}|null>} - 配对头文件或 null
 */
async function findPairedHeaderFile(implFile, directoryHandle) {
  const possibleExtensions = ['.h', '.hpp', '.hxx'];
  const found = await findSiblingByExtensions(implFile, possibleExtensions, directoryHandle);

  if (found) {
    serverLog?.info(`✓ 找到配对的头文件（仅用于声明骨架）: ${found.path}，长度: ${found.content.length} 字符`);
    return found;
  }

  serverLog?.info(`未找到配对的头文件（尝试了 ${possibleExtensions.join(', ')}），将按无骨架检测`);
  return null;
}

/**
 * Detect defects in a single file
 * @param {Object} fileInfo - File information
 * @param {FileSystemDirectoryHandle} [directoryHandle] - Directory handle
 * @param {string} projectType - Project type ('ue_cpp' or 'ue_blueprint')
 * @returns {Promise<DefectDetectionResult[]>} - List of detected defects
 */
export async function detectDefectsInFile(fileInfo, directoryHandle, projectType) {
  // Validate required parameters
  if (!projectType) {
    throw new Error('Project type is required for detection');
  }

  serverLog?.info(`=== 开始检测文件: ${fileInfo.name} (项目类型: ${projectType}) ===`);
  
  // 🔧 准备token统计的公共数据（在最外层，确保任何情况都能访问）
  const detectionStartTime = Date.now();
  let content = '';
  let systemPrompt = '';
  let userMessage = '';
  let lineStats = null;
  let moduleName = 'root';
  
  try {
    // Get file content
    content = await getFileContent(fileInfo, directoryHandle);
    if (!content) {
      serverLog?.warn(`无法读取文件内容: ${fileInfo.path}`);
      // 🔧 即使读取失败，也记录尝试
      recordTokenStatisticsOnFailure(fileInfo, detectionStartTime, 'file_read_failed');
      return [];
    }
    serverLog?.info(`文件内容长度: ${content.length} 字符`);
    
    // 🔧 提前计算行数统计（确保有数据）
    lineStats = calculateLineStatistics(content);
    
    // 🔧 提前提取模块名（改进逻辑）
    const pathParts = fileInfo.path.split('/').filter(p => p && p !== '.');
    // 如果路径只有一个部分（文件名），说明在根目录
    if (pathParts.length === 1) {
      moduleName = 'root';
    } else {
      // 否则使用第一个目录名作为模块名
      moduleName = pathParts[0];
    }

    // If it's a .h file, try to find corresponding .cpp file (only for C++ projects)
    let pairedFile = null;
    if (['ue_cpp', 'cpp'].includes(projectType) && fileInfo.name.endsWith('.h') && directoryHandle) {
      pairedFile = await findPairedImplementationFile(fileInfo, directoryHandle);
    }

    // ===== 大文件闸门：本地预分块送审（P0+P1+P2）=====
    // 路由策略：
    //  A. 超大 .h + 配对 .cpp，且 头+实现 总量超过 阈值*2 → 方案5（头与实现分别分块，实现块注入头声明骨架）。
    //  B. 超大 .h（无论是否配对 .cpp，只要未达到 A 的"合并 inline"条件）→ 方案4（头自身分块 + 注入头结构骨架）。
    //  C. 其它超大单文件（.cpp 无 headerRef，或 .h 未超阈值等情况）→ 原分块路径（P1：.cpp 反向配对头骨架）。
    // ⚠️ 反向配对到的 headerRef 仅作「声明骨架」来源，绝不并入 pairedFile（回归红线）。
    try {
      const {
        detectLargeFileDefects,
        detectLargeHeaderWithImpl,
        SINGLE_FILE_CHUNK_THRESHOLD: CHUNK_THRESHOLD,
      } = await import('./largeFileDetectionService.js');
      const estTokens = Math.floor((content?.length || 0) / 4);
      const estLines = lineStats ? lineStats.totalLines : (content || '').split('\n').length;
      const estSize = Math.max(estTokens, estLines);
      const isHeader = fileInfo.name.endsWith('.h');
      const pairedImpl = pairedFile; // .h -> .cpp 配对结果（可能来自上方 L325）
      const combinedEst = pairedImpl ? estSize + Math.max(Math.floor((pairedImpl.content?.length || 0) / 4), (pairedImpl.content || '').split('\n').length) : estSize;

      // —— 方案 5：超大 头+实现 协同分块 ——
      if (isHeader && pairedImpl && combinedEst > CHUNK_THRESHOLD * 2) {
        serverLog?.info(`[大文件闸门·方案5] ${fileInfo.name} + ${pairedImpl.path} 合并估算 ${combinedEst} 超过 ${CHUNK_THRESHOLD * 2}，走头/实现分别分块`);
        const result = await detectLargeHeaderWithImpl({
          headerFileInfo: fileInfo,
          headerContent: content,
          implFileInfo: { name: pairedImpl.path.split('/').pop(), path: pairedImpl.path },
          implContent: pairedImpl.content,
          projectType,
        });
        if (result && result.coverage) {
          const cov = result.coverage;
          serverLog?.info(`[大文件闸门·方案5] 完成：缺陷 ${result.defects.length}，成功块 ${cov.successChunks}/${cov.totalChunks}`);
        }
        return result ? result.defects : [];
      }

      // —— 方案 4 / C：超大单文件分块 ——
      if (estSize > CHUNK_THRESHOLD) {
        const chunkMode = isHeader ? '方案4(头自身分块)' : '分块';
        serverLog?.info(`[大文件闸门] ${fileInfo.name} 估算规模 ${estSize}（字符${content.length}/行${estLines}）超过阈值 ${CHUNK_THRESHOLD}，进入${chunkMode}`);

        // 反向配对头文件（仅作声明骨架来源）；.h 自身检测时无需反向配对。
        let headerRef = null;
        if (!isHeader && ['ue_cpp', 'cpp'].includes(projectType) && /\.(cpp|cc|cxx)$/i.test(fileInfo.name) && directoryHandle) {
          headerRef = await findPairedHeaderFile(fileInfo, directoryHandle);
        }

        // 方案 4：超大 .h 自身分块时，预生成「文件结构骨架」并随每块注入，
        // 让模型感知"当前块位于哪个类/命名空间"，关联跨多块的同一个类定义。
        let fileStructure = null;
        if (isHeader) {
          try {
            const { buildFileStructureSkeleton } = await import('../context/headerSkeletonExtractor.js');
            fileStructure = buildFileStructureSkeleton(content);
          } catch (_e) {
            fileStructure = null;
          }
        }

        const chunkResult = await detectLargeFileDefects({
          fileInfo,
          directoryHandle,
          fileContent: content,
          projectType,
          headerRef,
          fileStructure,
        });
        if (chunkResult && chunkResult.coverage) {
          const cov = chunkResult.coverage;
          serverLog?.info(`[大文件闸门] ${fileInfo.name} 分块完成：缺陷 ${chunkResult.defects.length}，成功块 ${cov.successChunks}/${cov.totalChunks}，覆盖行 ${cov.coveredLines}/${cov.totalLines}`);
          if (!cov.fullyCovered) {
            serverLog?.warn(`[大文件闸门] ${fileInfo.name} 存在未覆盖分块（覆盖率不足），缺陷可能不完整`);
          }
        }
        return chunkResult ? chunkResult.defects : [];
      }
    } catch (gateError) {
      serverLog?.error(`[大文件闸门] 分块送审异常，回退原整文件流程: ${fileInfo.name}`, gateError);
      // 继续走下方原 inline 逻辑
    }

    // Get system prompt (must pass projectType)
    systemPrompt = await getUEDefectDetectionPrompt(projectType);
    serverLog?.info(`提示词长度: ${systemPrompt.length} 字符`);
    
    // Detect user language for user message
    const userLang = detectUserLanguage();
    
    // Build user message based on language
    if (pairedFile) {
      // If paired file found, analyze together
      if (userLang === 'zh') {
        userMessage = `请对以下C++代码文件进行静态缺陷检测：

**头文件：${fileInfo.path}**
文件大小：${content.length} 字符

\`\`\`cpp
${withLineNumbers(content)}
\`\`\`

**实现文件：${pairedFile.path}**
文件大小：${pairedFile.content.length} 字符

\`\`\`cpp
${withLineNumbers(pairedFile.content)}
\`\`\`

**重要提示：**
- 这是配对的头文件和实现文件，请一起分析（代码块每行已标注真实行号，头文件与实现文件各自独立编号）
- 检查成员变量时，请查看构造函数（在实现文件中）是否已初始化
- 只报告真正未初始化的成员变量，不要报告已在构造函数中初始化的变量
- **缺陷归属规则（关键）**：\`file\` 字段必须填写缺陷**真实所在**的文件路径。位于头文件（${fileInfo.path}）中的缺陷——如类/结构体声明错误、宏/枚举/typedef 定义问题、内联函数、成员声明、头文件自身的逻辑——必须填写 \`file: ${fileInfo.path}\`；只有真正位于实现文件（${pairedFile.path}）中的缺陷才填写 \`file: ${pairedFile.path}\`。**严禁把所有缺陷都填成实现文件路径。**
- \`lines\` 字段请直接照抄代码块中对应行的真实行号（如 "L120" 或 "L118-L125"），不得自行估算
- \`snippet\` 字段只写纯净代码，不要带 \`L{n}:\` 行号前缀

请按照指定的缺陷类别进行检测，**严格以 JSON 数组输出**，每个对象包含字段：no、category、file、function、snippet、lines、risk、howToTrigger、suggestedFix、confidence。**只输出 JSON，不要返回 Markdown 或其他说明。**`;
      } else {
        userMessage = `Please perform static defect detection on the following C++ code files:

**Header file: ${fileInfo.path}**
File size: ${content.length} characters

\`\`\`cpp
${withLineNumbers(content)}
\`\`\`

**Implementation file: ${pairedFile.path}**
File size: ${pairedFile.content.length} characters

\`\`\`cpp
${withLineNumbers(pairedFile.content)}
\`\`\`

**Important notes:**
- These are paired header and implementation files, please analyze them together (each line in the blocks is prefixed with its real line number; header and implementation are numbered independently)
- When checking member variables, please check if they are initialized in the constructor (in the implementation file)
- Only report truly uninitialized member variables, do not report variables already initialized in the constructor
- **Defect attribution rule (critical)**: the \`file\` field MUST be the path where the defect truly resides. Defects located in the header (${fileInfo.path}) — e.g. class/struct declaration errors, macro/enum/typedef issues, inline functions, member declarations, header-only logic — MUST set \`file: ${fileInfo.path}\`. Only defects truly in the implementation (${pairedFile.path}) should set \`file: ${pairedFile.path}\`. **Do NOT attribute all defects to the implementation file.**
- For the \`lines\` field, copy the real line numbers shown in the blocks (e.g. "L120" or "L118-L125"); do not estimate
- For the \`snippet\` field, write pure code only, without the \`L{n}:\` line-number prefix

Detect defects by the specified categories and **output strictly as a JSON array only**, each object with fields: no, category, file, function, snippet, lines, risk, howToTrigger, suggestedFix, confidence. **Do not return Markdown or any extra text.**`;
      }
    } else {
      // Analyze separately
      if (userLang === 'zh') {
        userMessage = `请对以下C++代码文件进行静态缺陷检测：

文件路径：${fileInfo.path}
文件大小：${content.length} 字符

代码内容：
\`\`\`cpp
${withLineNumbers(content)}
\`\`\`

请按照指定的缺陷类别进行检测，**严格以 JSON 数组输出**，每个对象字段：no、category、file、function、snippet、lines、risk、howToTrigger、suggestedFix、confidence。**只输出 JSON，不要返回 Markdown 或其他说明。**
注意：代码块每行已标注真实行号，\`lines\` 字段请直接照抄（如 "L120" 或 "L118-L125"），\`snippet\` 字段只写纯净代码，不要带 \`L{n}:\` 行号前缀。`;
      } else {
        userMessage = `Please perform static defect detection on the following C++ code file:

File path: ${fileInfo.path}
File size: ${content.length} characters

Code content:
\`\`\`cpp
${withLineNumbers(content)}
\`\`\`

Detect defects by the specified categories and **output strictly as a JSON array only**, each object with fields: no, category, file, function, snippet, lines, risk, howToTrigger, suggestedFix, confidence. **Do not return Markdown or any extra text.**
Note: each line in the block is prefixed with its real line number; for \`lines\` copy it directly (e.g. "L120" or "L118-L125"), and for \`snippet\` write pure code without the \`L{n}:\` prefix.`;
      }
    }

    // Build message history
    const messageHistory = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ];

    console.log('\n' + '🔍'.repeat(40));
    console.log('📋 Code Detection Request Summary:');
    console.log('  - File:', fileInfo.path);
    console.log('  - System prompt length:', systemPrompt.length);
    console.log('  - User message length:', userMessage.length);
    console.log('  - Has paired file:', !!pairedFile);
    console.log('  - Total messages:', messageHistory.length);
    console.log('🔍'.repeat(40) + '\n');

    serverLog?.info(`开始调用AI服务...`);

    // ===== 多次采样取并集（N=2 默认，平衡召回与成本）=====
    // 单次 LLM 检测存在固有随机性（实测单次召回仅 ~45%），多次采样后按位置合并去重，
    // 可把召回率提升到 ~85%，并让 gui.h 等头文件缺陷稳定出现。
    const SAMPLE_COUNT = 2;
    const timeout = 300000; // 300 seconds per sample

    // 单次采样的封装：调用一次 AI，返回 responseContent（失败/超时返回 null，不中断其它采样）
    const runSingleSample = async (sampleIdx) => {
      let abortController = null;
      let timeoutId = null;
      try {
        abortController = new AbortController();
        const detectionPromise = (async () => {
          try {
            const result = await codeReviewAIService.adapter.chat(messageHistory, {
              signal: abortController.signal
            });
            return result.content || result.fullText || '';
          } catch (chatError) {
            console.error(`❌ 采样 ${sampleIdx + 1} 调用失败:`, chatError);
            throw chatError;
          }
        })();
        const timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            abortController?.abort();
            reject(new Error('AI检测超时'));
          }, timeout);
        });
        const content = await Promise.race([detectionPromise, timeoutPromise]);
        if (timeoutId) clearTimeout(timeoutId);
        const sampleTime = Date.now() - detectionStartTime;
        console.log(`✅ 采样 ${sampleIdx + 1}/${SAMPLE_COUNT} AI 响应完成，总耗时: ${Math.floor(sampleTime / 1000)}秒`);
        serverLog?.info(`文件 ${fileInfo.name} 第 ${sampleIdx + 1}/${SAMPLE_COUNT} 次采样完成（${content.length} 字符）`);
        return content;
      } catch (err) {
        if (timeoutId) clearTimeout(timeoutId);
        abortController?.abort();
        if (err instanceof Error && err.message === 'AI检测超时') {
          serverLog?.error(`文件 ${fileInfo.name} 第 ${sampleIdx + 1} 次采样超时（超过 ${timeout / 1000} 秒）`);
        } else {
          serverLog?.error(`文件 ${fileInfo.name} 第 ${sampleIdx + 1} 次采样出错:`, err);
        }
        return null;
      }
    };

    // 累积所有采样的原始响应（null 表示本次失败/超时）
    const sampleResponses = [];
    for (let s = 0; s < SAMPLE_COUNT; s++) {
      sampleResponses.push(await runSingleSample(s));
    }

    // 取第一次成功响应用于 token 统计（保证统计至少记一次真实成功）
    const firstOk = sampleResponses.find((r) => r && r.length > 0);
    if (firstOk) {
      // 🔧 成功时记录token统计（以首次成功响应为代表）
      recordTokenStatisticsOnSuccess(
        fileInfo,
        null,
        systemPrompt,
        userMessage,
        firstOk,
        moduleName,
        Date.now() - detectionStartTime,
        lineStats
      );
    } else {
      // 全部采样失败
      recordTokenStatisticsOnFailure(
        fileInfo,
        detectionStartTime,
        'all_samples_failed',
        systemPrompt,
        userMessage,
        moduleName,
        lineStats
      );
      return [];
    }

    // 合并所有采样的解析结果
    let allParsed = [];
    for (const resp of sampleResponses) {
      if (!resp) continue;
      // 单次响应内部先用「prompt-ack 重试」逻辑兜底（对应原 L623-656）
      let parsed = parseDefectDetectionResults(resp, fileInfo.path);
      if (parsed.length === 0 && isPromptAckOrMetaResponse(resp)) {
        serverLog?.warn(`采样响应疑似提示词确认文本，触发强约束重试: ${fileInfo.name}`);
        try {
          const retryAbort = new AbortController();
          const retryTimeoutId = setTimeout(() => retryAbort.abort(), timeout);
          const retryResult = await codeReviewAIService.adapter.chat(
            [
              ...messageHistory,
              { role: 'user', content: '你已经拿到了完整代码。不要重复说明规则、不要索要代码、不要前言。现在仅返回 JSON 数组（可为空数组），字段固定：no, category, file, function, snippet, lines, risk, howToTrigger, suggestedFix, confidence。' }
            ],
            { signal: retryAbort.signal }
          );
          const retryResp = retryResult.content || retryResult.fullText || '';
          clearTimeout(retryTimeoutId);
          if (retryResp) parsed = parseDefectDetectionResults(retryResp, fileInfo.path);
        } catch (retryError) {
          serverLog?.error(`采样强约束重试失败: ${fileInfo.name}`, retryError);
        }
      }
      allParsed = allParsed.concat(parsed);
    }
    serverLog?.info(`文件 ${fileInfo.name} ${SAMPLE_COUNT} 次采样共解析出 ${allParsed.length} 个候选缺陷`);
    let defects = mergeSamplesByLocation(allParsed);

    serverLog?.info(`文件 ${fileInfo.name} 检测完成（${SAMPLE_COUNT} 次采样合并后），发现 ${defects.length} 个缺陷`);

    // 🔧 A: 用 snippet 在真实源文件反查行号（按 defect.file 选择 .h 或 .cpp 内容）
    if (defects.length > 0) {
      defects = defects.map((defect) => {
        const isPairedCpp = pairedFile && defect.file && defect.file.endsWith('.cpp') && defect.file !== fileInfo.path;
        const targetContent = isPairedCpp ? pairedFile.content : content;
        const altContent = isPairedCpp ? content : (pairedFile ? pairedFile.content : null);
        const located = locateSnippetInFile(
          defect.snippet,
          targetContent,
          altContent,
          extractHintLine(defect.lines) ?? (defect.xline || null),
          defect.function
        );
        if (located.located) {
          return { ...defect, lines: located.lines, linesFromModel: false };
        }
        // 反查失败：保留模型原值并标记，便于排查
        return { ...defect, linesFromModel: true };
      });
      // 🔧 B: 单文件内去重
      const before = defects.length;
      defects = deduplicateDefects(defects);
      if (defects.length < before) {
        serverLog?.info(`文件 ${fileInfo.name} 单文件内去重移除 ${before - defects.length} 个重复缺陷`);
      }
    }

    return defects;

  } catch (error) {
    serverLog?.error(`检测文件 ${fileInfo.path} 时发生错误:`, error);
    
    // 🔧 最外层错误也记录token统计
    recordTokenStatisticsOnFailure(
      fileInfo,
      detectionStartTime,
      error.message || 'unknown_error',
      systemPrompt,
      userMessage,
      moduleName,
      lineStats
    );
    
    return [];
  }
}

/**
 * 🔧 计算行数统计的辅助函数
 * @param {string} content - 文件内容
 * @returns {Object} - 行数统计
 */
function calculateLineStatistics(content) {
  if (!content) {
    return { totalLines: 0, codeLines: 0, commentLines: 0 };
  }
  
  const lines = content.split('\n');
  const lineStats = {
    totalLines: lines.length,
    codeLines: 0,
    commentLines: 0
  };
  
  let inBlockComment = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // 空行不计入代码行或注释行
    if (!trimmed) continue;
    
    // 检查块注释
    if (trimmed.includes('/*')) inBlockComment = true;
    if (trimmed.includes('*/')) {
      inBlockComment = false;
      lineStats.commentLines++;
      continue;
    }
    
    // 统计行类型
    if (inBlockComment) {
      lineStats.commentLines++;
    } else if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
      lineStats.commentLines++;
    } else {
      lineStats.codeLines++;
    }
  }
  
  return lineStats;
}

/**
 * 🔧 成功时记录token统计
 */
function recordTokenStatisticsOnSuccess(
  fileInfo,
  tokenUsage,
  systemPrompt,
  userMessage,
  responseContent,
  moduleName,
  totalTime,
  lineStats
) {
  try {
    if (tokenUsage && tokenUsage.total_tokens) {
      // 有实际的token数据
      tokenStatisticsService.recordFileTokens(
        fileInfo.name,
        fileInfo.path,
        tokenUsage,
        '',
        '',
        moduleName,
        totalTime,
        lineStats
      );
      console.log(`📊 Token统计已记录（实际数据）: ${fileInfo.name}`);
    } else {
      // 使用估算
      console.warn('⚠️ No token usage data received for file:', fileInfo.name);
      const promptText = systemPrompt + userMessage;
      tokenStatisticsService.recordFileTokens(
        fileInfo.name,
        fileInfo.path,
        null,
        promptText,
        responseContent,
        moduleName,
        totalTime,
        lineStats
      );
      console.log(`📊 Token统计已记录（估算数据）: ${fileInfo.name}`);
    }
  } catch (error) {
    console.error('❌ 记录token统计失败:', error);
  }
}

/**
 * 🔧 失败时记录token统计（使用估算）
 */
function recordTokenStatisticsOnFailure(
  fileInfo,
  startTime,
  errorMessage,
  systemPrompt = '',
  userMessage = '',
  moduleName = 'root',
  lineStats = null
) {
  try {
    const totalTime = Date.now() - startTime;
    const promptText = systemPrompt + userMessage;
    
    // 如果没有行数统计，使用默认值
    const safeLineStats = lineStats || { totalLines: 0, codeLines: 0, commentLines: 0 };
    
    tokenStatisticsService.recordFileTokens(
      fileInfo.name,
      fileInfo.path,
      null, // 没有实际token数据
      promptText,
      '', // 没有响应内容
      moduleName,
      totalTime,
      safeLineStats
    );
    
    console.log(`📊 Token统计已记录（失败/估算）: ${fileInfo.name}, 原因: ${errorMessage}`);
  } catch (error) {
    console.error('❌ 记录失败token统计时出错:', error);
  }
}

/**
 * Detect model meta/prompt-ack responses that do not contain actual analysis output.
 * @param {string} response
 * @returns {boolean}
 */
export function isPromptAckOrMetaResponse(response) {
  const text = (response || '').toLowerCase();
  if (!text) return false;

  const markers = [
    'please provide the source code',
    'please provide the code',
    'i am ready to evaluate',
    'i have internalized',
    'bug hunter',
    'i will adhere to the following output format',
    'i can start analyzing once you provide',
    '请提供源代码',
    '请提供代码',
    '我已理解',
    '我已准备好分析'
  ];

  const hitCount = markers.reduce((count, m) => count + (text.includes(m) ? 1 : 0), 0);
  return hitCount >= 2;
}

/**
 * Parse AI returned defect detection results (using relaxed static detection parsing logic)
 * @param {string} response - AI response
 * @param {string} filePath - File path
 * @returns {DefectDetectionResult[]} - List of parsed defects
 */
export function parseDefectDetectionResults(response, filePath) {
  const defects = [];
  
  console.log('\n' + '🔧'.repeat(40));
  console.log('🔧 Starting to parse AI response:');
  console.log('  - Response length:', response.length);
  console.log('  - File path:', filePath);
  
  // ===== Always print full response for debugging =====
  console.log('\n===== FULL AI RESPONSE START =====');
  console.log(response);
  console.log('===== FULL AI RESPONSE END =====\n');
  
  serverLog?.debug('AI响应内容:', response.substring(0, 500)); // Debug log
  
  // Check if explicitly stated no defects
  if (response.toLowerCase().includes('no defects found') || 
      response.toLowerCase().includes('未发现缺陷') ||
      response.toLowerCase().includes('没有发现缺陷')) {
    console.log('  ✓ AI explicitly stated: No defects found');
    console.log('🔧'.repeat(40) + '\n');
    serverLog?.info('AI检测结果：未发现缺陷');
    return defects;
  }
  
  // 0. JSON array format (highest priority)
  console.log('  🔍 Trying JSON array format (priority)...');
  try {
    // Strip ALL ```json ... ``` or ``` ... ``` fences anywhere in the response (not just at start)
    // This handles cases where AI wraps output in code blocks with or without leading text
    const jsonText = response
      .replace(/```(?:json)?\s*/gi, '')  // remove all opening code fences
      .replace(/```\s*/g, '')            // remove all closing code fences
      .trim();
    // Find the outermost JSON array
    const arrayStart = jsonText.indexOf('[');
    const arrayEnd = jsonText.lastIndexOf(']');
    if (arrayStart !== -1 && arrayEnd > arrayStart) {
      const jsonStr = jsonText.slice(arrayStart, arrayEnd + 1);
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const jsonDefects = parsed.map((item) => ({
          category: item.category || 'UNKNOWN',
          file: item.file || filePath,
          function: item.function || '',
          snippet: item.snippet || '',
          lines: item.lines || '',
          risk: item.risk || '',
          howToTrigger: item.howToTrigger || '',
          suggestedFix: item.suggestedFix || '',
          confidence: item.confidence || 'Medium',
          xline: typeof item.xline === 'number' ? item.xline : (typeof item.xline === 'string' ? parseInt(item.xline, 10) || 0 : 0),
          xfunc: item.xfunc || '',
        }));
        console.log(`  ✅ JSON array parsed: ${jsonDefects.length} defects`);
        console.log('🔧'.repeat(40) + '\n');
        return jsonDefects;
      }
    }
  } catch (e) {
    console.log('  ⚠️ JSON parse failed:', e.message);
    // (full response already printed at function entry above)
    // Try a second pass: greedy regex to capture the entire JSON array (not non-greedy)
    try {
      const arrayMatch = response.match(/\[\s*\{[\s\S]*\}\s*\]/);   // greedy – captures full array
      if (arrayMatch) {
        const parsed = JSON.parse(arrayMatch[0]);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const jsonDefects = parsed.map((item) => ({
            category: item.category || 'UNKNOWN',
            file: item.file || filePath,
            function: item.function || '',
            snippet: item.snippet || '',
            lines: item.lines || '',
            risk: item.risk || '',
            howToTrigger: item.howToTrigger || '',
            suggestedFix: item.suggestedFix || '',
            confidence: item.confidence || 'Medium',
          }));
          console.log(`  ✅ JSON array parsed (regex fallback): ${jsonDefects.length} defects`);
          console.log('🔧'.repeat(40) + '\n');
          return jsonDefects;
        }
      }
    } catch (e2) {
      console.log('  ⚠️ JSON regex fallback also failed:', e2.message);
    }
  }

  // Relaxed parsing logic: directly extract all possible defect information
  // 1. First try English table format
  const tableMatch = response.match(/\|.*\|.*\|.*\|.*\|.*\|.*\|.*\|.*\|.*\|.*\|/g);
  
  console.log('  🔍 Searching for table format...');
  console.log('  - Table rows found:', tableMatch ? tableMatch.length : 0);
  
  if (tableMatch && tableMatch.length > 1) {
    console.log('  ✓ Table format detected!');
    console.log('  - First 3 rows:');
    for (let i = 0; i < Math.min(3, tableMatch.length); i++) {
      console.log(`    [${i}] ${tableMatch[i]}`);
    }
    
    serverLog?.info(`[DEBUG] 找到 ${tableMatch.length} 行表格数据`);
    
    // 输出前5行用于调试（包括表头）
    for (let i = 0; i < Math.min(5, tableMatch.length); i++) {
      serverLog?.info(`[DEBUG] 表格第 ${i} 行: ${tableMatch[i]}`);
    }
    
    // 输出完整的 AI 响应（前 2000 字符）用于调试
    serverLog?.info(`[DEBUG] AI 完整响应（前2000字符）:\n${response.substring(0, 2000)}`);
    
    // Skip header, start from second row
    for (let i = 1; i < tableMatch.length; i++) {
      const row = tableMatch[i].trim();
      if (!row.startsWith('|')) continue;
      
      // 跳过分隔符行（如 |---|---|---|）
      if (row.includes('---')) continue;
      
      const columns = row.split('|').map(col => col.trim()).filter(col => col);
      
      serverLog?.info(`[DEBUG] 第 ${i} 行解析后列数: ${columns.length}, 完整列内容: ${JSON.stringify(columns)}`);
      
      // Relaxed column count requirement: as long as there's category and description, consider it valid
      if (columns.length >= 2) {
        const validCategories = ['AUTO', 'ARRAY', 'MEMF', 'LEAK', 'OSRES', 'STL', 'DEPR', 'PERF', 'CLASS', 'COMPILE', 'SECURITY', 'SEQ', 'INITORD'];
        const category = columns[1] || 'UNKNOWN';
        
        serverLog?.info(`[DEBUG] 检查 Category: ${category}, 是否有效: ${validCategories.includes(category)}`);
        
        // Relaxed validation: as long as category is valid and not obviously a placeholder
        if (validCategories.includes(category) && 
            !isPlaceholderContent(columns)) {
          const defect = {
            category: category,
            file: filePath,
            function: columns[3] || '',      // 注意：这里应该是 columns[3]，因为 columns[0] 是 No
            snippet: columns[4] || '',
            lines: columns[5] || '',
            risk: columns[6] || 'medium',
            howToTrigger: columns[7] || '',
            suggestedFix: columns[8] || '',
            confidence: columns[9] || 'Medium'
          };
          
          defects.push(defect);
          
          serverLog?.info(`[DEBUG] 成功解析缺陷: ${JSON.stringify(defect)}`);
        }
      }
    }
    
    if (defects.length > 0) {
      console.log(`  ✅ Successfully parsed ${defects.length} defects from table format`);
      console.log('  - Sample defect:', JSON.stringify(defects[0], null, 2));
      console.log('🔧'.repeat(40) + '\n');
      serverLog?.info(`成功解析 ${defects.length} 个英文表格格式缺陷`);
      return defects;
    } else {
      console.log('  ⚠️ Table found but no valid defects parsed');
    }
  } else {
    console.log('  ⚠️ No table format detected in response');
  }
  
  console.log('  🔍 Trying Chinese table format...');
  // 2. Try Chinese table format as fallback (if LLM doesn't follow English requirement)
  const chineseTableDefects = parseChineseTableFormat(response, filePath);
  if (chineseTableDefects.length > 0) {
    console.log(`  ✅ Successfully parsed ${chineseTableDefects.length} defects from Chinese table`);
    console.log('🔧'.repeat(40) + '\n');
    serverLog?.info(`成功解析 ${chineseTableDefects.length} 个中文表格格式缺陷`);
    return chineseTableDefects;
  }
  
  console.log('  🔍 Trying list format...');
  // 3. Try list format
  const listDefects = parseListFormatDefects(response, filePath);
  if (listDefects.length > 0) {
    console.log(`  ✅ Successfully parsed ${listDefects.length} defects from list format`);
    console.log('🔧'.repeat(40) + '\n');
    serverLog?.info(`成功解析 ${listDefects.length} 个列表格式缺陷`);
    return listDefects;
  }

  console.log('  🔍 Trying structured markdown format...');
  // 4. Try markdown issue sections (#### A. ...)
  const markdownDefects = parseStructuredMarkdownDefects(response, filePath);
  if (markdownDefects.length > 0) {
    console.log(`  ✅ Successfully parsed ${markdownDefects.length} defects from markdown format`);
    console.log('🔧'.repeat(40) + '\n');
    serverLog?.info(`成功解析 ${markdownDefects.length} 个Markdown结构化缺陷`);
    return markdownDefects;
  }
  
  console.log('  🔍 Trying loose format matching...');
  // 5. If standard format parsing fails, try relaxed text matching
  const looseDefects = parseLooseFormatDefects(response, filePath);
  if (looseDefects.length > 0) {
    console.log(`  ✅ Successfully parsed ${looseDefects.length} defects from loose format`);
    console.log('🔧'.repeat(40) + '\n');
    serverLog?.info(`成功解析 ${looseDefects.length} 个宽松格式缺陷`);
    return looseDefects;
  }
  
  console.log('  ❌ No defects found in any format');
  console.log('🔧'.repeat(40) + '\n');
  serverLog?.info('未发现缺陷（AI响应格式无法解析或确实没有缺陷）');
  return defects;
}

/**
 * 🔧 用 snippet 在真实源文件中反查起止行号，校正模型盲猜的 lines
 * @param {string} snippet - 模型给出的代码片段
 * @param {string} fileContent - 主文件内容（.h 或单独 .cpp）
 * @param {string|null} [altContent] - 配对文件内容（.cpp），主文件未命中时再查
 * @returns {{lines: string, located: boolean, usedAlt: boolean}}
 */
/**
 * 从模型返回的行号字段（如 "L3868"、"L3868-L3870" 或数字）中提取首个行号数字，
 * 用作 locateSnippetInFile 的消歧提示（hintLine）。提取失败返回 null。
 * @param {string|number} lines
 * @returns {number|null}
 */
export function extractHintLine(lines) {
  if (typeof lines === 'number' && !Number.isNaN(lines)) return lines;
  if (!lines) return null;
  const m = String(lines).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * 在归一化文件行中按函数名定位函数起止行（花括号平衡）。
 * 返回 {start, end}（真实行号）或 null。用于把 snippet 候选限制在模型所指函数体内，
 * 避免把缺陷错挂到结构相似的其他函数（如 gui.cpp 的重复 `des_info = CORE_NEW` 模式）。
 * @param {Array<{norm:string, line:number}>} normLines
 * @param {string} functionName
 * @returns {{start:number, end:number}|null}
 */
function findFunctionRange(normLines, functionName) {
  if (!functionName) return null;
  // 候选名：全名 + 去掉类名限定后的尾名（如 "Gui::GetGuiEffectInfo" → 也试 "GetGuiEffectInfo"）
  const names = [functionName];
  const tail = functionName.split('::').pop();
  if (tail && tail !== functionName) names.push(tail);

  let sigIdx = -1;
  for (let i = 0; i < normLines.length; i++) {
    const t = normLines[i].norm;
    if (names.some((n) => t.includes(n + '('))) {
      sigIdx = i;
      break;
    }
  }
  if (sigIdx < 0) return null;

  // 从签名行起做花括号平衡，找到函数结束行
  let depth = 0;
  let started = false;
  let endIdx = normLines.length - 1;
  for (let i = sigIdx; i < normLines.length; i++) {
    const t = normLines[i].norm;
    for (const ch of t) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') { depth--; }
    }
    if (started && depth === 0) {
      endIdx = i;
      break;
    }
  }
  return { start: normLines[sigIdx].line, end: normLines[endIdx].line };
}

export function locateSnippetInFile(snippet, fileContent, altContent = null, hintLine = null, functionName = null) {
  const fallback = { lines: '', located: false, usedAlt: false };
  if (!snippet || (!fileContent && !altContent)) return fallback;

  // 归一化并按"原始行号"建立索引：去行/块注释、压缩连续空白，空行丢弃。
  // 关键：返回的是真实行号，而非归一化数组下标（注释/空行会让二者错位）。
  const buildLines = (s) => {
    const raw = (s || '').split('\n');
    const out = [];
    for (let idx = 0; idx < raw.length; idx++) {
      const n = raw[idx]
        .replace(/^\s*L\d+:\s*/, '')   // 剥离注入的行号前缀（双保险，防止模型把 L{n}: 带进 snippet）
        .replace(/\/\/.*$/, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .trim()
        .replace(/\s+/g, ' ');
      if (n.length > 0) out.push({ norm: n, line: idx + 1 });
    }
    return out;
  };

  const snippetLines = buildLines(snippet).map((d) => d.norm);
  if (snippetLines.length === 0) return fallback;

  // 函数名约束：在模型所指函数体内接受候选，避免错挂到相似函数（改进点 b）
  const funcRange = functionName ? findFunctionRange(buildLines(fileContent || altContent || ''), functionName) : null;

  // 收集所有候选命中（不再只取第一个），供 hintLine 在重复代码模式下消歧。
  const tryLocateAll = (content) => {
    if (!content) return [];
    const fileLines = buildLines(content);
    const candidates = [];
    // 单行 snippet：退化为子串匹配
    if (snippetLines.length === 1) {
      const target = snippetLines[0];
      for (const fl of fileLines) {
        if (fl.norm.includes(target)) candidates.push({ start: fl.line, end: fl.line });
      }
    } else {
      // 多行 snippet：以全部行作为窗口在文件行中滑动匹配
      const winLen = snippetLines.length;
      for (let i = 0; i + winLen <= fileLines.length; i++) {
        let match = true;
        for (let j = 0; j < winLen; j++) {
          if (fileLines[i + j].norm.indexOf(snippetLines[j]) === -1) {
            match = false;
            break;
          }
        }
        if (match) candidates.push({ start: fileLines[i].line, end: fileLines[i + winLen - 1].line });
      }
      // 退化：只用 snippet 首行子串定位起点
      if (candidates.length === 0) {
        const first = snippetLines[0];
        for (const fl of fileLines) {
          if (fl.norm.includes(first)) candidates.push({ start: fl.line, end: fl.line });
        }
      }
    }
    // 函数名约束：仅保留落在函数体内的候选；约束失效（0 命中）时回退到全部候选，避免漏报
    if (funcRange && candidates.length > 0) {
      const inRange = candidates.filter((c) => c.start >= funcRange.start && c.end <= funcRange.end);
      if (inRange.length > 0) return inRange;
    }
    return candidates;
  };

  let candidates = tryLocateAll(fileContent);
  let usedAlt = false;
  if (candidates.length === 0 && altContent) {
    candidates = tryLocateAll(altContent);
    usedAlt = true;
  }
  if (candidates.length === 0) return fallback;

  // 多匹配时优先选离 hintLine 最近者（消歧重复代码模式，如 gui.cpp 的
  // `des_info = CORE_NEW(CDesignInfo)` 同时出现在 L3248 与 L3854）；
  // 仅一个候选或没有 hint 时保持原行为（取首个），向后兼容。
  let range = candidates[0];
  if (candidates.length > 1 && typeof hintLine === 'number' && !Number.isNaN(hintLine)) {
    let bestDist = Infinity;
    for (const c of candidates) {
      const dist = Math.abs(c.start - hintLine);
      if (dist < bestDist) {
        bestDist = dist;
        range = c;
      }
    }
  }

  const lines = range.start === range.end ? `L${range.start}` : `L${range.start}-L${range.end}`;
  return { lines, located: true, usedAlt };
}

/**
 * 字段完整性评分：用于去重时同键同置信度下保留信息更完整者
 * @param {Object} d - DefectDetectionResult
 * @returns {number}
 */
function snippetFieldRichness(d) {
  const fields = [d.category, d.file, d.function, d.snippet, d.lines, d.risk, d.howToTrigger, d.suggestedFix, d.confidence];
  return fields.reduce((acc, v) => acc + (v ? 1 : 0), 0);
}

/**
 * 🔧 以「文件 + 类别 + snippet 归一化」为键合并重复缺陷。
 * 模型盲猜的 lines 不可靠，故不作为去重键；同键保留置信度最高者。
 * @param {Array} list - DefectDetectionResult[]
 * @returns {DefectDetectionResult[]}
 */
export function deduplicateDefects(list) {
  if (!Array.isArray(list) || list.length <= 1) return list || [];

  const confRank = { High: 3, Medium: 2, Low: 1 };
  const normKey = (s) => (s || '')
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  // djb2 散列，避免长 snippet 直接做对象键
  const hash = (s) => {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  };
  const basename = (p) => (p || '').split('/').pop().split('\\').pop().toLowerCase();

  // 核心归一化：去除边界符号({};)与空白噪声，仅保留代码 token 序列，
  // 用于「片段包含」判定（同一缺陷的不同截断点，如 `else{return null;}` 与 `else{return null`）。
  const coreNorm = (s) => (s || '')
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/[{};,\s]+/g, ' ')
    .trim()
    .toLowerCase();

  const map = new Map();
  const entries = []; // 用于片段包含关系判定
  const normSnippet = (d) => normKey(d.snippet);

  for (const d of list) {
    const key = `${basename(d.file)}|${String(d.category || '').toUpperCase()}|${hash(normSnippet(d))}`;
    if (!map.has(key)) {
      map.set(key, d);
      entries.push({ key, d, core: coreNorm(d.snippet) });
    } else {
      const existing = map.get(key);
      const rc = confRank[String(d.confidence || 'Medium').trim()] || 2;
      const re = confRank[String(existing.confidence || 'Medium').trim()] || 2;
      // 置信度高者胜；相同则字段更完整者胜
      if (rc > re || (rc === re && snippetFieldRichness(d) > snippetFieldRichness(existing))) {
        map.set(key, d);
      }
    }
  }

  // 片段包含去重：大文件分块时，同一处缺陷常因块边界不同被切成
  // 「完整 snippet」与「截断片段 snippet」两个版本，且函数名解析不全时
  // 会带 [Unknown]（如 `Gui::[Unknown]`）。若某条 snippet 的核心 token 序列是
  // 另一条的子序列（去除边界符号后），则保留信息更完整（函数名非 Unknown、字段更丰富）者。
  const isUnknownFn = (d) => /\[unknown\]/i.test(String(d.function || ''));
  const out = [];
  const consumed = new Set();
  for (const a of entries) {
    if (consumed.has(a.key)) continue;
    let merged = a.d;
    for (const b of entries) {
      if (b.key === a.key || consumed.has(b.key)) continue;
      const sameFileCat = basename(a.d.file) === basename(b.d.file)
        && String(a.d.category || '').toUpperCase() === String(b.d.category || '').toUpperCase();
      if (!sameFileCat) continue;
      const aUnknown = isUnknownFn(a.d);
      const bUnknown = isUnknownFn(b.d);
      // core 完全等价、或互为子序列（不同截断点）、或一方包含另一方 → 视为同一缺陷
      const equivalent = a.core.length >= 4 && b.core.length >= 4
        && (a.core === b.core || a.core.includes(b.core) || b.core.includes(a.core));
      if (!equivalent) continue;
      // 保留信息更完整者：函数名非 Unknown 优先；其次字段更丰富
      const bWins = aUnknown && !bUnknown
        ? true
        : (!aUnknown && !bUnknown ? snippetFieldRichness(b.d) > snippetFieldRichness(a.d) : false);
      if (bWins) {
        consumed.add(a.key);
        merged = b.d;
        break;
      } else {
        consumed.add(b.key);
      }
    }
    out.push(merged);
  }
  return out;
}

/**
 * 多次采样合并去重（基于缺陷位置，而非 snippet 文本）。
 * 不同采样返回的 snippet 文本可能略有差异，用「文件+归一化行号范围+类别+函数」做 key 更稳，
 * 可把两次采样中指向同一处缺陷的结果合并为一条。
 * @param {DefectDetectionResult[]} list - 跨多次采样累积的缺陷
 * @returns {DefectDetectionResult[]}
 */
export function mergeSamplesByLocation(list) {
  if (!Array.isArray(list) || list.length <= 1) return list || [];

  const confRank = { High: 3, Medium: 2, Low: 1 };
  const basename = (p) => (p || '').split('/').pop().split('\\').pop().toLowerCase();

  // 归一化行号范围 → 形如 "L120" / "L118-L125" 中的起始行（用于跨采样近似比对）
  const normLineKey = (lines) => {
    const s = String(lines || '').trim().toLowerCase();
    const m = s.match(/l\s*(\d+)/);
    return m ? m[1] : s.replace(/[^a-z0-9]/g, '');
  };

  const map = new Map();
  for (const d of list) {
    const key = `${basename(d.file)}|${String(d.category || '').toUpperCase()}|${normLineKey(d.lines)}|${String(d.function || '').toLowerCase()}`;
    if (!map.has(key)) {
      map.set(key, d);
    } else {
      const existing = map.get(key);
      const rc = confRank[String(d.confidence || 'Medium').trim()] || 2;
      const re = confRank[String(existing.confidence || 'Medium').trim()] || 2;
      if (rc > re || (rc === re && snippetFieldRichness(d) > snippetFieldRichness(existing))) {
        map.set(key, d);
      }
    }
  }
  return Array.from(map.values());
}

/**
 * Parse Chinese table format defect detection results (fallback for when LLM doesn't follow English requirement)
 * @param {string} response - AI response
 * @param {string} filePath - File path
 * @returns {DefectDetectionResult[]} - List of parsed defects
 */
function parseChineseTableFormat(response, filePath) {
  const defects = [];
  const validCategories = ['AUTO', 'ARRAY', 'MEMF', 'LEAK', 'OSRES', 'STL', 'DEPR', 'PERF', 'CLASS', 'COMPILE', 'SECURITY', 'SEQ', 'INITORD'];
  
  // Map Chinese category names to English
  const chineseCategoryMap = {
    '未初始化': 'AUTO',
    '越界': 'ARRAY',
    '内存释放': 'MEMF',
    '泄漏': 'LEAK',
    '资源': 'OSRES',
    'STL': 'STL',
    '废弃': 'DEPR',
    '性能': 'PERF',
    '类': 'CLASS'
  };
  
  // Match Chinese table rows - look for patterns like | 缺陷类别 | 行号 | 说明 |
  const tableMatch = response.match(/\|.*\|.*\|.*\|.*\|/g);
  if (!tableMatch || tableMatch.length < 2) {
    return defects;
  }
  
  // Find header row to understand column mapping
  let headerRow = null;
  let headerIndex = -1;
  for (let i = 0; i < tableMatch.length; i++) {
    const row = tableMatch[i].toLowerCase();
    if (row.includes('缺陷') || row.includes('category') || row.includes('no')) {
      headerRow = tableMatch[i];
      headerIndex = i;
      break;
    }
  }
  
  if (headerIndex === -1) {
    return defects;
  }
  
  // Parse data rows (skip header and separator)
  for (let i = headerIndex + 2; i < tableMatch.length; i++) {
    const row = tableMatch[i].trim();
    if (!row.startsWith('|') || row.includes('---')) continue;
    
    const columns = row.split('|').map(col => col.trim()).filter(col => col);
    if (columns.length < 2) continue;
    
    // Try to extract category from various column positions
    let category = 'UNKNOWN';
    let categoryFound = false;
    
    for (const col of columns) {
      const upperCol = col.toUpperCase();
      // Check for English category
      if (validCategories.includes(upperCol)) {
        category = upperCol;
        categoryFound = true;
        break;
      }
      // Check for Chinese category
      for (const [chinese, english] of Object.entries(chineseCategoryMap)) {
        if (col.includes(chinese)) {
          category = english;
          categoryFound = true;
          break;
        }
      }
      if (categoryFound) break;
    }
    
    // If no valid category found, skip this row
    if (!categoryFound) continue;
    
    // Extract other fields from available columns
    const defect = {
      category: category,
      file: filePath,
      function: columns[2] || '',
      snippet: columns[3] || '',
      lines: columns[4] || '',
      risk: columns[5] || 'medium',
      howToTrigger: columns[6] || '',
      suggestedFix: columns[7] || '',
      confidence: columns[8] || 'Medium'
    };
    
    defects.push(defect);
  }
  
  return defects;
}

/**
 * Parse list format defect detection results
 * @param {string} response - AI response
 * @param {string} filePath - File path
 * @returns {DefectDetectionResult[]} - List of parsed defects
 */
function parseListFormatDefects(response, filePath) {
  const defects = [];
  const validCategories = ['AUTO', 'ARRAY', 'MEMF', 'LEAK', 'OSRES', 'STL', 'DEPR', 'PERF', 'CLASS', 'COMPILE', 'SECURITY', 'SEQ', 'INITORD'];
  
  // Find defect block pattern: #### 缺陷 (第X行) or similar format
  const defectBlocks = response.split(/####?\s*缺陷\s*\([^)]+\)/gi);
  
  for (let i = 1; i < defectBlocks.length; i++) {
    const block = defectBlocks[i];
    
    // Extract type
    const typeMatch = block.match(/\*\*类型\*\*:\s*([^\n]+)/i);
    const category = typeMatch ? typeMatch[1].trim() : '';
    
    // Validate category validity
    if (!validCategories.includes(category) || isPlaceholderContent([category])) {
      continue;
    }
    
    // Extract description
    const descMatch = block.match(/\*\*描述\*\*:\s*([^\n]+)/i);
    const description = descMatch ? descMatch[1].trim() : '';
    
    // Extract code snippet
    const codeMatch = block.match(/\*\*代码\*\*:\s*`([^`]+)`/i);
    const snippet = codeMatch ? codeMatch[1].trim() : '';
    
    // Extract suggestion
    const fixMatch = block.match(/\*\*建议\*\*:\s*([^\n]+)/i);
    const suggestedFix = fixMatch ? fixMatch[1].trim() : '';
    
    // Extract severity
    const severityMatch = block.match(/\*\*严重程度\*\*:\s*([^\n]+)/i);
    const risk = severityMatch ? severityMatch[1].trim() : 'medium';
    
    // Extract line number information from description (e.g., "L16 - 构造函数未定义")
    let lines = '';
    const lineMatch = description.match(/L(\d+)(?:-L(\d+))?/);
    if (lineMatch) {
      if (lineMatch[2]) {
        lines = `L${lineMatch[1]}-L${lineMatch[2]}`;
      } else {
        lines = `L${lineMatch[1]}`;
      }
    }

    // Validate content validity
    if (description && snippet && suggestedFix && 
        !isPlaceholderContent([description, snippet, suggestedFix])) {
      defects.push({
        category: category,
        file: filePath,
        function: '', // List format may not have function name
        snippet: snippet,
        lines: lines,
        risk: risk,
        howToTrigger: description,
        suggestedFix: suggestedFix,
        confidence: 'Medium'
      });
    }
  }
  
  return defects;
}

/**
 * Check if content is placeholder
 * @param {string[]} values - Values to check
 * @returns {boolean} - True if any value is placeholder
 */
function mapMarkdownIssueToCategory(title = '', content = '') {
  const text = `${title} ${content}`.toLowerCase();

  if (/uninitiali[sz]ed|未初始化|未赋值/.test(text)) return 'AUTO';
  if (/array|out of bounds|越界|下标/.test(text)) return 'ARRAY';
  if (/memory leak|leak|泄漏/.test(text)) return 'LEAK';
  if (/null pointer|dereference|null|空指针|野指针/.test(text)) return 'MEMF';
  if (/resource|句柄|fd|socket|资源/.test(text)) return 'OSRES';
  if (/stl|vector|map|unordered/.test(text)) return 'STL';
  if (/deprecat|废弃/.test(text)) return 'DEPR';
  if (/performance|perf|slow|低效|性能/.test(text)) return 'PERF';

  return 'CLASS';
}

function parseStructuredMarkdownDefects(response, filePath) {
  const defects = [];

  // Match sections like: #### A. Memory Leak / Resource Management
  const issueHeaderRegex = /^####\s*(?:[A-Z]\.)?\s*(.+)$/gim;
  const headers = Array.from(response.matchAll(issueHeaderRegex));

  if (!headers.length) {
    return defects;
  }

  for (let i = 0; i < headers.length; i++) {
    const fullMatch = headers[i][0];
    const title = (headers[i][1] || '').trim();
    const start = headers[i].index + fullMatch.length;
    const end = i + 1 < headers.length ? headers[i + 1].index : response.length;
    const block = response.slice(start, end).trim();

    if (!block || /no defects found|未发现缺陷|没有发现缺陷/i.test(block)) {
      continue;
    }

    const locationMatch = block.match(/(?:\*\s*)?\*\*?(?:Location|位置)\*\*?\s*:\s*`?([^`\n]+)`?/i);
    const riskMatch = block.match(/(?:\*\s*)?\*\*?(?:Risk|严重程度|风险)\*\*?\s*:\s*([^\n]+)/i);
    const lineMatch = block.match(/L\d+(?:\s*[-–]\s*L?\d+)?/i);
    const codeMatch = block.match(/`([^`]{2,200})`/);

    // Description: first non-empty non-bullet line
    const description = (block.split('\n').map(line => line.trim()).find(line => line && !line.startsWith('*')) || title).slice(0, 400);

    const category = mapMarkdownIssueToCategory(title, block);
    const riskRaw = (riskMatch?.[1] || 'Medium').trim();
    const risk = /high|严重|高/i.test(riskRaw)
      ? 'high'
      : /low|低/i.test(riskRaw)
        ? 'low'
        : 'medium';

    const lines = lineMatch ? lineMatch[0].replace(/\s+/g, '') : '';
    const functionOrLocation = (locationMatch?.[1] || '').trim();
    const snippet = (codeMatch?.[1] || title).trim();

    if (isPlaceholderContent([title, description, snippet])) {
      continue;
    }

    defects.push({
      category,
      file: filePath,
      function: functionOrLocation,
      snippet,
      lines,
      risk,
      howToTrigger: `${title} - ${description}`,
      suggestedFix: `请按“${title}”问题修复，并补充边界与空值防护。`,
      confidence: /high|严重|高/i.test(riskRaw) ? 'High' : /low|低/i.test(riskRaw) ? 'Low' : 'Medium'
    });
  }

  return defects;
}

function isPlaceholderContent(values) {
  const placeholders = ['----------', '-------', '------', '-----------------', '--------------', '-', ''];
  return values.some(value => placeholders.includes(value) || value.includes('---'));
}

/**
 * Parse relaxed format defect detection results
 * @param {string} response - AI response
 * @param {string} filePath - File path
 * @returns {DefectDetectionResult[]} - List of parsed defects
 */
function parseLooseFormatDefects(response, filePath) {
  const defects = [];
  const validCategories = ['AUTO', 'ARRAY', 'MEMF', 'LEAK', 'OSRES', 'STL', 'DEPR', 'PERF', 'CLASS', 'COMPILE', 'SECURITY', 'SEQ', 'INITORD'];
  
  // Find all possible defect description patterns
  const defectPatterns = [
    // Pattern 1: [Category] Description (Line number)
    /\[([A-Z]+)\]\s*([^(]+)\s*\((L\d+(?:-L\d+)?)\)/g,
    // Pattern 2: Category: Description
    /([A-Z]+):\s*([^\n]+)/g,
    // Pattern 3: 缺陷类型: Description
    /缺陷类型:\s*([A-Z]+)[^\n]*\n[^\n]*描述:\s*([^\n]+)/g
  ];
  
  for (const pattern of defectPatterns) {
    const matches = response.matchAll(pattern);
    for (const match of matches) {
      let category = '';
      let description = '';
      let lines = '';
      
      if (pattern.source.includes('(L\d+)')) {
        // Pattern 1: [Category] Description (Line number)
        category = match[1];
        description = match[2].trim();
        lines = match[3];
      } else if (pattern.source.includes('缺陷类型')) {
        // Pattern 3: 缺陷类型: Description
        category = match[1];
        description = match[2].trim();
      } else {
        // Pattern 2: Category: Description
        category = match[1];
        description = match[2].trim();
      }
      
      // Validate category validity
      if (!validCategories.includes(category) || isPlaceholderContent([category, description])) {
        continue;
      }
      
      // Extract code snippet from description (if any)
      let snippet = '';
      const codeMatch = description.match(/`([^`]+)`/);
      if (codeMatch) {
        snippet = codeMatch[1];
      }
      
      defects.push({
        category: category,
        file: filePath,
        function: '',
        snippet: snippet || description.substring(0, 100), // Use first 100 chars of description as snippet
        lines: lines,
        risk: 'medium',
        howToTrigger: description,
        suggestedFix: '请参考相关文档进行修复',
        confidence: 'Low'
      });
    }
  }
  
  return defects;
}

/**
 * Batch detect defects in files
 * @param {Object[]} files - Files to analyze
 * @param {FileSystemDirectoryHandle} [directoryHandle] - Directory handle
 * @param {Function} [onProgress] - Progress callback
 * @param {string} projectType - Project type ('ue_cpp' or 'ue_blueprint')
 * @returns {Promise<CodeDetectionReport>} - Detection report
 */
export async function detectDefectsInFiles(files, directoryHandle, onProgress, projectType) {
  // Validate required parameters
  if (!projectType) {
    throw new Error('Project type is required for batch detection');
  }

  const report = {
    id: generateReportId(),
    timestamp: Date.now(),
    filesScanned: files.length,
    defectsFound: 0,
    defects: [],
    projectType: projectType,
    summary: (projectType === 'ue_cpp' || projectType === 'cpp') ? {
      auto: 0,
      array: 0,
      memf: 0,
      leak: 0,
      osres: 0,
      stl: 0,
      depr: 0,
      perf: 0,
      class: 0,
      compile: 0,
      security: 0,
      seq: 0,
      initord: 0
    } : {
      null: 0,
      tick: 0,
      loop: 0,
      array: 0,
      event: 0,
      cast: 0,
      ref: 0,
      replicate: 0,
      interface: 0,
      resource: 0,
      init: 0,
      anim: 0,
      ui: 0,
      compile: 0
    }
  };

  serverLog?.info(`开始检测 ${files.length} 个文件的缺陷... (项目类型: ${projectType})`);
  
  // Batch detection to avoid sending too many requests at once
  const batchSize = 3; // Detect 3 files at a time
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    
    serverLog?.info(`开始检测批次 ${Math.floor(i / batchSize) + 1}，文件 ${i + 1}-${Math.min(i + batchSize, files.length)}`);
    
    // Detect files in batch in parallel, each file has independent error handling
    const batchPromises = batch.map(async (file) => {
      try {
        // Call progress callback
        if (onProgress) {
          onProgress(i + batch.indexOf(file), file.name);
        }
        
        serverLog?.info(`  开始检测文件 ${i + batch.indexOf(file) + 1}/${files.length}: ${file.name}`);
        const result = await detectDefectsInFile(file, directoryHandle, projectType);
        serverLog?.info(`  完成检测文件 ${i + batch.indexOf(file) + 1}/${files.length}: ${file.name}，发现 ${result.length} 个缺陷`);
        return result;
      } catch (error) {
        serverLog?.error(`  检测文件 ${file.name} 失败:`, error);
        return []; // Return empty result, continue processing other files
      }
    });
    
    // Use Promise.allSettled instead of Promise.all to ensure all promises complete
    const batchResults = await Promise.allSettled(batchPromises);
    
    serverLog?.info(`批次 ${Math.floor(i / batchSize) + 1} 检测完成`);
    
    // Merge results (handle Promise.allSettled results)
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        // 🔧 B: 汇总前去重（与单文件去重叠加，根除跨文件/同组重复），再统计
        const fileDefects = deduplicateDefects(result.value);
        report.defects.push(...fileDefects);

        // Update statistics
        for (const defect of fileDefects) {
          report.defectsFound++;

          // Count by category
          const category = defect.category.toLowerCase();
          if (category in report.summary) {
            report.summary[category]++;
          }
        }
      } else {
        serverLog?.error(`批次中某个文件检测失败:`, result.reason);
      }
    }
    
    serverLog?.info(`已完成 ${Math.min(i + batchSize, files.length)}/${files.length} 个文件的检测`);
  }

  serverLog?.info(`检测完成，共发现 ${report.defectsFound} 个缺陷`);
  return report;
}

/**
 * Generate report ID
 * @returns {string} - Report ID
 */
function generateReportId() {
  return `report_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Detect defects by groups
 * @param {Object[]} groups - File groups
 * @param {Object[]} rootFiles - Root files
 * @param {FileSystemDirectoryHandle} directoryHandle - Directory handle
 * @param {Function} [onReportSaved] - Callback after report is saved
 * @returns {Promise<GroupDetectionReport[]>} - Group detection reports
 */
export async function detectDefectsByGroups(groups, rootFiles, directoryHandle, onReportSaved) {
  const reports = [];
  
  // Dynamically import report generation service
  const { reportGenerationService } = await import('./reportGenerationService.js');
  
  // Calculate total files and total groups
  const totalFiles = groups.reduce((sum, g) => sum + g.files.length, 0) + rootFiles.length;
  const totalGroups = groups.length + (rootFiles.length > 0 ? 1 : 0);
  let processedFiles = 0;
  
  // Send to server console
  serverLog?.info('');
  serverLog?.info('=== 开始分组检测 ===');
  serverLog?.info(`总分组数: ${totalGroups}`);
  serverLog?.info(`总文件数: ${totalFiles}`);
  serverLog?.info('');
  
  // 1. Detect each group
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    
    // Group start - send to server
    serverLog?.info(`[分组 ${i + 1}/${totalGroups}] ${group.name} (${group.files.length}个文件)`);
    
    const report = await detectDefectsInFiles(
      group.files, 
      directoryHandle,
      () => {
        processedFiles++;
        // File-level progress - no output, silent processing
      }
    );
    
    const groupReport = {
      ...report,
      groupName: group.name,
      groupPath: group.path
    };
    
    reports.push(groupReport);
    
    // Group complete - send to server
    serverLog?.info(`  ✓ 分组 ${group.name} 检测完成，发现 ${report.defectsFound} 个缺陷`);
    
    // Immediately save and download current group report
    await saveAndDownloadGroupReport(groupReport, directoryHandle, reportGenerationService);
    
    // Trigger callback to notify UI to update history
    if (onReportSaved) {
      onReportSaved();
    }
    
    // Add delay to ensure download completes
    if (i < groups.length - 1 || rootFiles.length > 0) {
      serverLog?.info(`  ⏳ 等待 2 秒后继续...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    serverLog?.info('');
  }
  
  // 2. Detect root directory scattered files
  if (rootFiles.length > 0) {
    // Group start - send to server
    serverLog?.info(`[分组 ${totalGroups}/${totalGroups}] root (${rootFiles.length}个文件)`);
    
    const rootReport = await detectDefectsInFiles(
      rootFiles, 
      directoryHandle,
      () => {
        processedFiles++;
        // File-level progress - no output, silent processing
      }
    );
    
    const groupReport = {
      ...rootReport,
      groupName: 'root',
      groupPath: '.'
    };
    
    reports.push(groupReport);
    
    // Group complete - send to server
    serverLog?.info(`  ✓ 根目录检测完成，发现 ${rootReport.defectsFound} 个缺陷`);
    
    // Immediately save and download root directory report
    await saveAndDownloadGroupReport(groupReport, directoryHandle, reportGenerationService);
    
    // Trigger callback to notify UI to update history
    if (onReportSaved) {
      onReportSaved();
    }
    
    serverLog?.info('');
  }
  
  // Detection complete - send to server
  serverLog?.info('=== 检测完成 ===');
  serverLog?.info(`总进度: ${processedFiles}/${totalFiles} (100%)`);
  serverLog?.info(`生成报告数: ${reports.length}`);
  
  // Try to close window or exit program
  console.log('检测完成，尝试关闭程序...');
  if (typeof window !== 'undefined') {
    // Browser environment: try to close window
    setTimeout(() => {
      window.close();
    }, 500);
  } else if (typeof process !== 'undefined' && process.exit) {
    // Node.js environment: force exit process
    setTimeout(() => {
      process.exit(0);
    }, 500);
  }
  
  return reports;
}

/**
 * Save and download single group report
 * @param {GroupDetectionReport} report - Group report
 * @param {FileSystemDirectoryHandle} directoryHandle - Directory handle
 * @param {Object} reportGenerationService - Report generation service
 * @returns {Promise<void>}
 */
async function saveAndDownloadGroupReport(report, directoryHandle, reportGenerationService) {
  const fileName = `${report.groupName.toLowerCase()}.csv`;
  
  serverLog?.info(`  📝 保存报告: ${fileName}`);
  
  // Convert to DetectionReport format
  const detectionReport = reportGenerationService.convertCodeDetectionReport(report);
  
  // 1. Save to localStorage (display in history)
  reportGenerationService.saveReport(detectionReport);
  serverLog?.info(`  ✓ 已保存到历史记录`);
  
  // 2. Download report file (using group name, CSV format)
  await reportGenerationService.downloadReport(detectionReport, report.groupName);
  serverLog?.info(`  ✓ 已触发下载: ${fileName}`);
  
  // 3. Wait long enough to ensure download completes
  await new Promise(resolve => setTimeout(resolve, 500));
}


// Export default
export default { initializeServices, detectDefectsInFile, detectDefectsInFiles, detectDefectsByGroups };

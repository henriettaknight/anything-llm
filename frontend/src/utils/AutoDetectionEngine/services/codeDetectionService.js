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
 */

/**
 * @typedef {CodeDetectionReport & {groupName: string, groupPath: string}} GroupDetectionReport
 */

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
 * Get UE static defect detection system prompt
 * @param {string} projectType - Project type ('ue_cpp' or 'ue_blueprint')
 * @returns {Promise<string>} - System prompt
 */
async function getUEDefectDetectionPrompt(projectType) {
  // Validate projectType
  if (!projectType || !['ue_cpp', 'ue_blueprint'].includes(projectType)) {
    throw new Error(`Invalid project type: ${projectType}. Must be 'ue_cpp' or 'ue_blueprint'`);
  }

  try {
    // Detect user language
    const userLang = detectUserLanguage();
    
    serverLog?.info(`📝 尝试从 API 获取提示词... 项目类型: ${projectType}, 语言: ${userLang}`);
    const response = await fetch(`/api/prompts/ue-static-defect?type=${projectType}&lang=${userLang}`);
    
    if (response.ok) {
      const prompt = await response.text();
      const promptFile = projectType === 'ue_cpp' 
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
    serverLog?.error('❌ 从 API 获取提示词失败:', error);
    throw error;
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

## 缺陷类别与检测要点
- AUTO（未初始化/未赋值使用）：局部变量/成员在使用前未赋值
- ARRAY（越界/无效访问）：TArray/Std容器固定下标访问未判空
- MEMF（内存释放后继续使用）：delete后访问、悬垂引用/指针
- LEAK（资源/内存泄漏）：new未释放、UObject未UPROPERTY持有
- OSRES（系统资源管理）：文件/句柄/存档未关闭
- STL（不安全STL模式）：遍历中erase误用、循环中频繁分配
- DEPR（废弃API）：UE/项目标记为Deprecated的调用
- PERF（性能反模式）：大对象按值传参、热路径频繁分配
- CLASS（构造/初始化规范）：复杂成员未在构造函数初始化

## 严格格式要求（必须遵守）

### 输出格式要求
- **必须**使用Markdown表格格式输出结果
- **必须**包含表头：| No | Category | File | Function/Symbol | Snippet | Lines | Risk | HowToTrigger | SuggestedFix | Confidence |
- **必须**使用正确的分隔符：| 和 - 符号
- **禁止**使用列表格式（如#### 缺陷）
- **禁止**使用占位符内容（如----------、-------、------等）
- **禁止**虚构或猜测缺陷内容

### 表格格式示例
| No | Category | File | Function/Symbol | Snippet | Lines | Risk | HowToTrigger | SuggestedFix | Confidence |
|----|----------|------|-----------------|---------|-------|------|--------------|--------------|------------|
| 1 | AUTO | Player/LyraPlayerState.cpp | ComputeRank_Helper | int32 Bonus; return Base + Bonus; | L123–L124 | 未初始化使用 | 直接调用时 | 为Bonus赋初值或分支全覆盖 | High |

### 内容质量要求
- **必须**基于实际代码分析，有明确的代码依据
- **必须**提供具体的行号或代码片段
- **必须**提供可操作的修复建议
- **禁止**报告第0行的缺陷（行号从1开始）
- **禁止**使用通用或模糊的描述

请严格遵守以上格式要求，任何格式错误都将导致解析失败。`;
}

/**
 * Find paired implementation file (.h -> .cpp)
 * @param {Object} headerFile - Header file info
 * @param {FileSystemDirectoryHandle} directoryHandle - Directory handle
 * @returns {Promise<{content: string, path: string}|null>} - Paired file or null
 */
async function findPairedImplementationFile(headerFile, directoryHandle) {
  const baseName = headerFile.name.substring(0, headerFile.name.lastIndexOf('.'));
  const possibleExtensions = ['.cpp', '.cc', '.cxx'];
  
  for (const ext of possibleExtensions) {
    const implFileName = baseName + ext;
    
    try {
      const dirPath = headerFile.path.substring(0, headerFile.path.lastIndexOf('/'));
      const implPath = dirPath ? `${dirPath}/${implFileName}` : implFileName;
      
      const implFileInfo = {
        path: implPath,
        name: implFileName,
        lastModified: Date.now(),
        size: 0,
        isDirectory: false
      };
      
      const content = await getFileContent(implFileInfo, directoryHandle);
      if (content) {
        serverLog?.info(`✓ 找到配对的实现文件: ${implFileName}，长度: ${content.length} 字符`);
        return { content, path: implPath };
      }
    } catch {
      // Continue trying next extension
    }
  }
  
  serverLog?.info(`未找到配对的实现文件（尝试了 ${possibleExtensions.join(', ')}）`);
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
    if (projectType === 'ue_cpp' && fileInfo.name.endsWith('.h') && directoryHandle) {
      pairedFile = await findPairedImplementationFile(fileInfo, directoryHandle);
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
${content}
\`\`\`

**实现文件：${pairedFile.path}**
文件大小：${pairedFile.content.length} 字符

\`\`\`cpp
${pairedFile.content}
\`\`\`

**重要提示：**
- 这是配对的头文件和实现文件，请一起分析
- 检查成员变量时，请查看构造函数（在实现文件中）是否已初始化
- 只报告真正未初始化的成员变量，不要报告已在构造函数中初始化的变量

请按照指定的缺陷类别进行检测，并以Markdown表格格式输出结果。`;
      } else {
        userMessage = `Please perform static defect detection on the following C++ code files:

**Header file: ${fileInfo.path}**
File size: ${content.length} characters

\`\`\`cpp
${content}
\`\`\`

**Implementation file: ${pairedFile.path}**
File size: ${pairedFile.content.length} characters

\`\`\`cpp
${pairedFile.content}
\`\`\`

**Important notes:**
- These are paired header and implementation files, please analyze them together
- When checking member variables, please check if they are initialized in the constructor (in the implementation file)
- Only report truly uninitialized member variables, do not report variables already initialized in the constructor

Please detect defects according to the specified categories and output the results in Markdown table format.`;
      }
    } else {
      // Analyze separately
      if (userLang === 'zh') {
        userMessage = `请对以下C++代码文件进行静态缺陷检测：

文件路径：${fileInfo.path}
文件大小：${content.length} 字符

代码内容：
\`\`\`cpp
${content}
\`\`\`

请按照指定的缺陷类别进行检测，并以Markdown表格格式输出结果。`;
      } else {
        userMessage = `Please perform static defect detection on the following C++ code file:

File path: ${fileInfo.path}
File size: ${content.length} characters

Code content:
\`\`\`cpp
${content}
\`\`\`

Please detect defects according to the specified categories and output the results in Markdown table format.`;
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

    // Use non-streaming mode for accurate token statistics
    const timeout = 300000; // 300 seconds
    let responseContent = '';
    let tokenUsage = null;
    let abortController = null;
    let timeoutId = null;
    let detectionError = null;
    
    try {
      abortController = new AbortController();
      
      const detectionPromise = (async () => {
        try {
          // Use non-streaming chat method
          const result = await codeReviewAIService.adapter.chat(messageHistory, {
            signal: abortController.signal
          });
          
          responseContent = result.content || result.fullText || '';
          tokenUsage = result.usage;
          
          return responseContent;
        } catch (streamError) {
          console.error('Error during detection:', streamError);
          throw streamError;
        }
      })();
      
      // Use Promise.race to implement timeout
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          abortController?.abort();
          reject(new Error('AI检测超时'));
        }, timeout);
      });
      
      responseContent = await Promise.race([detectionPromise, timeoutPromise]);
      
      // Clear timeout timer
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      
      const totalTime = Date.now() - detectionStartTime;
      console.log(`✅ AI 响应完成，总耗时: ${Math.floor(totalTime / 1000)}秒`);
      
      console.log('\n' + '📊'.repeat(40));
      console.log('✅ AI Response Received:');
      console.log('  - Total length:', responseContent.length, 'characters');
      console.log('  - First 800 chars:', responseContent.substring(0, 800));
      console.log('  - Last 300 chars:', responseContent.substring(responseContent.length - 300));
      console.log('📊'.repeat(40));
      console.log('🧾 FULL AI RESPONSE START');
      console.log(responseContent);
      console.log('🧾 FULL AI RESPONSE END\n');
      
      serverLog?.info(`AI响应内容(完整):\n${responseContent}`);
      serverLog?.info(`AI响应总长度: ${responseContent.length} 字符`);
      
      // 🔧 成功时记录token统计
      recordTokenStatisticsOnSuccess(
        fileInfo,
        tokenUsage,
        systemPrompt,
        userMessage,
        responseContent,
        moduleName,
        totalTime,
        lineStats
      );
      
    } catch (error) {
      detectionError = error;
      const totalTime = Date.now() - detectionStartTime;
      
      if (error instanceof Error && error.message === 'AI检测超时') {
        serverLog?.error(`文件 ${fileInfo.name} 检测超时（超过${timeout/1000}秒），跳过此文件`);
      } else {
        serverLog?.error(`文件 ${fileInfo.name} 检测出错:`, error);
      }
      
      // 🔧 失败时也记录token统计（使用估算）
      recordTokenStatisticsOnFailure(
        fileInfo,
        detectionStartTime,
        error.message,
        systemPrompt,
        userMessage,
        moduleName,
        lineStats
      );
      
      // Abort stream
      abortController?.abort();
      // Clear timeout timer
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      return [];
    }

    // Parse detection results
    const defects = parseDefectDetectionResults(responseContent, fileInfo.path);
    serverLog?.info(`文件 ${fileInfo.name} 检测完成，发现 ${defects.length} 个缺陷`);
    
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
 * Parse AI returned defect detection results (using relaxed static detection parsing logic)
 * @param {string} response - AI response
 * @param {string} filePath - File path
 * @returns {DefectDetectionResult[]} - List of parsed defects
 */
function parseDefectDetectionResults(response, filePath) {
  const defects = [];
  
  console.log('\n' + '🔧'.repeat(40));
  console.log('🔧 Starting to parse AI response:');
  console.log('  - Response length:', response.length);
  console.log('  - File path:', filePath);
  
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
        const validCategories = ['AUTO', 'ARRAY', 'MEMF', 'LEAK', 'OSRES', 'STL', 'DEPR', 'PERF', 'CLASS'];
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
 * Parse Chinese table format defect detection results (fallback for when LLM doesn't follow English requirement)
 * @param {string} response - AI response
 * @param {string} filePath - File path
 * @returns {DefectDetectionResult[]} - List of parsed defects
 */
function parseChineseTableFormat(response, filePath) {
  const defects = [];
  const validCategories = ['AUTO', 'ARRAY', 'MEMF', 'LEAK', 'OSRES', 'STL', 'DEPR', 'PERF', 'CLASS'];
  
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
  const validCategories = ['AUTO', 'ARRAY', 'MEMF', 'LEAK', 'OSRES', 'STL', 'DEPR', 'PERF', 'CLASS'];
  
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
  const validCategories = ['AUTO', 'ARRAY', 'MEMF', 'LEAK', 'OSRES', 'STL', 'DEPR', 'PERF', 'CLASS'];
  
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
    summary: projectType === 'ue_cpp' ? {
      auto: 0,
      array: 0,
      memf: 0,
      leak: 0,
      osres: 0,
      stl: 0,
      depr: 0,
      perf: 0,
      class: 0
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
        const fileDefects = result.value;
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

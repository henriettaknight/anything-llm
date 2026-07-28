/**
 * @fileoverview Chunk Context Builder
 * 为大文件分块送审拼装"块级"提示词上下文：系统提示复用现有缺陷检测提示，
 * 用户提示额外携带分块信息（块在原始文件中的绝对行号范围、整体规模、XLINE/XFUNC 用法），
 * 让模型在分块场景下仍输出带真实绝对行号的缺陷。
 */

import { getUEDefectDetectionPrompt } from '../services/codeDetectionService.js';
import { detectUserLanguage } from '../utils/languageDetector.js';

/**
 * 获取分块送审使用的系统提示（与整文件检测保持一致，确保缺陷类目一致）。
 * @param {string} projectType 项目类型（ue_cpp / cpp / ...）
 * @returns {Promise<string>}
 */
export async function buildChunkSystemPrompt(projectType) {
  return getUEDefectDetectionPrompt(projectType);
}

/**
 * 拼装分块送审的用户提示（含块级上下文与分块专用约束）。
 * @param {Object} params
 * @param {string} params.filePath 文件相对路径
 * @param {string} params.pureName 文件名
 * @param {string} params.slice 已带绝对行号前缀的块内容（L{行号}: 代码）
 * @param {number} params.startLine 块在原始文件中的起始绝对行号
 * @param {number} params.endLine 块在原始文件中的结束绝对行号
 * @param {number} params.totalLines 原始文件总行数
 * @param {string} [params.extension] 文件后缀
 * @returns {string}
 */
export function buildChunkUserMessage({ filePath, pureName, slice, startLine, endLine, totalLines, extension }) {
  const userLang = detectUserLanguage();
  const ext = extension ? `.${String(extension).replace(/^\./, '')}` : '';
  if (userLang === 'zh') {
    return `请对以下 C++ 代码文件的「一个连续片段」做静态缺陷检测（这是大文件分块送审中的第 ${startLine}-${endLine} 行片段，整体文件约 ${totalLines} 行）：

文件名：${pureName}
文件路径：${filePath}
片段范围：第 ${startLine} - ${endLine} 行（每行已标注该文件**原始绝对行号**前缀）
文件后缀：${ext || '未知'}

代码内容（片段，每行已标注原始绝对行号）：
\`\`\`cpp
${slice}
\`\`\`

**分块送审专用要求：**
- 你看到的 \`L{n}:\` 就是该文件**原始绝对行号**，**直接照抄到 \`lines\`**（如 "L120" 或 "L118-L125"），不要重新计数或偏移。
- 行号必须是代码块中"真实存在且唯一"的候选行号；若实在无法确定精确行号，可在缺陷对象中额外给出可选字段 \`xline\`（单个候选绝对行号）作为回退；若 \`function\` 为空，可额外给出 \`xfunc\`（所在函数/类名，优先取最外层函数/类）。
- 只按现有缺陷类别检测，**严格以 JSON 数组输出**：no、category、file、function、snippet、lines、risk、howToTrigger、suggestedFix、confidence。**只输出 JSON，不要返回 Markdown 或其他说明。**
- \`snippet\` 只写纯净代码，不要带 \`L{n}:\` 行号前缀。
- \`file\` 填相对路径；\`lines\` 必须对应 \`file\` 在原始文件中的真实行号。
- 推荐单次送审目标约 600-700 行，本片段已控制在此范围内。`;
  }
  return `Please perform static defect detection on a **contiguous slice** of the C++ file below (this is slice lines ${startLine}-${endLine} of a large file, total ~${totalLines} lines):

File name: ${pureName}
File path: ${filePath}
Slice range: lines ${startLine} - ${endLine} (each line prefixed with its **original absolute line number**)
Extension: ${ext || 'unknown'}

Code content (slice, each line prefixed with its absolute line number):
\`\`\`cpp
${slice}
\`\`\`

**Chunk-specific requirements:**
- The \`L{n}:\` prefixes ARE the original absolute line numbers; **copy them directly into \`lines\`** (e.g. "L120" or "L118-L125"); do not re-number or offset.
- The line number must be a line that actually exists and is unique in the block. If you are unsure of an exact line number, you may add an optional field \`xline\` (a single candidate absolute line number) as fallback; if \`function\` is empty, add an optional field \`xfunc\` (enclosing function/class name, prefer the top-level function/class).
- Detect by the existing categories and **output strictly a JSON array**: no, category, file, function, snippet, lines, risk, howToTrigger, suggestedFix, confidence. **No Markdown or extra text.**
- \`snippet\` must be pure code, without the \`L{n}:\` prefix.
- \`file\` is the relative path; \`lines\` must correspond to the real line numbers of \`file\` in the original file.
- Recommended single-pass target is ~600-700 lines; this slice is kept within that range.`;
}

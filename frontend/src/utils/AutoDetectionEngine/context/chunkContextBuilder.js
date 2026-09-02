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
 * @param {string} [params.headerSkeleton] 配对头文件的声明骨架（仅供类型判断，不参与检测）
 * @param {string} [params.headerPath] 该骨架来源的头文件路径
 * @param {string} [params.fileStructureSkeleton] 当前被分块文件自身的结构骨架（namespace/类开闭行号范围表，方案4）
 * @param {string} [params.currentScope] 当前块主要所处的类/命名空间名称（方案4，帮助模型关联跨块类定义）
 * @returns {string}
 */
export function buildChunkUserMessage({ filePath, pureName, slice, startLine, endLine, totalLines, extension, headerSkeleton, headerPath, fileStructureSkeleton, currentScope, projectType }) {
  const userLang = detectUserLanguage();
  const ext = extension ? `.${String(extension).replace(/^\./, '')}` : '';
  const hasSkeleton = !!(headerSkeleton && String(headerSkeleton).trim());

  // 声明骨架区块：置于代码块之前，帮助模型确定成员变量的**真实类型**
  // （如自研容器 TArrayPod 而非 std::vector），避免"看不到声明就臆断标准容器"的 COMPILE 误报。
  const skeletonBlockZh = hasSkeleton
    ? `\n【头文件声明骨架（供类型判断，不检测此部分）】${headerPath ? `\n来源：${headerPath}` : ''}
\`\`\`cpp
${headerSkeleton}
\`\`\`
`
    : '';
  const skeletonBlockEn = hasSkeleton
    ? `\n[Header declaration skeleton (for type reference only, DO NOT report defects here)]${headerPath ? `\nSource: ${headerPath}` : ''}
\`\`\`cpp
${headerSkeleton}
\`\`\`
`
    : '';
  const skeletonRulesZh = hasSkeleton
    ? `
- **上方「头文件声明骨架」仅用于确定成员变量/方法的真实类型**（例如据此可知某成员是自研容器而非 \`std::vector\`）；**不得对骨架内容报告任何缺陷**，骨架是被裁剪过的声明摘要，其"不完整"不是缺陷。
- **骨架没有 \`L{n}:\` 行号前缀，不得作为 \`lines\` 的来源**，也不得为其编造行号；所有缺陷必须来自下方「代码内容」片段。`
    : '';
  const skeletonRulesEn = hasSkeleton
    ? `
- **The header skeleton above is ONLY for determining the real types** of members/methods (e.g. a member may be a custom container rather than \`std::vector\`); **do NOT report any defect inside the skeleton** — it is a trimmed declaration summary and its incompleteness is not a defect.
- **The skeleton has no \`L{n}:\` prefixes and must NOT be used as a source for \`lines\`**; never invent line numbers for it. All defects must come from the code slice below.`
    : '';

  // 文件结构骨架区块（方案 4）：列出本文件 namespace/class/struct 的行号范围，
  // 帮助模型在「类定义跨多块」时仍能正确关联类头与类尾、识别当前块的所属作用域。
  const hasStructure = !!(fileStructureSkeleton && String(fileStructureSkeleton).trim());
  const scopeHint = currentScope ? `（本片段主要位于 \`${currentScope}\` 作用域内）` : '';
  const structureBlockZh = hasStructure
    ? `\n【文件结构骨架（作用域范围，仅供关联类/命名空间，不检测）】${scopeHint}
${fileStructureSkeleton}
`
    : '';
  const structureBlockEn = hasStructure
    ? `\n[File structure skeleton (scope ranges, for associating class/namespace only, DO NOT report defects)]${scopeHint}
${fileStructureSkeleton}
`
    : '';
  const structureRulesZh = hasStructure
    ? `
- **上方「文件结构骨架」仅用于确认本片段所属的类/命名空间及其与全局结构的嵌套关系**（例如某个类从第 X 行定义到第 Y 行结束）；**不得对结构骨架报告缺陷**，也不得为其编造行号。若本片段是某个跨多块类定义的中间部分，请结合结构骨架将其视为该类体的一部分。`
    : '';
  const structureRulesEn = hasStructure
    ? `
- **The file structure skeleton above is ONLY for confirming which class/namespace this slice belongs to and its nesting** (e.g. a class is defined from line X to Y); **do NOT report defects against the structure** and never invent line numbers. If this slice is the middle of a class spanning multiple chunks, treat it as part of that class body using the skeleton.`
    : '';

  let userMessage;
  if (userLang === 'zh') {
    userMessage = `请对以下 C++ 代码文件的「一个连续片段」做静态缺陷检测（这是大文件分块送审中的第 ${startLine}-${endLine} 行片段，整体文件约 ${totalLines} 行）：

文件名：${pureName}
文件路径：${filePath}
片段范围：第 ${startLine} - ${endLine} 行（每行已标注该文件**原始绝对行号**前缀）
文件后缀：${ext || '未知'}
${skeletonBlockZh}${structureBlockZh}
代码内容（片段，每行已标注原始绝对行号）：
\`\`\`cpp
${slice}
\`\`\`

**分块送审专用要求：**${skeletonRulesZh}${structureRulesZh}
- 你看到的 \`L{n}:\` 就是该文件**原始绝对行号**，**直接照抄到 \`lines\`**（如 "L120" 或 "L118-L125"），不要重新计数或偏移。
- 行号必须是代码块中"真实存在且唯一"的候选行号；若实在无法确定精确行号，可在缺陷对象中额外给出可选字段 \`xline\`（单个候选绝对行号）作为回退；若 \`function\` 为空，可额外给出 \`xfunc\`（所在函数/类名，优先取最外层函数/类）。
- 只按现有缺陷类别检测，**严格以 JSON 数组输出**：no、category、file、function、snippet、lines、risk、howToTrigger、suggestedFix、confidence。**只输出 JSON，不要返回 Markdown 或其他说明。**
- \`snippet\` 只写纯净代码，不要带 \`L{n}:\` 行号前缀。
- \`file\` 填相对路径；\`lines\` 必须对应 \`file\` 在原始文件中的真实行号。
- 推荐单次送审目标约 600-700 行，本片段已控制在此范围内。`;
  }
  userMessage = `Please perform static defect detection on a **contiguous slice** of the C++ file below (this is slice lines ${startLine}-${endLine} of a large file, total ~${totalLines} lines):

File name: ${pureName}
File path: ${filePath}
Slice range: lines ${startLine} - ${endLine} (each line prefixed with its **original absolute line number**)
Extension: ${ext || 'unknown'}
${skeletonBlockEn}${structureBlockEn}
Code content (slice, each line prefixed with its absolute line number):
\`\`\`cpp
${slice}
\`\`\`

**Chunk-specific requirements:**${skeletonRulesEn}${structureRulesEn}
- The \`L{n}:\` prefixes ARE the original absolute line numbers; **copy them directly into \`lines\`** (e.g. "L120" or "L118-L125"); do not re-number or offset.
- The line number must be a line that actually exists and is unique in the block. If you are unsure of an exact line number, you may add an optional field \`xline\` (a single candidate absolute line number) as fallback; if \`function\` is empty, add an optional field \`xfunc\` (enclosing function/class name, prefer the top-level function/class).
- Detect by the existing categories and **output strictly a JSON array**: no, category, file, function, snippet, lines, risk, howToTrigger, suggestedFix, confidence. **No Markdown or extra text.**
- \`snippet\` must be pure code, without the \`L{n}:\` prefix.
- \`file\` is the relative path; \`lines\` must correspond to the real line numbers of \`file\` in the original file.
- Recommended single-pass target is ~600-700 lines; this slice is kept within that range.`;

  // TS 项目：切换代码块语言与输出契约为 TypeScript 对象格式
  if (projectType === 'ts' || projectType === 'ts_famegame') {
    userMessage = userMessage
      .replace(/```cpp/g, '```typescript')
      .replace(/C\+\+ 代码文件/g, 'TypeScript 代码文件')
      .replace(/C\+\+ file/g, 'TypeScript file')
      .replace(/600-700 行/g, '300-400 行')
      .replace(/JSON 数组输出/g, 'JSON 对象输出（含 summary / issues / improvements / recheck）')
      .replace(/JSON array/g, 'JSON object (summary/issues/improvements/recheck)');
  }
  return userMessage;
}

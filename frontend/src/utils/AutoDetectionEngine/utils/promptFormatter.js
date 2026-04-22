/**
 * Prompt Formatter for Code Review
 * 
 * This module handles loading prompt templates and formatting them
 * for AI code review requests. It also parses AI responses
 * in Markdown table format.
 */

import { detectUserLanguage } from './languageDetector.js';

/**
 * @typedef {Object} DetectionDefect
 * @property {string} no - Defect number
 * @property {string} category - Defect category (AUTO, ARRAY, MEMF, etc.)
 * @property {string} file - File path
 * @property {string} function - Function or symbol name
 * @property {string} snippet - Code snippet
 * @property {string} lines - Line numbers
 * @property {string} risk - Risk description
 * @property {string} howToTrigger - How to trigger the defect
 * @property {string} suggestedFix - Suggested fix
 * @property {string} confidence - Confidence level (High/Medium/Low)
 */

/**
 * Load prompt template from file
 * 
 * @param {string} promptName - Name of the prompt template (e.g., "ue5_cpp_prompt", "ue5_blueprint_prompt")
 * @param {string} [language] - Optional language override ('zh' or 'en'). If not provided, auto-detects from system
 * @returns {Promise<string>} - The prompt template content
 */
export async function loadPromptTemplate(promptName = "ue5_cpp_prompt", language = null) {
  try {
    // Auto-detect language if not provided
    const userLang = language || detectUserLanguage();
    
    // Build prompt file name based on language
    // Chinese: use base name (e.g., "ue5_cpp_prompt.md")
    // English: append "_en" (e.g., "ue5_cpp_prompt_en.md")
    const promptFileName = userLang === 'zh' 
      ? `${promptName}.md`
      : `${promptName}_en.md`;
    
    console.log(`[PromptLoad] loading ${promptFileName} (lang=${userLang})`);
    
    // Try to load the language-specific prompt
    const response = await fetch(
      `/src/utils/AutoDetectionEngine/prompts/${promptFileName}`
    );
    
    if (!response.ok) {
      // If language-specific prompt not found, try fallback to base prompt
      console.warn(`[PromptLoad] ${promptFileName} not found (${response.status}), trying fallback ${promptName}.md`);
      const fallbackResponse = await fetch(
        `/src/utils/AutoDetectionEngine/prompts/${promptName}.md`
      );
      
      if (!fallbackResponse.ok) {
        throw new Error(`Failed to load prompt template: ${fallbackResponse.statusText}`);
      }
      const fallbackText = await fallbackResponse.text();
      console.log(`[PromptLoad] fallback prompt loaded, length=${fallbackText.length}`);
      return fallbackText;
    }
    
    const text = await response.text();
    console.log(`[PromptLoad] prompt loaded, length=${text.length}`);
    return text;
  } catch (error) {
    console.error("[PromptLoad] Error loading prompt template:", error);
    // Return a fallback basic prompt
    const defaultPrompt = getDefaultPrompt();
    console.warn(`[PromptLoad] using default prompt, length=${defaultPrompt.length}`);
    return defaultPrompt;
  }
}

/**
 * Get default prompt template (fallback)
 * 
 * @returns {string} - Default prompt template
 */
function getDefaultPrompt() {
  return `# 对UE5 C++项目进行全面静态缺陷代码检测

## 角色与目标
- 你是资深C++/UE5静态分析专家，精通UE5引擎底层机制与C++标准规范。
- 完全基于当前代码进行逐行体检，确保无遗漏高风险场景。
- 输出一个高信噪比的缺陷报告，给出精准且最小化入侵的修复建议。

## 输出报告格式（请严格遵循）
以 JSON 数组输出，每条缺陷为一个对象，字段如下：
- no: 序号，从1开始递增
- category: AUTO/ARRAY/MEMF/LEAK/OSRES/STL/DEPR/PERF/CLASS/COMPILE
- file: 相对路径
- function: 函数或符号名
- snippet: 简要代码关键行（1-3行，用 \\n 连接多行）
- lines: 行号或范围（如 "L120" 或 "L118-L125"）
- risk: 风险说明
- howToTrigger: 触发/重现条件
- suggestedFix: 最小化入侵修复建议
- confidence: High/Medium/Low

示例（仅输出 JSON 数组，不要输出其他文本）：
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
`;
}

/**
 * Format detection prompt for AI request
 * 
 * @param {string} fileContent - The code file content
 * @param {string} fileName - The file name
 * @param {string} [promptTemplate] - Optional custom prompt template
 * @param {string} [language] - Optional language override
 * @returns {Promise<Array<{role: string, content: string}>>} - Formatted messages
 */
export async function formatDetectionPrompt(
  fileContent,
  fileName,
  promptTemplate = null,
  language = null
) {
  // Auto-detect language if not provided
  const userLang = language || detectUserLanguage();
  
  // Load prompt template if not provided
  const template = promptTemplate || (await loadPromptTemplate("ue5_cpp_prompt", userLang));

  // Create system prompt with template
  const systemPrompt = template;

  // Create user prompt with file content (language-specific)
  const userPrompt = userLang === 'zh' 
    ? `请分析以下代码文件并生成缺陷报告：

文件名：${fileName}

代码内容：
\`\`\`cpp
${fileContent}
\`\`\`

请严格按照上述格式，仅输出 JSON 数组，不要输出 Markdown 表格或额外说明。`
    : `Please analyze the following code file and generate a defect report:

File name: ${fileName}

Code content:
\`\`\`cpp
${fileContent}
\`\`\`

Please strictly follow the format above and output **only** a JSON array, with no Markdown tables or extra text.`;

  return [
    {
      role: "system",
      content: systemPrompt,
    },
    {
      role: "user",
      content: userPrompt,
    },
  ];
}

/**
 * Parse detection results from AI response (prefer JSON; fallback to Markdown table)
 * 
 * @param {string} response - The AI response text
 * @returns {Array<DetectionDefect>} - Parsed defects
 */
export function parseDetectionResults(response) {
  const normalize = (val = '') => (val === undefined || val === null ? '' : String(val));
  const mapItem = (item = {}) => ({
    no: normalize(item.no ?? item.No ?? ''),
    category: normalize(item.category ?? item.Category ?? ''),
    file: normalize(item.file ?? item.File ?? ''),
    function: normalize(item.function ?? item['function/symbol'] ?? item.functionSymbol ?? ''),
    snippet: normalize(item.snippet ?? ''),
    lines: normalize(item.lines ?? ''),
    risk: normalize(item.risk ?? ''),
    howToTrigger: normalize(item.howToTrigger ?? item.how_to_trigger ?? ''),
    suggestedFix: normalize(item.suggestedFix ?? item.suggested_fix ?? item.suggestedfix ?? ''),
    confidence: normalize(item.confidence ?? item.Confidence ?? 'Medium'),
  });

  try {
    let text = (response || '').trim();

    // Strip ```json code fences if present
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (codeBlockMatch) {
      text = codeBlockMatch[1].trim();
    }

    // Locate JSON array boundaries even if wrapped by extra text
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start !== -1 && end !== -1 && end > start) {
      const jsonStr = text.slice(start, end + 1);
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) {
        const normalized = parsed.map(mapItem);
        console.log(`Parsed ${normalized.length} defects from JSON response`);
        const requiredFields = ['category','file','function','snippet','lines','risk','howToTrigger','suggestedFix','confidence'];
        const missing = normalized.filter((d, idx) => requiredFields.some(f => !d[f]));
        if (missing.length > 0) {
          console.warn(`[DetectionValidation] ${missing.length} defects missing required fields; first sample:`, missing[0]);
        }
        return normalized;
      }
    }
  } catch (error) {
    console.error('Failed to parse JSON detection results:', error);
  }

  // Fallback: attempt to parse legacy Markdown table to stay backward compatible
  console.warn('Falling back to Markdown table parsing for detection results');
  return parseMarkdownTable(response);
}

function parseMarkdownTable(response) {
  const defects = [];
  try {
    const lines = (response || '').split('\n');
    let inTable = false;
    let headerPassed = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed.startsWith('|')) {
        if (inTable) break;
        continue;
      }

      if (!inTable) {
        inTable = true;
        continue; // skip header row
      }

      if (!headerPassed) {
        headerPassed = true;
        continue; // skip separator row
      }

      const cells = trimmed
        .split('|')
        .map((cell) => cell.trim())
        .filter((cell) => cell);

      if (cells.length >= 10) {
        defects.push({
          no: cells[0],
          category: cells[1],
          file: cells[2],
          function: cells[3],
          snippet: cells[4],
          lines: cells[5],
          risk: cells[6],
          howToTrigger: cells[7],
          suggestedFix: cells[8],
          confidence: cells[9],
        });
      }
    }
  } catch (error) {
    console.error('Failed to parse markdown table detection results:', error);
  }
  return defects;
}

/**
 * Validate detection results
 * 
 * @param {Array<DetectionDefect>} defects - Parsed defects
 * @returns {{valid: boolean, errors: Array<string>}} - Validation result
 */
export function validateDetectionResults(defects) {
  const errors = [];

  if (!Array.isArray(defects)) {
    errors.push("Results must be an array");
    return { valid: false, errors };
  }

  if (defects.length === 0) {
    // Empty results are valid (no defects found)
    return { valid: true, errors: [] };
  }

  // Validate each defect
  const requiredFields = [
    "category",
    "file",
    "function",
    "lines",
    "risk",
    "suggestedFix",
    "confidence",
  ];

  defects.forEach((defect, index) => {
    for (const field of requiredFields) {
      if (!defect[field] || defect[field].trim() === "") {
        errors.push(
          `Defect ${index + 1}: Missing or empty required field '${field}'`
        );
      }
    }

    // Validate category
    const validCategories = [
      "AUTO",
      "ARRAY",
      "MEMF",
      "LEAK",
      "OSRES",
      "STL",
      "DEPR",
      "PERF",
      "CLASS",
      "COMPILE",
    ];
    if (
      defect.category &&
      !validCategories.includes(defect.category.toUpperCase())
    ) {
      errors.push(
        `Defect ${index + 1}: Invalid category '${defect.category}'`
      );
    }

    // Validate confidence
    const validConfidence = ["HIGH", "MEDIUM", "LOW"];
    if (
      defect.confidence &&
      !validConfidence.includes(defect.confidence.toUpperCase())
    ) {
      errors.push(
        `Defect ${index + 1}: Invalid confidence '${defect.confidence}'`
      );
    }
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Retry detection with error handling
 * 
 * @param {Function} detectionFn - The detection function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} retryDelay - Delay between retries in ms
 * @returns {Promise<any>} - Detection result
 */
export async function retryDetection(
  detectionFn,
  maxRetries = 3,
  retryDelay = 1000
) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Detection attempt ${attempt}/${maxRetries}`);
      const result = await detectionFn();

      // Validate the result
      if (typeof result === "string") {
        const defects = parseDetectionResults(result);
        const validation = validateDetectionResults(defects);

        if (!validation.valid) {
          throw new Error(
            `Invalid detection results: ${validation.errors.join(", ")}`
          );
        }

        return defects;
      }

      return result;
    } catch (error) {
      lastError = error;
      console.error(`Detection attempt ${attempt} failed:`, error);

      if (attempt < maxRetries) {
        console.log(`Retrying in ${retryDelay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        // Exponential backoff
        retryDelay *= 2;
      }
    }
  }

  throw new Error(
    `Detection failed after ${maxRetries} attempts: ${lastError.message}`
  );
}

/**
 * Handle malformed AI responses
 * 
 * @param {string} response - The AI response
 * @returns {string} - Cleaned response
 */
export function cleanAIResponse(response) {
  // Remove code blocks if the entire response is wrapped in one
  let cleaned = response.trim();

  // Remove markdown code block markers
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[\w]*\n/, "").replace(/\n```$/, "");
  }

  // Ensure table formatting is correct
  // Fix common issues like missing pipes or extra spaces
  const lines = cleaned.split("\n");
  const fixedLines = lines.map((line) => {
    if (line.includes("|")) {
      // Ensure line starts and ends with pipe
      let fixed = line.trim();
      if (!fixed.startsWith("|")) fixed = "|" + fixed;
      if (!fixed.endsWith("|")) fixed = fixed + "|";
      return fixed;
    }
    return line;
  });

  return fixedLines.join("\n");
}

/**
 * Extract table from mixed content response
 * 
 * @param {string} response - The AI response
 * @returns {string} - Extracted table
 */
export function extractTableFromResponse(response) {
  const lines = response.split("\n");
  const tableLines = [];
  let inTable = false;

  for (const line of lines) {
    if (line.trim().startsWith("|")) {
      inTable = true;
      tableLines.push(line);
    } else if (inTable && line.trim() === "") {
      // Empty line might indicate end of table
      continue;
    } else if (inTable && !line.trim().startsWith("|")) {
      // Non-table line after table started - end of table
      break;
    }
  }

  return tableLines.join("\n");
}

// Export all functions
export default {
  loadPromptTemplate,
  formatDetectionPrompt,
  parseDetectionResults,
  validateDetectionResults,
  retryDetection,
  cleanAIResponse,
  extractTableFromResponse,
};

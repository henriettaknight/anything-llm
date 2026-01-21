/**
 * Prompt Formatter for Code Detection
 * 
 * This module handles loading prompt templates and formatting them
 * for AI code detection requests. It also parses AI responses
 * in Markdown table format.
 */

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
 * @param {string} promptName - Name of the prompt template
 * @returns {Promise<string>} - The prompt template content
 */
export async function loadPromptTemplate(promptName = "ue5_cpp_prompt") {
  try {
    // In a real implementation, this would fetch from the server or use a bundled file
    // For now, we'll use a dynamic import or fetch
    const response = await fetch(
      `/src/utils/AutoDetectionEngine/prompts/${promptName}.md`
    );
    
    if (!response.ok) {
      throw new Error(`Failed to load prompt template: ${response.statusText}`);
    }
    
    return await response.text();
  } catch (error) {
    console.error("Error loading prompt template:", error);
    // Return a fallback basic prompt
    return getDefaultPrompt();
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
以Markdown表格输出，每条一行，字段如下：
- No：1，2，3递增
- Category: AUTO/ARRAY/MEMF/LEAK/OSRES/STL/DEPR/PERF/CLASS/COMPILE
- File: 相对路径
- Function/Symbol: 函数或符号名
- Snippet: 简要代码关键行
- Lines: 发现位置的行号或范围
- Risk: 风险说明
- HowToTrigger: 触发/重现条件
- SuggestedFix: 最小化入侵修复建议
- Confidence: High/Medium/Low

示例：
| No | Category | File | Function/Symbol | Snippet | Lines | Risk | HowToTrigger | SuggestedFix | Confidence |
|----|----------|------|-----------------|---------|-------|------|--------------|--------------|------------|
| 1 | AUTO | Player/LyraPlayerState.cpp | ComputeRank_Helper | int32 Bonus; return Base + Bonus; | L123–L124 | 未初始化使用 | 直接调用时 | 为Bonus赋初值或分支全覆盖 | High |
`;
}

/**
 * Format detection prompt for AI request
 * 
 * @param {string} fileContent - The code file content
 * @param {string} fileName - The file name
 * @param {string} [promptTemplate] - Optional custom prompt template
 * @returns {Promise<Array<{role: string, content: string}>>} - Formatted messages
 */
export async function formatDetectionPrompt(
  fileContent,
  fileName,
  promptTemplate = null
) {
  // Load prompt template if not provided
  const template = promptTemplate || (await loadPromptTemplate());

  // Create system prompt with template
  const systemPrompt = template;

  // Create user prompt with file content
  const userPrompt = `请分析以下代码文件并生成缺陷报告：

文件名：${fileName}

代码内容：
\`\`\`cpp
${fileContent}
\`\`\`

请严格按照上述格式输出Markdown表格形式的缺陷报告。`;

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
 * Parse detection results from AI response (Markdown table format)
 * 
 * @param {string} response - The AI response text
 * @returns {Array<DetectionDefect>} - Parsed defects
 */
export function parseDetectionResults(response) {
  const defects = [];

  try {
    // Find all table rows in the response
    const lines = response.split("\n");
    let inTable = false;
    let headerPassed = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Check if this is a table row
      if (!trimmed.startsWith("|")) {
        if (inTable) {
          // End of table
          break;
        }
        continue;
      }

      // Start of table
      if (!inTable) {
        inTable = true;
        continue; // Skip header row
      }

      // Skip separator row
      if (!headerPassed) {
        headerPassed = true;
        continue;
      }

      // Parse data row
      const cells = trimmed
        .split("|")
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

    console.log(`Parsed ${defects.length} defects from AI response`);
  } catch (error) {
    console.error("Failed to parse detection results:", error);
    throw new Error(`Failed to parse AI response: ${error.message}`);
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

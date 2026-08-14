// server/utils/translation/promptBuilder.js
//
// 翻译 prompt 拼装。
// 输入：术语表文本 + RAGFlow 检索片段 + 待译原文
// 输出：完整 LLM 系统提示词

const { formatChunksForPrompt } = require("./ragflowClient.js");

const SYSTEM_INSTRUCTION = `你是一个专业的中英翻译助手。
请将【待译原文】翻译为 English，输出纯译文，不要加任何注释、说明、Markdown 标记。
若【术语表】有规定译法，必须严格遵守；【参考翻译记忆】可作风格借鉴，不强制使用。`;

/**
 * @param {Object} opts
 * @param {string} opts.glossaryText - Python wrapper 输出的 glossary 文本
 * @param {Array<{content: string, score: number, source: string}>} opts.chunks - RAGFlow 检索片段
 * @param {string} opts.sourceText - 待译原文
 * @param {string} [opts.targetLang="English"] - 目标语言
 * @returns {string}
 */
function buildTranslationPrompt({
  glossaryText,
  chunks,
  sourceText,
  targetLang = "English",
}) {
  const parts = [SYSTEM_INSTRUCTION];

  if (glossaryText && glossaryText.trim()) {
    parts.push(`【术语表 - 必须严格遵守】\n${glossaryText}`);
  }

  const chunksText = formatChunksForPrompt(chunks || []);
  if (chunksText) {
    parts.push(`【参考翻译记忆 - 风格可借鉴】\n${chunksText}`);
  }

  parts.push(`【待译原文】\n${sourceText}`);
  parts.push(`请翻译为 ${targetLang}，输出纯译文。`);
  return parts.join("\n\n");
}

module.exports = { buildTranslationPrompt };

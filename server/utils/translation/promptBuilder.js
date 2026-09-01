// server/utils/translation/promptBuilder.js
//
// 翻译 prompt 拼装。
//
// 翻译原生化后的职责分工：
//   - 系统指令 → 写入 workspace.openAiPrompt（原生字段，管理员可在 UI 直接编辑）
//   - 本文件   → 只拼「术语表 + 翻译记忆 + 待译原文」，作为用户消息发出
//
// 这样翻译不再自建 LLM 调用通道，直接复用原生 streamChatWithWorkspace，
// 自动获得：provider 自动适配、统一 token 统计、统一落库与流式契约。

const { formatChunksForPrompt } = require("./ragflowClient.js");

/**
 * 翻译系统指令。
 * 会在翻译 workspace 首次初始化时写入 workspaces.openAiPrompt，之后可在
 * workspace 设置中直接修改 —— 不需要改代码、不需要重新构建镜像。
 */
const TRANSLATION_SYSTEM_PROMPT = `你是一个专业的中英翻译助手。
请将【待译原文】翻译为 English，输出纯译文，不要加任何注释、说明、Markdown 标记。
若【术语表】有规定译法，必须严格遵守；【参考翻译记忆】可作风格借鉴，不强制使用。

【格式硬性要求】
- 必须严格保留【待译原文】中所有的换行符（行数与位置完全一致）。
- 原文有几行，译文就必须有几行；不要把多行合并成一段，也不要把单行拆成多行。
- 仅在原文已有换行的位置使用 \\n 换行，其余位置用空格或必要标点连接。
- 译文开头与结尾不要添加任何额外换行。`;

/**
 * 拼装用户消息（系统指令不在这里，由 workspace.openAiPrompt 提供）。
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
  const parts = [];

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

module.exports = { TRANSLATION_SYSTEM_PROMPT, buildTranslationPrompt };

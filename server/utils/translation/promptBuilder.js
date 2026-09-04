// server/utils/translation/promptBuilder.js
//
// 翻译 prompt 拼装。
//
// 翻译原生化后的职责分工：
//   - 系统指令 → 写入 workspace.openAiPrompt（原生字段，管理员可在 UI 直接编辑）
//   - 本文件   → 拆成「user 侧纯原文」与「system 侧术语表/翻译记忆」两段
//
// 这样翻译不再自建 LLM 调用通道，直接复用原生 streamChatWithWorkspace，
// 自动获得：provider 自动适配、统一 token 统计、统一落库与流式契约。
//
// ⚠️ user message 只包含用户原始提问，**不掺任何拼接内容**：
//   - 移除【待译原文】标签
//   - 移除「请翻译为 English，输出纯译文。」指令
//   - 移除术语表 / 翻译记忆（改挂到 system 侧，见 buildTranslationSystemAddendum）
// 落库侧也只存原文：streamChatWithWorkspace 的 promptForStorage
// （详见 server/utils/chats/stream.js）。

const { formatChunksForPrompt } = require("./ragflowClient.js");

/**
 * 翻译系统指令。
 * 会在翻译 workspace 首次初始化时写入 workspaces.openAiPrompt，之后可在
 * workspace 设置中直接修改 —— 不需要改代码、不需要重新构建镜像。
 */
const TRANSLATION_SYSTEM_PROMPT = `你是一个专业的中英翻译助手。
请将用户输入的内容翻译为 English，输出纯译文，不要加任何注释、说明、Markdown 标记。
若附带有【术语表】，其中规定的译法必须严格遵守；【参考翻译记忆】可作风格借鉴，不强制使用。

【格式硬性要求】
- 必须严格保留原文中所有的换行符（行数与位置完全一致）。
- 原文有几行，译文就必须有几行；不要把多行合并成一段，也不要把单行拆成多行。
- 仅在原文已有换行的位置使用 \\n 换行，其余位置用空格或必要标点连接。
- 译文开头与结尾不要添加任何额外换行。`;

/**
 * 拼装提交给大模型的 **user message**。
 *
 * 只返回用户原始提问本身，不做任何拼接：
 *   - 不加【待译原文】标签
 *   - 不加「请翻译为 ...，输出纯译文。」指令（由 TRANSLATION_SYSTEM_PROMPT 传达）
 *   - 不加术语表 / 翻译记忆（改挂 system 侧，见 buildTranslationSystemAddendum）
 *
 * @param {Object} opts
 * @param {string} opts.sourceText - 用户原始提问（即待译原文）
 * @returns {string} 用户原始提问（原样返回）
 */
function buildTranslationUserPrompt({ sourceText } = {}) {
  return sourceText ?? "";
}

/**
 * 拼装追加到 system prompt 末尾的检索增强段。
 * 术语表与翻译记忆是**按原文动态抽取**的，不能写死进 workspace.openAiPrompt，
 * 因此每次请求时拼好、追加到系统指令尾部，让 user message 保持纯净。
 *
 * @param {Object} opts
 * @param {string} [opts.glossaryText] - Python wrapper 输出的 glossary 文本
 * @param {Array<{content: string, score: number, source: string}>} [opts.chunks=[]] - RAGFlow 检索片段
 * @returns {string} 无术语表且无翻译记忆时返回空字符串
 */
function buildTranslationSystemAddendum({
  glossaryText,
  chunks = [],
} = {}) {
  const parts = [];

  if (glossaryText && glossaryText.trim()) {
    parts.push(`【术语表 - 必须严格遵守】\n${glossaryText.trim()}`);
  }

  const chunksText = formatChunksForPrompt(chunks || []);
  if (chunksText) {
    parts.push(`【参考翻译记忆 - 风格可借鉴】\n${chunksText}`);
  }

  return parts.join("\n\n");
}

module.exports = {
  TRANSLATION_SYSTEM_PROMPT,
  buildTranslationUserPrompt,
  buildTranslationSystemAddendum,
};

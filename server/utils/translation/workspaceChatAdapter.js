// server/utils/translation/workspaceChatAdapter.js
//
// 翻译 workspace 对话适配器。
// 封装"翻译 workspace 对话"逻辑，被 server/endpoints/chat.js 的两个 stream-chat 端点分支调用。
//
// 入参签名：
//   adapter(response, { workspace, message, glossaryId, thread, user })
//
// 流程：
//   1. extractTerms(message)                // 复用 pythonBridge
//   2. ragflowClient.retrieval(...)         // 复用 RAGFlow 客户端
//   3. buildTranslationPrompt(...)          // 拼 prompt
//   4. streamLlmTranslation(prompt, onToken)  // 流式生成译文
//      → writeResponseChunk type: "textResponseChunk" (多次)
//   5. 落库 WorkspaceChats.new({ response: { text, sources:[], type:"translation", translationMeta:{...} } })
//   6. writeResponseChunk type: "finalizeResponseStream" close:true (带 chatId/metrics.translationMeta)
//
// 流式策略（见方案 §12）：
//   流式过程只推 textResponseChunk（译文 token），terms/chunks 不流式推送；
//   消息完成后随 finalizeResponseStream 一起把 translationMeta 作为 metrics 推到前端，
//   同时落库进 workspace_chats.response.translationMeta，刷新后仍可读。

const { v4: uuidv4 } = require("uuid");
const { WorkspaceChats } = require("../../models/workspaceChats");
const { writeResponseChunk } = require("../helpers/chat/responses");
const { extractTerms } = require("./pythonBridge");
const { retrieval } = require("./ragflowClient");
const {
  // 该路径把整段内容塞进 system 角色，因此这里把术语表段与原文拼成一段（保持原行为）
  buildTranslationUserPrompt,
  buildTranslationSystemAddendum,
} = require("./promptBuilder");
const { listGlossaries } = require("./glossaryManager");
const { streamLlmTranslation } = require("./llmStreamer");

/**
 * 翻译 workspace 对话适配器。
 * @param {import("express").Response} response - SSE 响应
 * @param {Object} opts
 * @param {Object} opts.workspace - workspace 对象
 * @param {string} opts.message - 用户消息（待译原文）
 * @param {string[]} [opts.glossaryIds=["default"]] - 术语库 ID 数组，靠后覆盖靠前
 * @param {Object|null} [opts.thread] - thread 对象（null 表示 workspace 默认对话）
 * @param {Object|null} [opts.user] - 当前用户对象
 * @returns {Promise<string>} 完整译文
 */
async function workspaceChatAdapter(response, opts) {
  const { workspace, message, glossaryIds = ["default"], thread, user } = opts;
  const ids = Array.isArray(glossaryIds) && glossaryIds.length > 0
    ? glossaryIds
    : ["default"];
  const uuid = uuidv4();
  let fullTranslation = "";

  try {
    // 步骤 1：抽术语（按 ids 融合多词库，靠后覆盖靠前）
    const termsResult = await extractTerms(message, ids);

    // 步骤 2：RAGFlow 检索
    const datasetId = process.env.RAGFLOW_DATASET_ID || "";
    const datasetIds = datasetId ? [datasetId] : [];
    const chunks = await retrieval(message, datasetIds, 5);

    // 步骤 3：拼 prompt
    // 本路径走「整段塞 system 角色」，故术语表段 + 原文合成一段；
    // 主路径（chat.js → streamChatWithWorkspace）则是术语表挂 system、user message 只放原文。
    const systemAddendum = buildTranslationSystemAddendum({
      glossaryText: termsResult.glossary,
      chunks,
    });
    const userPrompt = buildTranslationUserPrompt({ sourceText: message });
    const prompt = systemAddendum
      ? `${systemAddendum}\n\n${userPrompt}`
      : userPrompt;

    // 步骤 4：流式生成译文，按原生 chat 协议推 textResponseChunk
    fullTranslation = await streamLlmTranslation(prompt, (token) => {
      writeResponseChunk(response, {
        uuid,
        sources: [],
        type: "textResponseChunk",
        textResponse: token,
        close: false,
        error: false,
      });
    });

    // 元信息（消息完成后附加到 metrics，前端通过 metrics.translationMeta 读取）
    // glossaryIds：实际请求的 ids
    // glossaryNames：按 ids 顺序从 listGlossaries 查 name，未找到的用 id 兜底
    // glossaryUsed：Python wrapper 实际生效的 ids（找不到的 jsonl 会被跳过）
    const glossaries = listGlossaries();
    const usedIds = Array.isArray(termsResult.glossary_used)
      ? termsResult.glossary_used
      : ids;
    const glossaryNames = usedIds.map((gid) => {
      const matched = (glossaries || []).find((g) => g.id === gid);
      return matched?.name || gid;
    });
    const translationMeta = {
      glossaryIds: usedIds,
      glossaryNames,
      hitCount: termsResult.hits?.length || 0,
      retrievalCount: chunks?.length || 0,
      terms: termsResult.hits || [],
      chunks: chunks || [],
      allTerms: Array.isArray(termsResult.all_terms) ? termsResult.all_terms : [],
    };

    // 步骤 5：落库
    //   response.metrics.translationMeta：前端 utils/chat/index.js finalizeResponseStream
    //     分支会把 metrics 透传到历史项，UI 端读 metrics.translationMeta。
    //   convertToChatHistory 也读 data.metrics，刷新历史后元信息条仍可显示。
    const { chat, message: errMsg } = await WorkspaceChats.new({
      workspaceId: workspace.id,
      prompt: message,
      response: {
        text: fullTranslation,
        sources: [],
        type: "translation",
        attachments: [],
        metrics: { translationMeta },
        translationMeta,
      },
      user,
      threadId: thread?.id || null,
      include: true,
    });

    if (errMsg) {
      console.error("[workspaceChatAdapter] WorkspaceChats.new failed:", errMsg);
    }

    // 步骤 6：推 finalizeResponseStream 收尾（带 chatId + metrics.translationMeta）
    // 前端 utils/chat/index.js 在 finalizeResponseStream 分支会读取 metrics 字段并存入 chatHistory
    writeResponseChunk(response, {
      uuid,
      type: "finalizeResponseStream",
      textResponse: "",
      sources: [],
      close: true,
      error: false,
      chatId: chat?.id || null,
      metrics: { translationMeta },
    });

    return fullTranslation;
  } catch (err) {
    console.error("[workspaceChatAdapter] error:", err?.message || err);
    // 推 abort chunk，前端 utils/chat/index.js 会进入 abort 分支显示错误
    writeResponseChunk(response, {
      uuid,
      type: "abort",
      textResponse: null,
      sources: [],
      close: true,
      error: err?.message || "translation stream failed",
    });
    throw err;
  }
}

module.exports = { workspaceChatAdapter };

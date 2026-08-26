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
const { buildTranslationPrompt } = require("./promptBuilder");
const { listGlossaries } = require("./glossaryManager");
const { streamLlmTranslation } = require("./llmStreamer");

/**
 * 翻译 workspace 对话适配器。
 * @param {import("express").Response} response - SSE 响应
 * @param {Object} opts
 * @param {Object} opts.workspace - workspace 对象
 * @param {string} opts.message - 用户消息（待译原文）
 * @param {string} [opts.glossaryId="default"] - 术语库 ID
 * @param {Object|null} [opts.thread] - thread 对象（null 表示 workspace 默认对话）
 * @param {Object|null} [opts.user] - 当前用户对象
 * @returns {Promise<string>} 完整译文
 */
async function workspaceChatAdapter(response, opts) {
  const { workspace, message, glossaryId = "default", thread, user } = opts;
  const uuid = uuidv4();
  let fullTranslation = "";

  try {
    // 步骤 1：抽术语
    const termsResult = await extractTerms(message);

    // 步骤 2：RAGFlow 检索
    const datasetId = process.env.RAGFLOW_DATASET_ID || "";
    const datasetIds = datasetId ? [datasetId] : [];
    const chunks = await retrieval(message, datasetIds, 5);

    // 步骤 3：拼 prompt
    const prompt = buildTranslationPrompt({
      glossaryText: termsResult.glossary,
      chunks,
      sourceText: message,
    });

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
    // glossaryName 优先取 listGlossaries 返回的 name；fallback 到 glossaryId
    // all_terms：所有主词条 zh 列表（前端高亮 chunks 用，避免只看 message 命中）
    const glossaries = listGlossaries();
    const matchedGlossary = (glossaries || []).find((g) => g.id === glossaryId);
    const translationMeta = {
      glossaryId,
      glossaryName:
        (matchedGlossary && matchedGlossary.name) ||
        termsResult.glossary_name ||
        glossaryId,
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

// server/utils/fts_sprite/chatHandler.js
//
// FTS 精灵 workspace 的对话入口，由 server/endpoints/chat.js 的两个 stream-chat 端点调用。
//
// 流程：
//   1. 取最近的对话历史，调用 Python 精灵服务执行工作流
//      （意图识别 → 游戏数据 / 决策计算 → RAGFlow Lore 检索 → 组装上下文）
//   2. 工作流进度以 ftsSpriteStatus 事件推给前端（只显示，不落库）
//   3. 调试开关打开时，以 ftsSpriteDebug 事件推送中间结果（只显示，不落库）
//   4. mode=llm   ：交给原生 streamChatWithWorkspace，由主 LLM 流式回答
//                   - system prompt 使用精灵提示词（覆盖 workspace 设置）
//                   - 发给 LLM 的 user prompt 包含 RESPONSE CONTEXT / LORE
//                   - 落库只保存玩家原问题 + 最终回答
//      mode=direct：直接回复固定文案（意图无法识别），同样只保存问题 + 回答

const { v4: uuidv4 } = require("uuid");
const { WorkspaceChats } = require("../../models/workspaceChats");
const { writeResponseChunk } = require("../helpers/chat/responses");
const { recentChatHistory } = require("../chats");
const { streamChatWithWorkspace } = require("../chats/stream");
const { ftsSpriteConfig } = require("./constants");
const { issueGatewayToken, revokeGatewayToken } = require("./gateway");
const { runFtsSpriteWorkflow, FtsSpriteServiceError } = require("./serviceClient");

/**
 * @param {Object} opts
 * @param {import("express").Response} opts.response - SSE 响应
 * @param {Object} opts.workspace
 * @param {string} opts.message - 玩家原问题
 * @param {Object|null} opts.user
 * @param {Object|null} opts.thread
 * @param {Array} [opts.attachments]
 */
async function streamFtsSpriteChat({
  response,
  workspace,
  message,
  user = null,
  thread = null,
  attachments = [],
}) {
  const cfg = ftsSpriteConfig();
  const requestId = uuidv4();
  const statusUuid = uuidv4();
  const disconnect = new AbortController();
  const onClose = () => {
    if (!response.writableFinished) disconnect.abort();
  };
  response.on("close", onClose);

  const token = issueGatewayToken({ workspace, user, thread, requestId });
  let result;
  try {
    const { chatHistory } = await recentChatHistory({
      user,
      workspace,
      thread,
      messageLimit: cfg.historyTurns,
    });
    const history = (chatHistory || [])
      .filter((m) => typeof m?.content === "string" && m.content)
      .map((m) => ({ role: m.role, content: m.content }));

    result = await runFtsSpriteWorkflow({
      serviceUrl: cfg.serviceUrl,
      timeoutMs: cfg.timeoutMs,
      signal: disconnect.signal,
      payload: {
        request_id: requestId,
        message,
        history,
        gateway: { url: cfg.gatewayUrl, token },
        debug: cfg.debug,
      },
      onEvent: (event) => {
        if (event.type !== "status") return;
        writeResponseChunk(response, {
          uuid: statusUuid,
          type: "ftsSpriteStatus",
          textResponse: event.text,
          stage: event.stage,
          sources: [],
          close: false,
          error: false,
        });
      },
    });
  } catch (e) {
    if (disconnect.signal.aborted) {
      console.log(`[fts_sprite ${requestId}] client disconnected, workflow aborted`);
      return;
    }
    const isServiceError = e instanceof FtsSpriteServiceError;
    console.error(
      `[fts_sprite ${requestId}] workflow failed:`,
      isServiceError ? e.detail || e.message : e
    );
    writeResponseChunk(response, {
      uuid: uuidv4(),
      type: "abort",
      textResponse: null,
      sources: [],
      close: true,
      error: isServiceError ? e.message : "精灵暂时无法回答，请稍后再试。",
    });
    return;
  } finally {
    revokeGatewayToken(token);
    response.off("close", onClose);
  }

  console.log(
    `[fts_sprite ${requestId}] route=${result.meta?.route} timings=${JSON.stringify(
      result.meta?.timings_ms || {}
    )}${result.meta?.warnings?.length ? ` warnings=${JSON.stringify(result.meta.warnings)}` : ""}`
  );

  if (cfg.debug) {
    writeResponseChunk(response, {
      uuid: statusUuid,
      type: "ftsSpriteDebug",
      debug: { question: message, meta: result.meta || {}, ...(result.debug || {}) },
      sources: [],
      close: false,
      error: false,
    });
  }

  // 意图无法识别：固定回复（画布 Message:MajorTiesAdd）
  if (result.mode === "direct") {
    const { chat } = await WorkspaceChats.new({
      workspaceId: workspace.id,
      prompt: message,
      response: { text: result.text, sources: [], type: "chat", attachments },
      threadId: thread?.id || null,
      user,
    });
    writeResponseChunk(response, {
      uuid: uuidv4(),
      type: "textResponse",
      textResponse: result.text,
      sources: [],
      close: true,
      error: null,
      chatId: chat?.id || null,
    });
    return;
  }

  // 主 LLM（画布 Agent:RichWebsRun）：复用原生流式生成与落库
  await streamChatWithWorkspace(
    response,
    { ...workspace, openAiTemp: workspace?.openAiTemp ?? cfg.defaultTemp },
    result.user_prompt,
    "chat",
    user,
    thread,
    attachments,
    "fts_sprite",
    null, // 不附加 metrics：数据库只保存问题与最终回答
    message, // 落库使用玩家原问题
    null,
    result.system_prompt // 精灵系统提示词
  );
}

module.exports = { streamFtsSpriteChat };

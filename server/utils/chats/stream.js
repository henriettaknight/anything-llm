const { v4: uuidv4 } = require("uuid");
const { DocumentManager } = require("../DocumentManager");
const { WorkspaceChats } = require("../../models/workspaceChats");
const { WorkspaceParsedFiles } = require("../../models/workspaceParsedFiles");
const { getVectorDbClass, getLLMProvider } = require("../helpers");
const { writeResponseChunk } = require("../helpers/chat/responses");
const { recordUsage } = require("../../utils/usageLogs");
const { grepAgents } = require("./agents");
const {
  grepCommand,
  VALID_COMMANDS,
  chatPrompt,
  recentChatHistory,
  sourceIdentifier,
} = require("./index");
const { resolveThink } = require("../helpers/chat/think");
const { isTranslationWorkspace } = require("../../utils/translation/constants");

const VALID_CHAT_MODE = ["chat", "query"];

async function streamChatWithWorkspace(
  response,
  workspace,
  message,
  chatMode = "chat",
  user = null,
  thread = null,
  attachments = [],
  feature = null,
  // 调用方附加的自定义 metrics（如翻译的 translationMeta），
  // 会并入落库的 response.metrics 与 finalizeResponseStream 推送。
  extraMetrics = null,
  // 落库到 workspace_chats.prompt 时使用的原文。
  // 默认 null 时落库沿用 `message`；当调用方注入「增强 user prompt」
  // 给 LLM 但希望落库仅保留用户原文时（例如翻译），传原始 message。
  promptForStorage = null,
  // 追加到 system prompt 尾部的动态检索增强段（例如翻译的术语表 + 翻译记忆）。
  // 这类内容按原文动态抽取，不能写死进 workspace.openAiPrompt，
  // 又不该污染 user message，因此挂在 system 侧。
  systemAddendum = null
) {
  const uuid = uuidv4();
  const updatedMessage = await grepCommand(message, user);

  if (Object.keys(VALID_COMMANDS).includes(updatedMessage)) {
    const data = await VALID_COMMANDS[updatedMessage](
      workspace,
      message,
      uuid,
      user,
      thread
    );
    writeResponseChunk(response, data);
    return;
  }

  // If is agent enabled chat we will exit this flow early.
  const isAgentChat = await grepAgents({
    uuid,
    response,
    message: updatedMessage,
    user,
    workspace,
    thread,
  });
  if (isAgentChat) return;

  const LLMConnector = getLLMProvider({
    provider: workspace?.chatProvider,
    model: workspace?.chatModel,
  });

  // 思考开关按场景解析：翻译默认关闭，其余默认开启。
  // 仅 Ollama provider 会消费该参数，其它 provider 忽略（无副作用）。
  const think = resolveThink(
    isTranslationWorkspace(workspace) ? "translation" : "chat"
  );

  const VectorDb = getVectorDbClass();

  // 用 ?? 而不是 ||：openAiHistory=0 是合法值（翻译这类纯单轮任务要禁用历史），
  // 用 || 会被 falsy 短路成 20，反而塞进 20 轮历史。
  const messageLimit = workspace?.openAiHistory ?? 20;
  const hasVectorizedSpace = await VectorDb.hasNamespace(workspace.slug);
  const embeddingsCount = await VectorDb.namespaceCount(workspace.slug);

  // User is trying to query-mode chat a workspace that has no data in it - so
  // we should exit early as no information can be found under these conditions.
  if ((!hasVectorizedSpace || embeddingsCount === 0) && chatMode === "query") {
    const textResponse =
      workspace?.queryRefusalResponse ??
      "There is no relevant information in this workspace to answer your query.";
    writeResponseChunk(response, {
      id: uuid,
      type: "textResponse",
      textResponse,
      sources: [],
      attachments,
      close: true,
      error: null,
    });
    await WorkspaceChats.new({
      workspaceId: workspace.id,
      prompt: promptForStorage ?? message,
      response: {
        text: textResponse,
        sources: [],
        type: chatMode,
        attachments,
      },
      threadId: thread?.id || null,
      include: false,
      user,
    });
    return;
  }

  // If we are here we know that we are in a workspace that is:
  // 1. Chatting in "chat" mode and may or may _not_ have embeddings
  // 2. Chatting in "query" mode and has at least 1 embedding
  let completeText;
  let metrics = {};
  let contextTexts = [];
  let sources = [];
  let pinnedDocIdentifiers = [];
  const { rawHistory, chatHistory } = await recentChatHistory({
    user,
    workspace,
    thread,
    messageLimit,
  });

  // Look for pinned documents and see if the user decided to use this feature. We will also do a vector search
  // as pinning is a supplemental tool but it should be used with caution since it can easily blow up a context window.
  // However we limit the maximum of appended context to 80% of its overall size, mostly because if it expands beyond this
  // it will undergo prompt compression anyway to make it work. If there is so much pinned that the context here is bigger than
  // what the model can support - it would get compressed anyway and that really is not the point of pinning. It is really best
  // suited for high-context models.
  await new DocumentManager({
    workspace,
    maxTokens: LLMConnector.promptWindowLimit(),
  })
    .pinnedDocs()
    .then((pinnedDocs) => {
      pinnedDocs.forEach((doc) => {
        const { pageContent, ...metadata } = doc;
        pinnedDocIdentifiers.push(sourceIdentifier(doc));
        contextTexts.push(doc.pageContent);
        sources.push({
          text:
            pageContent.slice(0, 1_000) +
            "...continued on in source document...",
          ...metadata,
        });
      });
    });

  // Inject any parsed files for this workspace/thread/user
  const parsedFiles = await WorkspaceParsedFiles.getContextFiles(
    workspace,
    thread || null,
    user || null
  );
  parsedFiles.forEach((doc) => {
    const { pageContent, ...metadata } = doc;
    contextTexts.push(doc.pageContent);
    sources.push({
      text:
        pageContent.slice(0, 1_000) + "...continued on in source document...",
      ...metadata,
    });
  });

  const vectorSearchResults =
    embeddingsCount !== 0
      ? await VectorDb.performSimilaritySearch({
          namespace: workspace.slug,
          input: updatedMessage,
          LLMConnector,
          similarityThreshold: workspace?.similarityThreshold,
          topN: workspace?.topN,
          filterIdentifiers: pinnedDocIdentifiers,
          rerank: workspace?.vectorSearchMode === "rerank",
          hybrid: workspace?.vectorSearchHybridEnabled,
          hybridAlpha: workspace?.vectorSearchHybridAlpha,
        })
      : {
          contextTexts: [],
          sources: [],
          message: null,
        };

  // Failed similarity search if it was run at all and failed.
  if (!!vectorSearchResults.message) {
    writeResponseChunk(response, {
      id: uuid,
      type: "abort",
      textResponse: null,
      sources: [],
      close: true,
      error: vectorSearchResults.message,
    });
    return;
  }

  const { fillSourceWindow } = require("../helpers/chat");
  const filledSources = fillSourceWindow({
    nDocs: workspace?.topN || 4,
    searchResults: vectorSearchResults.sources,
    history: rawHistory,
    filterIdentifiers: pinnedDocIdentifiers,
  });

  // Why does contextTexts get all the info, but sources only get current search?
  // This is to give the ability of the LLM to "comprehend" a contextual response without
  // populating the Citations under a response with documents the user "thinks" are irrelevant
  // due to how we manage backfilling of the context to keep chats with the LLM more correct in responses.
  // If a past citation was used to answer the question - that is visible in the history so it logically makes sense
  // and does not appear to the user that a new response used information that is otherwise irrelevant for a given prompt.
  // TLDR; reduces GitHub issues for "LLM citing document that has no answer in it" while keep answers highly accurate.
  contextTexts = [...contextTexts, ...filledSources.contextTexts];
  sources = [...sources, ...vectorSearchResults.sources];

  // If in query mode and no context chunks are found from search, backfill, or pins -  do not
  // let the LLM try to hallucinate a response or use general knowledge and exit early
  if (chatMode === "query" && contextTexts.length === 0) {
    const textResponse =
      workspace?.queryRefusalResponse ??
      "There is no relevant information in this workspace to answer your query.";
    writeResponseChunk(response, {
      id: uuid,
      type: "textResponse",
      textResponse,
      sources: [],
      close: true,
      error: null,
    });

    await WorkspaceChats.new({
      workspaceId: workspace.id,
      prompt: promptForStorage ?? message,
      response: {
        text: textResponse,
        sources: [],
        type: chatMode,
        attachments,
      },
      threadId: thread?.id || null,
      include: false,
      user,
    });
    return;
  }

  // 系统指令 = workspace.openAiPrompt（+ 用户名等原生拼装）；
  // 翻译场景还会追加动态术语表 / 翻译记忆，让 user message 保持纯净原文。
  const baseSystemPrompt = await chatPrompt(workspace, user);
  const systemPrompt =
    systemAddendum && systemAddendum.trim()
      ? `${baseSystemPrompt}\n\n${systemAddendum.trim()}`
      : baseSystemPrompt;

  // Compress & Assemble message to ensure prompt passes token limit with room for response
  // and build system messages based on inputs and history.
  const messages = await LLMConnector.compressMessages(
    {
      systemPrompt,
      userPrompt: updatedMessage,
      contextTexts,
      chatHistory,
      attachments,
    },
    rawHistory
  );

  // If streaming is not explicitly enabled for connector
  // we do regular waiting of a response and send a single chunk.
  if (LLMConnector.streamingEnabled() !== true) {
    console.log(
      `\x1b[31m[STREAMING DISABLED]\x1b[0m Streaming is not available for ${LLMConnector.constructor.name}. Will use regular chat method.`
    );
    const { textResponse, metrics: performanceMetrics } =
      await LLMConnector.getChatCompletion(messages, {
        temperature: workspace?.openAiTemp ?? LLMConnector.defaultTemp,
        user: user,
        think,
      });

    completeText = textResponse;
    metrics = performanceMetrics;
    writeResponseChunk(response, {
      uuid,
      sources,
      type: "textResponseChunk",
      textResponse: completeText,
      close: true,
      error: false,
      metrics,
    });
  } else {
    const stream = await LLMConnector.streamGetChatCompletion(messages, {
      temperature: workspace?.openAiTemp ?? LLMConnector.defaultTemp,
      user: user,
      think,
    });
    completeText = await LLMConnector.handleStream(response, stream, {
      uuid,
      sources,
    });
    metrics = stream.metrics;
  }

  // 并入调用方附加的自定义 metrics（如翻译的 translationMeta），
  // 供落库与 finalizeResponseStream 一起推送给前端。
  if (extraMetrics) metrics = { ...(metrics || {}), ...extraMetrics };

  // 代码检测（code_review）用量落库：仅在请求显式带 feature 标记时写 usage_logs
  if (feature === "code_review" && metrics) {
    await recordUsage({
      userId: user?.id || null,
      feature: "code_review",
      provider: workspace?.chatProvider || null,
      model: workspace?.chatModel || null,
      metrics,
      workspaceId: workspace?.id || null,
      threadId: thread?.id || null,
    });
  }

  if (completeText?.length > 0) {
    const { chat } = await WorkspaceChats.new({
      workspaceId: workspace.id,
      prompt: promptForStorage ?? message,
      response: {
        text: completeText,
        sources,
        type: chatMode,
        attachments,
        metrics,
      },
      threadId: thread?.id || null,
      user,
    });

    writeResponseChunk(response, {
      uuid,
      type: "finalizeResponseStream",
      close: true,
      error: false,
      chatId: chat.id,
      metrics,
    });
    return;
  }

  writeResponseChunk(response, {
    uuid,
    type: "finalizeResponseStream",
    close: true,
    error: false,
    metrics,
  });
  return;
}

module.exports = {
  VALID_CHAT_MODE,
  streamChatWithWorkspace,
};

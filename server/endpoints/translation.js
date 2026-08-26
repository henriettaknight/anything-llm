// server/endpoints/translation.js
//
// 智能翻译端点（workspace 化后精简版）
// ====================================
// GET /translation/glossaries         - 词库列表
// GET /translation/health             - 健康检查
// GET /translation/ensure-workspace   - 确保当前用户存在翻译 workspace，返回 slug
//
// 翻译主流程已迁移到原生 stream-chat 端点（见 server/endpoints/chat.js 的
// isTranslationWorkspace 分支 + server/utils/translation/workspaceChatAdapter.js）。
// 原 /translation/translate + /translation/history/* 已删除，历史走原生
// workspace_chats 表，前端按翻译 workspace 的 thread 列表展示。

const { userFromSession } = require("../utils/http");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const { listGlossaries } = require("../utils/translation/glossaryManager");
const { ensureTranslationWorkspace } = require("../utils/translation/ensureWorkspace");

function translationEndpoints(app) {
  if (!app) return;

  // 词库列表：内置 default + server/storage/glossaries/*.jsonl
  app.get("/translation/glossaries", [validatedRequest], (_req, response) => {
    const glossaries = listGlossaries();
    response.json({
      glossaries,
      defaultId: "default",
    });
  });

  // 健康检查：确认 Python + RAGFlow + LLM 是否就绪
  app.get("/translation/health", [validatedRequest], async (_req, response) => {
    const pythonBin = process.env.TRANSLATION_PYTHON_BIN || "python";
    const ragflowUrl = process.env.RAGFLOW_BASE_URL || "";
    const llmUrl = process.env.TRANSLATION_LLM_BASE_URL || "";
    response.json({
      python: { bin: pythonBin, configured: true },
      ragflow: { baseUrl: ragflowUrl, configured: !!ragflowUrl },
      llm: { baseUrl: llmUrl, configured: !!llmUrl },
    });
  });

  // 确保当前用户存在翻译 workspace，返回 slug 供前端跳转
  // GET /translation/ensure-workspace
  app.get(
    "/translation/ensure-workspace",
    [validatedRequest],
    async (req, response) => {
      const user = await userFromSession(req, response);
      if (!user) return;
      try {
        const workspace = await ensureTranslationWorkspace(user);
        if (!workspace) {
          response
            .status(500)
            .json({ error: "failed to ensure translation workspace" });
          return;
        }
        response.json({ slug: workspace.slug, name: workspace.name });
      } catch (err) {
        console.error("[/translation/ensure-workspace] error:", err?.message);
        response.status(500).json({ error: err?.message || "internal error" });
      }
    }
  );
}

module.exports = { translationEndpoints };

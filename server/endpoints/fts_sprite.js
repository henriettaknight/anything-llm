// server/endpoints/fts_sprite.js
//
// FTS 精灵相关端点（挂在 /api 下）：
//
//   POST /fts_sprite/internal/llm      内部 LLM 网关，只供本机 Python 精灵服务调用
//   GET  /fts_sprite/ensure-workspace  进入精灵：返回 { slug, name }；未开通且非管理员时返回 403
//   GET  /fts_sprite/health            查看 Python 精灵服务状态与配置摘要
//
// 内部网关的鉴权：
//   - 必须携带本次问答签发的一次性 token（X-FTS-Sprite-Token）
//   - 默认只接受来自本机回环地址的请求（FTS_SPRITE_GATEWAY_ALLOW_REMOTE=true 可放开，
//     仅在 Python 服务与 Node 不在同一台机器/容器时需要）

const { reqBody, userFromSession, multiUserMode } = require("../utils/http");
const { ROLES } = require("../utils/middleware/multiUserProtected");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const { getLLMProvider } = require("../utils/helpers");
const { resolveThink } = require("../utils/helpers/chat/think");
const { recordUsage } = require("../utils/usageLogs");
const { resolveGatewayToken } = require("../utils/fts_sprite/gateway");
const { ftsSpriteConfig } = require("../utils/fts_sprite/constants");
const { ensureFtsSpriteWorkspace } = require("../utils/fts_sprite/ensureWorkspace");
const { getFtsSpriteHealth } = require("../utils/fts_sprite/serviceClient");

const THINK_RE = /<think>[\s\S]*?<\/think>/gi;

function isLoopback(address = "") {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

function ftsSpriteEndpoints(app) {
  if (!app) return;

  app.post("/fts_sprite/internal/llm", async (request, response) => {
    const started = Date.now();
    try {
      if (
        process.env.FTS_SPRITE_GATEWAY_ALLOW_REMOTE !== "true" &&
        !isLoopback(request.socket?.remoteAddress)
      ) {
        return response.status(403).json({ error: "forbidden" });
      }
      const session = resolveGatewayToken(request.header("X-FTS-Sprite-Token"));
      if (!session) return response.status(401).json({ error: "invalid token" });

      const { messages, provider = null, model = null, temperature, role } =
        reqBody(request) || {};
      if (!Array.isArray(messages) || messages.length === 0) {
        return response.status(400).json({ error: "messages required" });
      }

      const { workspace, user, thread } = session;
      // 未单独配置时使用 workspace 设置里的模型；只配置 provider 时使用该 provider 的默认模型
      const llmProvider = provider || workspace?.chatProvider || null;
      const llmModel = model || (provider ? null : workspace?.chatModel || null);
      const LLMConnector = getLLMProvider({ provider: llmProvider, model: llmModel });

      const result = await LLMConnector.getChatCompletion(messages, {
        temperature: typeof temperature === "number" ? temperature : LLMConnector.defaultTemp,
        user,
        think: resolveThink("fts_sprite"),
      });
      if (!result) throw new Error("empty completion");
      const text = String(result.textResponse || "").replace(THINK_RE, "").trim();

      await recordUsage({
        userId: user?.id || null,
        feature: "fts_sprite",
        provider: llmProvider || process.env.LLM_PROVIDER || null,
        model: llmModel || LLMConnector.model || null,
        metrics: result.metrics || {},
        workspaceId: workspace?.id || null,
        threadId: thread?.id || null,
        durationMs: Date.now() - started,
      });

      response.status(200).json({ text, role: role || null, metrics: result.metrics || {} });
    } catch (e) {
      console.error("[fts_sprite] internal llm failed:", e?.message || e);
      response.status(500).json({ error: e?.message || "llm failed" });
    }
  });

  // 进入精灵：workspace 已存在则授权并返回；不存在时只有管理员（或单用户模式）可以创建，
  // 其他用户返回 403 not_provisioned，前端提示「精灵尚未开通，请联系管理员」。
  app.get("/fts_sprite/ensure-workspace", [validatedRequest], async (request, response) => {
    try {
      const user = await userFromSession(request, response);
      const canCreate = !multiUserMode(response) || user?.role === ROLES.admin;
      const { workspace, error, message } = await ensureFtsSpriteWorkspace(user, { canCreate });
      if (error === "not_provisioned") {
        return response.status(403).json({ error, message });
      }
      if (!workspace) {
        return response.status(500).json({ error: "create_failed", message: "精灵开通失败，请稍后再试" });
      }
      response.json({ slug: workspace.slug, name: workspace.name });
    } catch (e) {
      console.error("[fts_sprite] ensure-workspace failed:", e?.message);
      response.status(500).json({ error: "internal_error", message: e?.message || "internal error" });
    }
  });

  app.get("/fts_sprite/health", [validatedRequest], async (_request, response) => {
    const { serviceUrl, debug } = ftsSpriteConfig();
    try {
      const health = await getFtsSpriteHealth(serviceUrl);
      response.json({ node: { serviceUrl, debug }, service: health });
    } catch (e) {
      response.status(503).json({
        node: { serviceUrl, debug },
        service: { status: "unreachable", error: e?.cause?.code || e?.message },
      });
    }
  });
}

module.exports = { ftsSpriteEndpoints };

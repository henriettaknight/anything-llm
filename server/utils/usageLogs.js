const prisma = require("./prisma");

/**
 * 记录一次功能调用的 token 用量（当前仅用于代码检测 code_review）。
 * 失败不影响主流程。
 *
 * @param {Object} p
 * @param {number|null} p.userId
 * @param {string} p.feature        当前固定 "code_review"
 * @param {string|null} p.provider
 * @param {string|null} p.model
 * @param {Object} p.metrics        { prompt_tokens, completion_tokens, total_tokens }
 * @param {number|null} p.workspaceId
 * @param {number|null} p.threadId
 * @param {number|null} p.durationMs
 */
async function recordUsage({
  userId = null,
  feature = "code_review",
  provider = null,
  model = null,
  metrics = {},
  workspaceId = null,
  threadId = null,
  durationMs = null,
}) {
  try {
    const promptTokens = Number(metrics?.prompt_tokens) || 0;
    const completionTokens = Number(metrics?.completion_tokens) || 0;
    const totalTokens =
      Number(metrics?.total_tokens) || promptTokens + completionTokens;

    await prisma.usage_logs.create({
      data: {
        userId,
        feature,
        provider,
        model,
        promptTokens,
        completionTokens,
        totalTokens,
        durationMs,
        workspaceId,
        threadId,
        occurredAt: new Date(),
      },
    });
  } catch (e) {
    console.error("[usage_logs] recordUsage failed:", e.message);
  }
}

module.exports = { recordUsage };

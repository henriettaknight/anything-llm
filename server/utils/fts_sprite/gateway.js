// server/utils/fts_sprite/gateway.js
//
// LLM 网关的一次性 token。
//
// 每次精灵问答开始时，Node 生成一个随机 token 并下发给 Python；
// Python 调用 /api/fts_sprite/internal/llm 时带上它，Node 据此找回
// 本次请求的 workspace / user / thread（用于选择模型与记录用量）。
// 工作流结束后立即作废；另有 TTL 兜底，避免异常时残留。

const crypto = require("crypto");

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const sessions = new Map();

function purgeExpired() {
  const now = Date.now();
  for (const [token, s] of sessions) {
    if (s.expiresAt <= now) sessions.delete(token);
  }
}

/**
 * @param {{workspace: Object, user: Object|null, thread: Object|null, requestId: string}} ctx
 * @param {number} [ttlMs]
 * @returns {string} token
 */
function issueGatewayToken(ctx, ttlMs = DEFAULT_TTL_MS) {
  purgeExpired();
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, { ...ctx, expiresAt: Date.now() + ttlMs });
  return token;
}

/** @returns {{workspace: Object, user: Object|null, thread: Object|null, requestId: string}|null} */
function resolveGatewayToken(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (s.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return s;
}

function revokeGatewayToken(token) {
  if (token) sessions.delete(token);
}

module.exports = { issueGatewayToken, resolveGatewayToken, revokeGatewayToken };

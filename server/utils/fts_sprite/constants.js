// server/utils/fts_sprite/constants.js
//
// FTS 精灵 workspace 识别与配置。
// 与智能翻译一致：不新增 workspace 字段，以显示名 + 固定 slug 作为识别开关。
// 工作流主体在 Python 服务（仓库根目录 fts_sprite/）中实现，Node 只负责接入。

/** 精灵 workspace 显示名 */
const FTS_SPRITE_WORKSPACE_NAME = "FTS精灵";

/** 精灵 workspace 固定 slug（通过 /api/fts_sprite/ensure-workspace 创建时使用） */
const FTS_SPRITE_WORKSPACE_SLUG = "fts_sprite";

/**
 * 判断 workspace 是否为 FTS 精灵 workspace（名称或 slug 任一命中）。
 * @param {{name?: string, slug?: string}|null} ws
 * @returns {boolean}
 */
function isFtsSpriteWorkspace(ws) {
  if (!ws) return false;
  return (
    ws.name === FTS_SPRITE_WORKSPACE_NAME || ws.slug === FTS_SPRITE_WORKSPACE_SLUG
  );
}

function toInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 读取 Node 侧配置（每次调用时读取，方便测试与热更新 .env 后重启）。
 */
function ftsSpriteConfig() {
  const port = process.env.SERVER_PORT || 3001;
  return {
    // Python 精灵服务地址（容器内只监听 127.0.0.1）
    serviceUrl: (
      process.env.FTS_SPRITE_SERVICE_URL || "http://127.0.0.1:8890"
    ).replace(/\/+$/, ""),
    // Python 回调 Node LLM 网关的地址
    gatewayUrl:
      process.env.FTS_SPRITE_GATEWAY_URL ||
      `http://127.0.0.1:${port}/api/fts_sprite/internal/llm`,
    // 整个 Python 工作流的超时（不含主 LLM 流式回答）
    timeoutMs: toInt(process.env.FTS_SPRITE_TIMEOUT_MS, 120_000),
    // 传给意图识别的历史轮数（1 轮 = 玩家问题 + 精灵回答）
    historyTurns: toInt(process.env.FTS_SPRITE_HISTORY_TURNS, 6),
    // 调试：在回答上方显示可折叠的中间结果（不落库）
    debug: String(process.env.FTS_SPRITE_DEBUG || "").toLowerCase() === "true",
    // 主 LLM 默认温度（workspace 未设置温度时使用，与画布一致）
    defaultTemp: 0.1,
  };
}

module.exports = {
  FTS_SPRITE_WORKSPACE_NAME,
  FTS_SPRITE_WORKSPACE_SLUG,
  isFtsSpriteWorkspace,
  ftsSpriteConfig,
};

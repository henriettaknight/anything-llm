// server/utils/translation/constants.js
//
// 翻译 workspace 识别常量。
// 零 schema 改动：不新增 workspace.type 字段，以显示名 + slug 规则作为识别开关。
//
// slug 策略（多用户模式）：
//   每个用户独立翻译 workspace，slug = `translation-{userId}`，避免全局唯一冲突。
//
// ⚠️ slug 必须**严格匹配** `translation-{数字}`，不能用 startsWith 前缀匹配：
//   服务器上存在历史 workspace「翻译助手」（slug = `translation-assistant`），
//   前缀匹配会把它误判为翻译 workspace，导致术语注入、关闭思考等翻译逻辑被错误套用。

const TRANSLATION_WORKSPACE_NAME = "智能翻译";
const TRANSLATION_WORKSPACE_SLUG_PREFIX = "translation-";
/** 自动创建的每用户翻译 workspace：translation-{userId}（userId 为数字） */
const TRANSLATION_WORKSPACE_SLUG_PATTERN = /^translation-\d+$/;

/**
 * 判断 workspace 是否为翻译 workspace。
 * 命中条件（任一）：
 *   1. name 等于中文显示名「智能翻译」
 *   2. slug 严格匹配 `translation-{userId}`
 *
 * 注意：刻意不用 `slug.startsWith('translation-')`，避免误伤
 * `translation-assistant` 这类历史 workspace（它们不是新翻译体系管理的对象）。
 * @param {{name?: string, slug?: string}|null} ws
 * @returns {boolean}
 */
function isTranslationWorkspace(ws) {
  if (!ws) return false;
  if (ws.name === TRANSLATION_WORKSPACE_NAME) return true;
  return TRANSLATION_WORKSPACE_SLUG_PATTERN.test(ws.slug || "");
}

module.exports = {
  TRANSLATION_WORKSPACE_NAME,
  TRANSLATION_WORKSPACE_SLUG_PREFIX,
  TRANSLATION_WORKSPACE_SLUG_PATTERN,
  isTranslationWorkspace,
};

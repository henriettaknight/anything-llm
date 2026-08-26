// server/utils/translation/constants.js
//
// 翻译 workspace 识别常量。
// 零 schema 改动：不新增 workspace.type 字段，以显示名 + slug 前缀作为识别开关。
//
// slug 策略（多用户模式）：
//   每个用户独立翻译 workspace，slug = `translation-{userId}`，避免全局唯一冲突。
//   识别函数用前缀匹配，兼容 `translation-1`、`translation-2` 等。

const TRANSLATION_WORKSPACE_NAME = "智能翻译";
const TRANSLATION_WORKSPACE_SLUG_PREFIX = "translation-";

/**
 * 判断 workspace 是否为翻译 workspace。
 * 命中条件（任一）：
 *   1. name 等于中文显示名「智能翻译」
 *   2. slug 以 `translation-` 开头（每用户独立 workspace）
 * @param {{name?: string, slug?: string}|null} ws
 * @returns {boolean}
 */
function isTranslationWorkspace(ws) {
  if (!ws) return false;
  if (ws.name === TRANSLATION_WORKSPACE_NAME) return true;
  if (ws.slug && ws.slug.startsWith(TRANSLATION_WORKSPACE_SLUG_PREFIX)) return true;
  return false;
}

module.exports = {
  TRANSLATION_WORKSPACE_NAME,
  TRANSLATION_WORKSPACE_SLUG_PREFIX,
  isTranslationWorkspace,
};

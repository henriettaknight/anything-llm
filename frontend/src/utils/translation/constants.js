// frontend/src/utils/translation/constants.js
//
// 翻译 workspace 识别常量（前端版本，与 server/utils/translation/constants.js 保持一致）。
// 零 schema 改动：不新增 workspace.type 字段，以显示名 + slug 前缀作为识别开关。

export const TRANSLATION_WORKSPACE_NAME = "智能翻译";
export const TRANSLATION_WORKSPACE_SLUG_PREFIX = "translation-";

/**
 * 判断 workspace 是否为翻译 workspace。
 * @param {{name?: string, slug?: string}|null|undefined} ws
 * @returns {boolean}
 */
export function isTranslationWorkspace(ws) {
  if (!ws) return false;
  if (ws.name === TRANSLATION_WORKSPACE_NAME) return true;
  if (ws.slug && ws.slug.startsWith(TRANSLATION_WORKSPACE_SLUG_PREFIX)) return true;
  return false;
}

/**
 * 根据用户 ID 生成翻译 workspace 的 slug。
 * 多用户模式下每个用户独立一个翻译 workspace，避免 slug 全局唯一冲突。
 * @param {number|string} userId
 * @returns {string}
 */
export function translationSlugForUser(userId) {
  return `${TRANSLATION_WORKSPACE_SLUG_PREFIX}${userId}`;
}

// frontend/src/utils/translation/constants.js
//
// 翻译 workspace 识别常量（前端版本，与 server/utils/translation/constants.js 保持一致）。
// 零 schema 改动：不新增 workspace.type 字段，以显示名 + slug 规则作为识别开关。

export const TRANSLATION_WORKSPACE_NAME = "智能翻译";
export const TRANSLATION_WORKSPACE_SLUG_PREFIX = "translation-";

/**
 * 自动创建的每用户翻译 workspace：translation-{userId}（userId 为数字）。
 *
 * ⚠️ 必须与 server/utils/translation/constants.js 的正则**完全一致**。
 * 不能用 startsWith('translation-') 前缀匹配：服务器上存在历史 workspace
 * 「翻译助手」（slug = translation-assistant），前缀匹配会把它误判为翻译 workspace，
 * 导致术语选择器、长文本折叠等翻译专属 UI 被错误套用到普通 workspace 上。
 */
export const TRANSLATION_WORKSPACE_SLUG_PATTERN = /^translation-\d+$/;

/** 输入框长文本阈值：超过即进入「可折叠」状态（行数或字符数任一超出）。 */
export const TRANSLATION_LONG_INPUT_LINES = 8;
export const TRANSLATION_LONG_INPUT_CHARS = 500;

/** 历史消息折叠后的最大高度（px，约 12 行）。 */
export const TRANSLATION_COLLAPSED_MAX_HEIGHT = 240;

/**
 * 判断 workspace 是否为翻译 workspace。
 * @param {{name?: string, slug?: string}|null|undefined} ws
 * @returns {boolean}
 */
export function isTranslationWorkspace(ws) {
  if (!ws) return false;
  if (ws.name === TRANSLATION_WORKSPACE_NAME) return true;
  return TRANSLATION_WORKSPACE_SLUG_PATTERN.test(ws.slug || "");
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

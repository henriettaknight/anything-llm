// frontend/src/utils/translation/constants.js
//
// 翻译 workspace 识别常量（前端版本，与 server/utils/translation/constants.js 保持一致）。
// 零 schema 改动：不新增 workspace.type 字段，以显示名 + slug 规则作为识别开关。
//
// 架构变更（2026-09-09）：
//   翻译 workspace 不再按用户隔离，所有用户共享同一个翻译 workspace。
//   支持两个翻译 workspace："智能翻译"(slug=translation) + "智能翻译测试"(slug=translation-test)。

/** 翻译 workspace 显示名（多个，均为翻译 workspace） */
export const TRANSLATION_WORKSPACE_NAMES = ["智能翻译", "智能翻译测试"];

/** 翻译 workspace 固定 slug 映射 */
export const TRANSLATION_WORKSPACE_SLUGS = {
  智能翻译: "translation",
  智能翻译测试: "translation-test",
};

/** slug 集合（用于 isTranslationWorkspace 的 slug 匹配） */
export const TRANSLATION_WORKSPACE_SLUG_SET = new Set(
  Object.values(TRANSLATION_WORKSPACE_SLUGS)
);

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
  if (TRANSLATION_WORKSPACE_NAMES.includes(ws.name)) return true;
  return TRANSLATION_WORKSPACE_SLUG_SET.has(ws.slug);
}

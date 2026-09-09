// server/utils/translation/constants.js
//
// 翻译 workspace 识别常量。
// 零 schema 改动：不新增 workspace.type 字段，以显示名 + slug 规则作为识别开关。
//
// 架构变更（2026-09-09）：
//   翻译 workspace 不再按用户隔离，所有用户共享同一个翻译 workspace。
//   支持两个翻译 workspace："智能翻译"(slug=translation) + "智能翻译测试"(slug=translation-test)。
//
// ⚠️ slug 用固定值（不再拼接 userId），用 Set 精确匹配，不用正则前缀匹配：
//   避免误伤 `translation-assistant` 这类历史 workspace。

/** 翻译 workspace 显示名（多个，均为翻译 workspace） */
const TRANSLATION_WORKSPACE_NAMES = ["智能翻译", "智能翻译测试"];

/** 翻译 workspace 固定 slug 映射 */
const TRANSLATION_WORKSPACE_SLUGS = {
  智能翻译: "translation",
  智能翻译测试: "translation-test",
};

/** slug 集合（用于 isTranslationWorkspace 的 slug 匹配） */
const TRANSLATION_WORKSPACE_SLUG_SET = new Set(
  Object.values(TRANSLATION_WORKSPACE_SLUGS)
);

/**
 * 判断 workspace 是否为翻译 workspace。
 * 命中条件（任一）：
 *   1. name 在 TRANSLATION_WORKSPACE_NAMES 中
 *   2. slug 在 TRANSLATION_WORKSPACE_SLUG_SET 中
 *
 * 注意：刻意不用 `slug.startsWith('translation-')`，避免误伤
 * `translation-assistant` 这类历史 workspace（它们不是新翻译体系管理的对象）。
 * @param {{name?: string, slug?: string}|null} ws
 * @returns {boolean}
 */
function isTranslationWorkspace(ws) {
  if (!ws) return false;
  if (TRANSLATION_WORKSPACE_NAMES.includes(ws.name)) return true;
  return TRANSLATION_WORKSPACE_SLUG_SET.has(ws.slug);
}

module.exports = {
  TRANSLATION_WORKSPACE_NAMES,
  TRANSLATION_WORKSPACE_SLUGS,
  TRANSLATION_WORKSPACE_SLUG_SET,
  isTranslationWorkspace,
};

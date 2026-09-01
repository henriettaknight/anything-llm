// server/utils/translation/ensureWorkspace.js
//
// 为当前用户确保存在一个翻译 workspace，并返回其完整记录。
//
// 多用户策略：
//   - slug = `translation-{userId}`，每用户一个独立翻译 workspace
//   - 识别函数见 constants.js（前缀匹配）
//
// 创建流程：
//   1. 查 slug 是否已存在 → 存在则直接复用（需为当前用户授权，admin 例外）
//   2. 不存在 → Workspace.new("智能翻译", userId, { chatMode: "chat" })
//     - Workspace.new 会自动建 workspace_users 关联（见 workspace.js L247）
//     - 但 slug 是 uuidv4() 兜底（中文 name slugify 失败），需绕开 writable 白名单直接 prisma.update 强制为 translation-{userId}
//
// chatMode 强制 `chat`：
//   stream.js L57-71 对 `chatMode==="query"` + 空向量空间会早退返回 refusal。
//   翻译 workspace 没文档没向量，必须强制 chat 模式，否则翻译逻辑跑不到。

const prisma = require("../../utils/prisma");
const { Workspace } = require("../../models/workspace");
const { WorkspaceUser } = require("../../models/workspaceUsers");
const { ROLES } = require("../middleware/multiUserProtected");
const {
  TRANSLATION_WORKSPACE_NAME,
  TRANSLATION_WORKSPACE_SLUG_PREFIX,
} = require("./constants");
const { TRANSLATION_SYSTEM_PROMPT } = require("./promptBuilder");

/**
 * 用原生 workspace 字段承载翻译配置（幂等，只在未初始化时写入）。
 * 写入后管理员可以在 workspace 设置里直接改指令/温度，无需改代码或重建镜像。
 *
 * - openAiPrompt：翻译系统指令（原生字段，UI 可编辑）
 * - openAiTemp  ：0.3，翻译需要稳定输出
 * - openAiHistory：2，翻译是单轮任务，默认 20 条历史只会白白消耗上下文
 *
 * @param {Object|null} workspace
 * @returns {Promise<Object|null>}
 */
async function applyTranslationDefaults(workspace) {
  // openAiPrompt 非空视为已初始化（可能是管理员手工改过的），不再覆盖
  if (!workspace || workspace.openAiPrompt) return workspace;

  await prisma.workspaces.update({
    where: { id: workspace.id },
    data: {
      openAiPrompt: TRANSLATION_SYSTEM_PROMPT,
      openAiTemp: 0.3,
      openAiHistory: 2,
    },
  });
  return Workspace.get({ id: workspace.id });
}

/**
 * 为当前用户确保存在翻译 workspace，返回该 workspace（含 id/slug/name/chatMode 等完整字段）。
 * @param {{id: number, role: string}} user
 * @returns {Promise<Object|null>}
 */
async function ensureTranslationWorkspace(user) {
  if (!user || !user.id) return null;

  const targetSlug = `${TRANSLATION_WORKSPACE_SLUG_PREFIX}${user.id}`;

  // 1. 查现有
  const existing = await Workspace.get({ slug: targetSlug });
  if (existing) {
    // 已存在：default 用户需确保授权（admin/manager 不需要，他们看全部）
    if (user.role !== ROLES.admin && user.role !== ROLES.manager) {
      const link = await prisma.workspace_users.findFirst({
        where: { workspace_id: existing.id, user_id: user.id },
      });
      if (!link) await WorkspaceUser.create(user.id, existing.id);
    }
    return applyTranslationDefaults(existing);
  }

  // 2. 新建：Workspace.new 会自动建 workspace_users 关联
  const { workspace, message } = await Workspace.new(
    TRANSLATION_WORKSPACE_NAME,
    user.id,
    { chatMode: "chat" }
  );
  if (!workspace) {
    console.error("[ensureTranslationWorkspace] Workspace.new failed:", message);
    return null;
  }

  // 3. 强制 slug（slug 不在 Workspace.writable 白名单，直接 prisma.update）
  //    中文 name slugify 失败后会 fallback 到 uuidv4()，必须覆盖。
  await prisma.workspaces.update({
    where: { id: workspace.id },
    data: { slug: targetSlug },
  });

  // 4. 写翻译默认配置，然后重新 get 返回带新 slug 的完整 workspace
  return applyTranslationDefaults(await Workspace.get({ id: workspace.id }));
}

module.exports = { ensureTranslationWorkspace };

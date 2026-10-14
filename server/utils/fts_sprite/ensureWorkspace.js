// server/utils/fts_sprite/ensureWorkspace.js
//
// 确保存在 FTS 精灵 workspace（所有用户共享），并为当前用户授权。
// 参照 utils/translation/ensureWorkspace.js，区别：只有管理员可以创建。
//
// 查找顺序：
//   1. 固定 slug "fts_sprite"
//   2. 名称「FTS精灵」（兼容在 UI 中手动新建、slug 为随机 ID 的情况，避免重复创建）
//
// 不存在时：
//   - 管理员（或单用户模式）→ 创建，slug 固定为 fts_sprite，写入与画布一致的默认参数
//   - 其他用户 → 返回 not_provisioned，由前端提示「精灵尚未开通，请联系管理员」
//
// 并发：多个管理员同时首次进入时，用进程内锁保证只创建一次
// （AnythingLLM server 为单进程，进程内锁即可）。

const prisma = require("../prisma");
const { Workspace } = require("../../models/workspace");
const { WorkspaceUser } = require("../../models/workspaceUsers");
const { ROLES } = require("../middleware/multiUserProtected");
const {
  FTS_SPRITE_WORKSPACE_NAME,
  FTS_SPRITE_WORKSPACE_SLUG,
} = require("./constants");

const NOT_PROVISIONED_MESSAGE = "精灵尚未开通，请联系管理员";

let creating = null; // 进程内创建锁（Promise）

async function findFtsSpriteWorkspace() {
  return (
    (await Workspace.get({ slug: FTS_SPRITE_WORKSPACE_SLUG })) ||
    (await Workspace.get({ name: FTS_SPRITE_WORKSPACE_NAME }))
  );
}

async function grantAccess(workspace, user) {
  // 单用户模式（user 为空）与 admin / manager 不需要单独授权
  if (!user?.id || user.role === ROLES.admin || user.role === ROLES.manager) return;
  const link = await prisma.workspace_users.findFirst({
    where: { workspace_id: workspace.id, user_id: user.id },
  });
  if (!link) await WorkspaceUser.create(user.id, workspace.id);
}

async function createFtsSpriteWorkspace(user) {
  // 拿到锁之后再查一次：可能已被并发请求创建
  const existing = await findFtsSpriteWorkspace();
  if (existing) return existing;

  const { workspace, message } = await Workspace.new(
    FTS_SPRITE_WORKSPACE_NAME,
    user?.id ?? null,
    { chatMode: "chat" }
  );
  if (!workspace) {
    console.error("[ensureFtsSpriteWorkspace] Workspace.new failed:", message);
    return null;
  }

  // slug 不在 Workspace.writable 白名单内，直接 prisma.update 固定下来；
  // 默认参数与画布 Sprite Response 节点一致（温度 0.1，历史窗口 3），管理员可在设置里修改。
  await prisma.workspaces.update({
    where: { id: workspace.id },
    data: {
      slug: FTS_SPRITE_WORKSPACE_SLUG,
      chatMode: "chat",
      openAiTemp: 0.1,
      openAiHistory: 3,
    },
  });
  console.log(
    `[ensureFtsSpriteWorkspace] created workspace "${FTS_SPRITE_WORKSPACE_NAME}" by user ${user?.id ?? "(single-user)"}`
  );
  return Workspace.get({ id: workspace.id });
}

/**
 * @param {{id: number, role: string}|null} user - 单用户模式下为 null
 * @param {{canCreate: boolean}} opts - 是否允许创建（管理员或单用户模式）
 * @returns {Promise<{workspace: Object|null, error: null|"not_provisioned"|"create_failed", message?: string}>}
 */
async function ensureFtsSpriteWorkspace(user, { canCreate }) {
  let workspace = await findFtsSpriteWorkspace();

  if (!workspace) {
    if (!canCreate) {
      return { workspace: null, error: "not_provisioned", message: NOT_PROVISIONED_MESSAGE };
    }
    if (!creating) {
      creating = createFtsSpriteWorkspace(user).finally(() => {
        creating = null;
      });
    }
    workspace = await creating;
    if (!workspace) return { workspace: null, error: "create_failed" };
  }

  await grantAccess(workspace, user);
  return { workspace, error: null };
}

module.exports = { ensureFtsSpriteWorkspace, NOT_PROVISIONED_MESSAGE };

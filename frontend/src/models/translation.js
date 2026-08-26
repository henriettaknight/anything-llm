/**
 * Translation API client
 * 封装 /api/translation/* 调用。
 *
 * 翻译主流程已迁移到原生 stream-chat 端点（见 server/endpoints/chat.js 的
 * isTranslationWorkspace 分支）。这里只保留 glossaries / health / ensure-workspace。
 */

import { AUTH_TOKEN } from "@/utils/constants";

const BASE = "/api/translation";

// 统一注入 JWT（validatedRequest 中间件要求）
function authHeaders(extra = {}) {
  const token = window.localStorage.getItem(AUTH_TOKEN) || "";
  return {
    Authorization: token ? `Bearer ${token}` : "",
    ...extra,
  };
}

export async function listGlossaries() {
  const resp = await fetch(`${BASE}/glossaries`, { headers: authHeaders() });
  if (!resp.ok) throw new Error(`listGlossaries HTTP ${resp.status}`);
  return resp.json();
}

/**
 * 确保当前用户存在翻译 workspace，返回 { slug, name }
 */
export async function ensureWorkspace() {
  const resp = await fetch(`${BASE}/ensure-workspace`, {
    headers: authHeaders(),
  });
  if (!resp.ok) throw new Error(`ensureWorkspace HTTP ${resp.status}`);
  return resp.json();
}

export async function getHealth() {
  const resp = await fetch(`${BASE}/health`, { headers: authHeaders() });
  if (!resp.ok) throw new Error(`getHealth HTTP ${resp.status}`);
  return resp.json();
}

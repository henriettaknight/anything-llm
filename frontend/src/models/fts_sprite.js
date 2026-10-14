// FTS 精灵 API client（/api/fts_sprite/*）
import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

const FtsSprite = {
  /**
   * 进入精灵：返回 { slug, name }。
   * workspace 不存在时只有管理员会自动创建；其他用户得到
   * { error: "not_provisioned", message: "精灵尚未开通，请联系管理员" }。
   * @returns {Promise<{slug?: string, name?: string, error?: string, message?: string}>}
   */
  ensureWorkspace: async function () {
    try {
      const res = await fetch(`${API_BASE}/fts_sprite/ensure-workspace`, {
        headers: baseHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          error: data.error || `HTTP ${res.status}`,
          message: data.message || "精灵暂时无法进入，请稍后再试",
        };
      }
      return data;
    } catch (e) {
      return { error: "network_error", message: "精灵暂时无法进入，请稍后再试" };
    }
  },
};

export default FtsSprite;

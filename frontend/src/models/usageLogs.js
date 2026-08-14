/**
 * 用量明细 API 封装
 *
 * 对应后端 /api/usage-logs/code-review 系列端点。
 * 仅查询当前登录用户自己的 code_review 用量数据。
 */

import { getAuthHeaders } from "@/utils/request";

const API_BASE = "/api/usage-logs";

const UsageLogsAPI = {
  /**
   * 获取当前用户的 code_review 用量明细（顺带返回汇总，避免多一次请求）。
   * @param {Object} [opts]
   * @param {number} [opts.page=1]
   * @param {number} [opts.pageSize=20]
   * @param {string} [opts.startDate]  ISO string
   * @param {string} [opts.endDate]    ISO string
   * @param {string} [opts.model]
   * @returns {Promise<{success:boolean, records?:Array, pagination?:Object, summary?:Object, error?:string}>}
   */
  getCodeReviewUsage: async ({ page = 1, pageSize = 20, startDate, endDate, model } = {}) => {
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      if (model) params.set("model", model);

      const res = await fetch(`${API_BASE}/code-review?${params.toString()}`, {
        credentials: "include",
        headers: await getAuthHeaders(),
      });
      if (!res.ok) {
        return { success: false, error: `HTTP ${res.status}` };
      }
      return res.json();
    } catch (e) {
      console.error("[usageLogs] getCodeReviewUsage failed:", e.message);
      return { success: false, error: e.message };
    }
  },

  /**
   * 获取按模型/按天的汇总（本期前端不调用，预留给后续图表扩展）。
   */
  getCodeReviewSummary: async () => {
    try {
      const res = await fetch(`${API_BASE}/code-review/summary`, {
        credentials: "include",
        headers: await getAuthHeaders(),
      });
      if (!res.ok) {
        return { success: false, error: `HTTP ${res.status}` };
      }
      return res.json();
    } catch (e) {
      console.error("[usageLogs] getCodeReviewSummary failed:", e.message);
      return { success: false, error: e.message };
    }
  },
};

export default UsageLogsAPI;

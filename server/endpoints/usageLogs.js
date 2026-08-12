const prisma = require("../utils/prisma");
const { userFromSession } = require("../utils/http");
const { validatedRequest } = require("../utils/middleware/validatedRequest");

/**
 * 代码检测功能用量查询端点
 *
 * 仅展示当前登录用户自己的 code_review 用量数据，不暴露他人数据。
 * 数据源：usage_logs 表（写入端在 stream.js / directAiProxy.js，本端点只读）。
 */
function usageLogsEndpoints(app) {
  if (!app) return;

  /**
   * GET /api/usage-logs/code-review
   * 返回当前用户的 code_review 用量明细（分页）+ 顺带汇总（避免前端多一次请求）。
   *
   * Query:
   *   page       int   页码，默认 1
   *   pageSize   int   每页条数，默认 20，上限 100
   *   startDate  ISO   起始时间（可选）
   *   endDate    ISO   截止时间（可选）
   *   model      string 按模型过滤（可选）
   */
  app.get(
    "/usage-logs/code-review",
    [validatedRequest],
    async (request, response) => {
      try {
        const user = await userFromSession(request, response);
        if (!user) return; // userFromSession 已写入 401

        const page = Math.max(1, parseInt(request.query.page) || 1);
        const pageSize = Math.min(
          100,
          Math.max(1, parseInt(request.query.pageSize) || 20)
        );

        const where = { feature: "code_review", userId: user.id };
        if (request.query.startDate) {
          where.occurredAt = {
            ...where.occurredAt,
            gte: new Date(request.query.startDate),
          };
        }
        if (request.query.endDate) {
          where.occurredAt = {
            ...where.occurredAt,
            lte: new Date(request.query.endDate),
          };
        }
        if (request.query.model) {
          where.model = request.query.model;
        }

        const [total, records, agg] = await Promise.all([
          prisma.usage_logs.count({ where }),
          prisma.usage_logs.findMany({
            where,
            orderBy: { occurredAt: "desc" },
            skip: (page - 1) * pageSize,
            take: pageSize,
            // 不返回 userId / workspaceId / threadId 等敏感字段
            select: {
              id: true,
              provider: true,
              model: true,
              promptTokens: true,
              completionTokens: true,
              totalTokens: true,
              durationMs: true,
              occurredAt: true,
            },
          }),
          prisma.usage_logs.aggregate({
            where,
            _sum: {
              promptTokens: true,
              completionTokens: true,
              totalTokens: true,
              durationMs: true,
            },
            _avg: { durationMs: true, totalTokens: true },
            _count: true,
          }),
        ]);

        return response.status(200).json({
          success: true,
          records,
          pagination: {
            page,
            pageSize,
            total,
            totalPages: Math.ceil(total / pageSize),
          },
          summary: {
            totalCalls: agg._count,
            totalPromptTokens: agg._sum.promptTokens || 0,
            totalCompletionTokens: agg._sum.completionTokens || 0,
            totalTokens: agg._sum.totalTokens || 0,
            totalDurationMs: agg._sum.durationMs || 0,
            avgDurationMs: Math.round(agg._avg.durationMs) || 0,
            avgTotalTokens: Math.round(agg._avg.totalTokens) || 0,
          },
        });
      } catch (e) {
        console.error("[usage_logs] listCodeReviewUsage failed:", e.message);
        return response.status(500).json({ success: false, error: "Internal server error" });
      }
    }
  );

  /**
   * GET /api/usage-logs/code-review/summary
   * 返回当前用户的 code_review 按模型 / 按天汇总（后续扩展用，本期前端不调用）。
   */
  app.get(
    "/usage-logs/code-review/summary",
    [validatedRequest],
    async (request, response) => {
      try {
        const user = await userFromSession(request, response);
        if (!user) return;

        const where = { feature: "code_review", userId: user.id };

        const [byModelRaw, byDayRaw] = await Promise.all([
          prisma.usage_logs.groupBy({
            by: ["model"],
            where,
            _count: true,
            _sum: { totalTokens: true, durationMs: true },
            _avg: { durationMs: true },
          }),
          prisma.$queryRaw`
            SELECT
              DATE(occurredAt) AS day,
              COUNT(*) AS calls,
              COALESCE(SUM("totalTokens"), 0) AS "totalTokens"
            FROM "usage_logs"
            WHERE "feature" = 'code_review' AND "userId" = ${user.id}
            GROUP BY DATE(occurredAt)
            ORDER BY day DESC
          `,
        ]);

        return response.status(200).json({
          success: true,
          byModel: byModelRaw.map((r) => ({
            model: r.model,
            calls: r._count,
            totalTokens: r._sum.totalTokens || 0,
            totalDurationMs: r._sum.durationMs || 0,
            avgDurationMs: Math.round(r._avg.durationMs) || 0,
          })),
          byDay: byDayRaw.map((r) => ({
            day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day),
            calls: Number(r.calls),
            totalTokens: Number(r.totalTokens),
          })),
        });
      } catch (e) {
        console.error("[usage_logs] summary failed:", e.message);
        return response.status(500).json({ success: false, error: "Internal server error" });
      }
    }
  );
}

module.exports = { usageLogsEndpoints };

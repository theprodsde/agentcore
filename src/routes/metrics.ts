import { Router } from "express";
import { eq, sql, gte, and } from "drizzle-orm";
import { db, tasks, checkpoints } from "../server/db/index.js";
import { getCached, setCached } from "../server/cache.js";
import { asyncHandler } from "../server/http.js";

export const metricsRouter = Router();

const METRICS_TTL_MS = 60 * 1000; // 60 s — data changes at most once per task completion

metricsRouter.get("/metrics", asyncHandler(async (req, res) => {
  const cacheKey = `metrics:${req.teamId ?? "global"}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  const teamFilter = req.teamId ? eq(tasks.team_id, req.teamId) : undefined;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const since = teamFilter
    ? and(teamFilter, gte(tasks.created_at, thirtyDaysAgo))
    : gte(tasks.created_at, thirtyDaysAgo);

  const [taskSummary] = await db.select({
    total:     sql<number>`COUNT(*)`,
    completed: sql<number>`COUNT(*) FILTER (WHERE status = 'completed')`,
    failed:    sql<number>`COUNT(*) FILTER (WHERE status = 'failed')`,
    avg_ttc_ms: sql<number>`AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) * 1000) FILTER (WHERE status = 'completed')`,
    avg_retries: sql<number>`AVG(resume_count)`,
  }).from(tasks).where(since);

  // Step stats bounded to the same 30-day window to avoid full-table scans
  const stepStats = await db.select({
    step_name:    checkpoints.step_name,
    avg_ms:       sql<number>`AVG(duration_ms)`,
    p95_ms:       sql<number>`PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)`,
    count:        sql<number>`COUNT(*)`,
  })
    .from(checkpoints)
    .where(and(eq(checkpoints.step_status, "success"), gte(checkpoints.created_at, thirtyDaysAgo)))
    .groupBy(checkpoints.step_name)
    .orderBy(checkpoints.step_name);

  // Success rate by week (last 8 weeks)
  const weeklyTrend = await db.select({
    week:          sql<string>`DATE_TRUNC('week', created_at)::date`,
    total:         sql<number>`COUNT(*)`,
    completed:     sql<number>`COUNT(*) FILTER (WHERE status = 'completed')`,
    avg_ttc_ms:    sql<number>`AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) * 1000) FILTER (WHERE status = 'completed')`,
  })
    .from(tasks)
    .where(
      teamFilter
        ? and(teamFilter, gte(tasks.created_at, new Date(Date.now() - 56 * 24 * 60 * 60 * 1000)))
        : gte(tasks.created_at, new Date(Date.now() - 56 * 24 * 60 * 60 * 1000))
    )
    .groupBy(sql`DATE_TRUNC('week', created_at)`)
    .orderBy(sql`DATE_TRUNC('week', created_at)`);

  const total = Number(taskSummary?.total ?? 0);
  const completed = Number(taskSummary?.completed ?? 0);

  const response = {
    period: "last_30_days",
    summary: {
      total_tasks:    total,
      completed:      completed,
      failed:         Number(taskSummary?.failed ?? 0),
      success_rate:   total > 0 ? parseFloat((completed / total * 100).toFixed(1)) : 0,
      avg_ttc_ms:     taskSummary?.avg_ttc_ms ? Math.round(Number(taskSummary.avg_ttc_ms)) : null,
      avg_ttc_s:      taskSummary?.avg_ttc_ms ? parseFloat((Number(taskSummary.avg_ttc_ms) / 1000).toFixed(1)) : null,
      avg_retries:    taskSummary?.avg_retries ? parseFloat(Number(taskSummary.avg_retries).toFixed(2)) : 0,
    },
    step_breakdown: stepStats.map(s => ({
      step_name: s.step_name,
      avg_ms:    Math.round(Number(s.avg_ms)),
      p95_ms:    Math.round(Number(s.p95_ms)),
      count:     Number(s.count),
    })),
    weekly_trend: weeklyTrend.map(w => ({
      week:        w.week,
      total:       Number(w.total),
      completed:   Number(w.completed),
      success_rate: Number(w.total) > 0
        ? parseFloat((Number(w.completed) / Number(w.total) * 100).toFixed(1))
        : 0,
      avg_ttc_s:   w.avg_ttc_ms ? parseFloat((Number(w.avg_ttc_ms) / 1000).toFixed(1)) : null,
    })),
  };

  // Cache the result — metrics change only when a task completes (every few minutes)
  setCached(cacheKey, response, METRICS_TTL_MS);
  return res.json(response);
}));

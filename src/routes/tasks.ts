import { Router, type Response } from "express";
import { eq, desc, and, gte, sql } from "drizzle-orm";
import { db, tasks, checkpoints } from "../server/db/index.js";
import { runTaskOrchestrator, taskEventEmitter } from "../server/executor.js";
import { asyncHandler } from "../server/http.js";
import { taskCreationRateLimit } from "../server/rateLimit.js";
import { CreateTaskSchema, zodMessage } from "../server/validation.js";
import { generateTraceId } from "../utils/index.js";
import { incidentSimilarity } from "../utils/algorithms.js";

export const tasksRouter = Router();

// ─── Task creation with deduplication ─────────────────────────────────────────

const DEDUP_WINDOW_MS  = 10 * 60 * 1000;
const DEDUP_THRESHOLD  = 0.6;
const DEDUP_CANDIDATES = 20;

/** Normalized lock key: identical alert storms serialize on the same advisory lock. */
function dedupLockKey(goal: string, teamId: string | null): string {
  const words = goal.toLowerCase().split(/\W+/).filter((w) => w.length > 3).sort();
  return `${teamId ?? "public"}:${words.join(" ")}`;
}

type CreateResult =
  | { kind: "duplicate"; task: typeof tasks.$inferSelect; similarity: number }
  | { kind: "created"; task: typeof tasks.$inferSelect };

/**
 * Dedup check + insert inside one transaction holding a pg advisory lock on the
 * normalized goal, so two identical alerts arriving simultaneously (the classic
 * alert-storm pattern) cannot both pass the check and create twin investigations.
 */
async function dedupAndCreateTask(
  input: ReturnType<typeof CreateTaskSchema.parse>,
  teamId: string | null
): Promise<CreateResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${teamId ?? 'public'}), hashtext(${dedupLockKey(input.goal, teamId)}))`);

    if (!input.inject_failure && !input.dry_run) {
      const windowStart = new Date(Date.now() - DEDUP_WINDOW_MS);
      const recentActive = await tx.select().from(tasks)
        .where(
          and(
            gte(tasks.created_at, windowStart),
            sql`${tasks.status} IN ('pending','running')`,
            // Never correlate across teams — dedup must not reveal another team's task
            sql`${tasks.team_id} IS NOT DISTINCT FROM ${teamId}`
          )
        )
        .orderBy(desc(tasks.created_at))
        .limit(DEDUP_CANDIDATES);

      for (const candidate of recentActive) {
        const similarity = incidentSimilarity(input.goal, candidate.goal);
        if (similarity >= DEDUP_THRESHOLD) return { kind: "duplicate", task: candidate, similarity };
      }
    }

    const [newTask] = await tx.insert(tasks).values({
      goal: input.goal,
      context: input.context,
      task_type: input.task_type,
      user_id: input.user_id,
      trace_id: generateTraceId(),
      inject_failure: input.inject_failure,
      dry_run: input.dry_run,
      team_id: teamId,
    }).returning();

    return { kind: "created", task: newTask };
  });
}

tasksRouter.post("/tasks", taskCreationRateLimit, asyncHandler(async (req, res) => {
  const parsed = CreateTaskSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });

  const result = await dedupAndCreateTask(parsed.data, req.teamId ?? null);

  if (result.kind === "duplicate") {
    return res.status(200).json({
      task_id: result.task.task_id,
      status: result.task.status,
      trace_id: result.task.trace_id,
      correlated: true,
      message: `Similar incident already being investigated (${Math.round(result.similarity * 100)}% match). Returning existing task.`,
    });
  }

  setImmediate(() => runTaskOrchestrator(result.task.task_id));
  return res.status(201).json({
    task_id: result.task.task_id,
    status: "pending",
    trace_id: result.task.trace_id,
    dry_run: result.task.dry_run,
    correlated: false,
  });
}));

// ─── Task list (paginated) ────────────────────────────────────────────────────

// List responses omit the two large text blobs (final_output, context) —
// the dashboard only renders summary fields; the detail endpoint returns everything.
const taskSummaryColumns = {
  task_id:      tasks.task_id,
  team_id:      tasks.team_id,
  goal:         tasks.goal,
  task_type:    tasks.task_type,
  user_id:      tasks.user_id,
  status:       tasks.status,
  current_step: tasks.current_step,
  resume_count: tasks.resume_count,
  error:        tasks.error,
  trace_id:     tasks.trace_id,
  dry_run:      tasks.dry_run,
  created_at:   tasks.created_at,
  updated_at:   tasks.updated_at,
} as const;

tasksRouter.get("/tasks", asyncHandler(async (req, res) => {
  const pageSize = Math.min(Math.max(1, Number(req.query.limit) || 50), 200);
  const offset   = Math.max(0, Number(req.query.offset) || 0);

  const rows = req.teamId
    ? await db.select(taskSummaryColumns).from(tasks).where(eq(tasks.team_id, req.teamId))
        .orderBy(desc(tasks.created_at)).limit(pageSize).offset(offset)
    : await db.select(taskSummaryColumns).from(tasks)
        .orderBy(desc(tasks.created_at)).limit(pageSize).offset(offset);

  return res.json({ items: rows, limit: pageSize, offset });
}));

/** Loads a task and enforces team ownership. Sends the error response itself and returns null on failure. */
async function loadAuthorizedTask(taskId: string, teamId: string | undefined, res: Response) {
  const [task] = await db.select().from(tasks).where(eq(tasks.task_id, taskId));
  if (!task) { res.status(404).json({ error: "Task not found" }); return null; }
  if (teamId && task.team_id && task.team_id !== teamId) { res.status(403).json({ error: "Forbidden" }); return null; }
  return task;
}

tasksRouter.get("/tasks/:task_id", asyncHandler(async (req, res) => {
  const task = await loadAuthorizedTask(req.params.task_id, req.teamId, res);
  if (!task) return;
  return res.json(task);
}));

// ─── Checkpoints + SSE ────────────────────────────────────────────────────────

tasksRouter.get("/tasks/:task_id/checkpoints", asyncHandler(async (req, res) => {
  // Checkpoints contain full tool output — same team check as the task itself
  const task = await loadAuthorizedTask(req.params.task_id, req.teamId, res);
  if (!task) return;
  // Deterministic order — row order from an unordered SELECT is not guaranteed
  const rows = await db.select().from(checkpoints)
    .where(eq(checkpoints.task_id, req.params.task_id))
    .orderBy(checkpoints.step_number, checkpoints.created_at);
  return res.json({ task_id: req.params.task_id, checkpoints: rows });
}));

const SSE_TIMEOUT_MS = 10 * 60 * 1000; // 10 min — prevents zombie connections
const SSE_HEARTBEAT_MS = 25 * 1000;    // keep proxies/load balancers from closing idle streams

tasksRouter.get("/tasks/:task_id/stream", asyncHandler(async (req, res) => {
  const { task_id } = req.params;
  const task = await loadAuthorizedTask(task_id, req.teamId, res);
  if (!task) return;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.write(`data: {"connected":true}\n\n`);

  const onUpdate = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  taskEventEmitter.on(`checkpoint-${task_id}`, onUpdate);
  taskEventEmitter.on(`task-update-${task_id}`, onUpdate);

  // Comment-only heartbeat frames keep intermediaries (nginx, ALB) from
  // closing the connection during quiet stretches between checkpoints.
  const heartbeat = setInterval(() => res.write(`: heartbeat\n\n`), SSE_HEARTBEAT_MS);

  // Auto-close if a task stays stuck and the client never disconnects
  const timeout = setTimeout(() => {
    cleanup();
    res.write(`data: {"timeout":true}\n\n`);
    res.end();
  }, SSE_TIMEOUT_MS);

  const cleanup = () => {
    clearTimeout(timeout);
    clearInterval(heartbeat);
    taskEventEmitter.off(`checkpoint-${task_id}`, onUpdate);
    taskEventEmitter.off(`task-update-${task_id}`, onUpdate);
  };
  req.on("close", cleanup);
}));

// ─── Resume ────────────────────────────────────────────────────────────────────

tasksRouter.post("/tasks/:task_id/resume", asyncHandler(async (req, res) => {
  const { task_id } = req.params;
  const task = await loadAuthorizedTask(task_id, req.teamId, res);
  if (!task) return;
  if (task.status !== "failed") return res.status(400).json({ error: "Only failed tasks can be resumed" });

  const [updated] = await db.update(tasks)
    .set({ status: "pending", error: null, resume_count: task.resume_count + 1, updated_at: new Date() })
    .where(eq(tasks.task_id, task_id))
    .returning();

  setImmediate(() => runTaskOrchestrator(task_id));
  return res.json({ task_id, status: "running", resume_count: updated.resume_count });
}));

// ─── Post-mortem Markdown export ─────────────────────────────────────────────

tasksRouter.get("/tasks/:task_id/export.md", asyncHandler(async (req, res) => {
  const task = await loadAuthorizedTask(req.params.task_id, req.teamId, res);
  if (!task) return;
  if (!task.final_output) return res.status(400).json({ error: "Task has no output yet" });

  const cps = await db.select().from(checkpoints)
    .where(eq(checkpoints.task_id, task.task_id))
    .orderBy(checkpoints.step_number, checkpoints.created_at);
  let synth: Record<string, unknown> = {};
  try { synth = JSON.parse(task.final_output); } catch { /* ignore */ }

  const totalMs = cps.filter(c => c.step_status === "success" || c.step_status === "failed")
    .reduce((s, c) => s + c.duration_ms, 0);

  const md = `# Post-Mortem: ${task.goal}

**Trace ID:** \`${task.trace_id}\`
**Created:** ${new Date(task.created_at).toUTCString()}
**Resolved:** ${new Date(task.updated_at).toUTCString()}
**Total duration:** ${(totalMs / 1000).toFixed(1)}s
**Retries:** ${task.resume_count}
${task.dry_run ? "**Mode:** Dry run (no ticket created, no memory written)\n" : ""}
---

## Summary

${synth.summary ?? "_Not available_"}

## Probable Cause

${synth.probable_cause ?? "_Not available_"}

## Affected Systems

${((synth.affected_systems as string[]) ?? []).map(s => `- \`${s}\``).join("\n") || "_None identified_"}

## Next Actions

${((synth.next_actions as string[]) ?? []).map((a, i) => `${i + 1}. ${a}`).join("\n") || "_None recommended_"}

## Ticket

${synth.ticket_id ? `\`${synth.ticket_id}\`` : "_Not created_"}

## Checkpoint Timeline

| Step | Name | Status | Duration |
|------|------|--------|----------|
${cps.map(c => `| ${c.step_number} | ${c.step_name.replace(/_/g, " ")} | ${c.step_status} | ${c.duration_ms < 1000 ? `${c.duration_ms}ms` : `${(c.duration_ms / 1000).toFixed(1)}s`} |`).join("\n")}

---
*Generated by AgentCore*
`;

  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="postmortem-${task.trace_id}.md"`);
  return res.send(md);
}));

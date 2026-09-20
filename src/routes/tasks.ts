import { Router, type Response } from "express";
import { eq, desc, and, gte, sql } from "drizzle-orm";
import { db, tasks, checkpoints } from "../server/db/index.js";
import { runTaskOrchestrator, taskEventEmitter } from "../server/executor.js";
import { getLLMClient } from "../server/llm.js";
import { asyncHandler } from "../server/http.js";
import { generateTraceId } from "../utils/index.js";
import { jaccardSimilarity, editSimilarity } from "../utils/algorithms.js";

export const tasksRouter = Router();

// ─── Task creation with deduplication ─────────────────────────────────────────

tasksRouter.post("/tasks", asyncHandler(async (req, res) => {
  const { goal, context, task_type, user_id, inject_failure, dry_run } = req.body;
  if (!goal) return res.status(400).json({ error: "Missing goal" });

  // Incident deduplication: if a semantically similar task is already running or
  // pending (created within the last 10 minutes), return it instead of creating
  // a duplicate investigation.
  // Uses combined Levenshtein DP (30%) + Jaccard word-overlap (70%) — see src/utils/algorithms.ts
  if (!inject_failure && !dry_run && getLLMClient()) {
    try {
      const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000);
      const recentActive = await db.select().from(tasks)
        .where(
          and(
            gte(tasks.created_at, tenMinsAgo),
            sql`${tasks.status} IN ('pending','running')`,
            // Never correlate across teams — dedup must not reveal another team's task
            sql`${tasks.team_id} IS NOT DISTINCT FROM ${req.teamId ?? null}`
          )
        )
        .orderBy(desc(tasks.created_at))
        .limit(20);

      // Pre-compute goal word set once — not inside the loop (E-2 memoization fix)
      const goalWords = new Set<string>(goal.toLowerCase().split(/\W+/).filter(w => w.length > 3));

      // Request-scoped pair cache — if the same (goal, candidate) pair is evaluated
      // multiple times (e.g., rapid retries), the DP similarity is not recomputed.
      // Keys are sorted so (a,b) and (b,a) share the same entry.
      const pairMemo = new Map<string, number>();

      for (const t of recentActive) {
        const memoKey = [goal, t.goal].sort().join("\x00");
        let similarity = pairMemo.get(memoKey);

        if (similarity === undefined) {
          const tWords = new Set<string>(t.goal.toLowerCase().split(/\W+/).filter(w => w.length > 3));
          // Three-way blend matching incidentSimilarity() (55% Jaccard + 25% bounded edit + 20% LCS)
          // Inlined here so we reuse the pre-computed goalWords set
          const { lcsSimilarity, boundedEditSimilarity } = await import("../utils/algorithms.js");
          similarity = jaccardSimilarity(goalWords, tWords) * 0.55
            + boundedEditSimilarity(goal, t.goal) * 0.25
            + lcsSimilarity(goal, t.goal) * 0.20;
          pairMemo.set(memoKey, similarity);
        }
        if (similarity >= 0.6) {
          return res.status(200).json({
            task_id: t.task_id,
            status: t.status,
            trace_id: t.trace_id,
            correlated: true,
            message: `Similar incident already being investigated (${Math.round(similarity * 100)}% match). Returning existing task.`,
          });
        }
      }
    } catch {
      // Non-fatal — proceed with task creation if dedup check fails
    }
  }

  const traceId = generateTraceId();
  const [newTask] = await db.insert(tasks).values({
    goal,
    context: context || "",
    task_type: task_type || "incident",
    user_id: user_id || "demo-user-1",
    trace_id: traceId,
    inject_failure: inject_failure || false,
    dry_run: dry_run || false,
    team_id: req.teamId ?? null,
  }).returning();

  setImmediate(() => runTaskOrchestrator(newTask.task_id));
  return res.status(201).json({
    task_id: newTask.task_id,
    status: "pending",
    trace_id: traceId,
    dry_run: newTask.dry_run,
    correlated: false,
  });
}));

// ─── Task list (paginated) ────────────────────────────────────────────────────

tasksRouter.get("/tasks", asyncHandler(async (req, res) => {
  const pageSize = Math.min(Math.max(1, Number(req.query.limit) || 50), 200);
  const offset   = Math.max(0, Number(req.query.offset) || 0);

  const rows = req.teamId
    ? await db.select().from(tasks).where(eq(tasks.team_id, req.teamId))
        .orderBy(desc(tasks.created_at)).limit(pageSize).offset(offset)
    : await db.select().from(tasks)
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
  const rows = await db.select().from(checkpoints).where(eq(checkpoints.task_id, req.params.task_id));
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

  const cps = await db.select().from(checkpoints).where(eq(checkpoints.task_id, task.task_id));
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

import { Router } from "express";
import { eq, desc, and, gte, sql } from "drizzle-orm";
import { db, tasks, checkpoints } from "../server/db/index.js";
import { runTaskOrchestrator, taskEventEmitter } from "../server/executor.js";
import { getLLMClient } from "../server/llm.js";
import { generateTraceId } from "../utils/index.js";
import { jaccardSimilarity, editSimilarity } from "../utils/algorithms.js";

export const tasksRouter = Router();

// ─── Task creation with deduplication ─────────────────────────────────────────

tasksRouter.post("/tasks", async (req, res) => {
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
            sql`${tasks.status} IN ('pending','running')`
          )
        )
        .orderBy(desc(tasks.created_at))
        .limit(20);

      // Pre-compute goal word set once — not inside the loop (E-2 DP memoization fix)
      const goalWords = new Set<string>(goal.toLowerCase().split(/\W+/).filter(w => w.length > 3));

      for (const t of recentActive) {
        const tWords = new Set(t.goal.toLowerCase().split(/\W+/).filter(w => w.length > 3));
        // Combined: 70% Jaccard word-overlap + 30% Levenshtein edit distance
        const similarity = jaccardSimilarity(goalWords, tWords) * 0.7 + editSimilarity(goal, t.goal) * 0.3;
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
});

// ─── Task list (paginated) ────────────────────────────────────────────────────

tasksRouter.get("/tasks", async (req, res) => {
  const pageSize = Math.min(Math.max(1, Number(req.query.limit) || 50), 200);
  const offset   = Math.max(0, Number(req.query.offset) || 0);

  const rows = req.teamId
    ? await db.select().from(tasks).where(eq(tasks.team_id, req.teamId))
        .orderBy(desc(tasks.created_at)).limit(pageSize).offset(offset)
    : await db.select().from(tasks)
        .orderBy(desc(tasks.created_at)).limit(pageSize).offset(offset);

  return res.json({ items: rows, limit: pageSize, offset });
});

tasksRouter.get("/tasks/:task_id", async (req, res) => {
  const [task] = await db.select().from(tasks).where(eq(tasks.task_id, req.params.task_id));
  if (!task) return res.status(404).json({ error: "Task not found" });
  if (req.teamId && task.team_id && task.team_id !== req.teamId) return res.status(403).json({ error: "Forbidden" });
  return res.json(task);
});

// ─── Checkpoints + SSE ────────────────────────────────────────────────────────

tasksRouter.get("/tasks/:task_id/checkpoints", async (req, res) => {
  const rows = await db.select().from(checkpoints).where(eq(checkpoints.task_id, req.params.task_id));
  return res.json({ task_id: req.params.task_id, checkpoints: rows });
});

const SSE_TIMEOUT_MS = 10 * 60 * 1000; // 10 min — prevents zombie connections

tasksRouter.get("/tasks/:task_id/stream", (req, res) => {
  const { task_id } = req.params;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.write(`data: {"connected":true}\n\n`);

  const onUpdate = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  taskEventEmitter.on(`checkpoint-${task_id}`, onUpdate);
  taskEventEmitter.on(`task-update-${task_id}`, onUpdate);

  // Auto-close if a task stays stuck and the client never disconnects
  const timeout = setTimeout(() => {
    res.write(`data: {"timeout":true}\n\n`);
    res.end();
  }, SSE_TIMEOUT_MS);

  const cleanup = () => {
    clearTimeout(timeout);
    taskEventEmitter.off(`checkpoint-${task_id}`, onUpdate);
    taskEventEmitter.off(`task-update-${task_id}`, onUpdate);
  };
  req.on("close", cleanup);
});

// ─── Resume ────────────────────────────────────────────────────────────────────

tasksRouter.post("/tasks/:task_id/resume", async (req, res) => {
  const { task_id } = req.params;
  const [task] = await db.select().from(tasks).where(eq(tasks.task_id, task_id));
  if (!task) return res.status(404).json({ error: "Task not found" });
  if (req.teamId && task.team_id && task.team_id !== req.teamId) return res.status(403).json({ error: "Forbidden" });
  if (task.status !== "failed") return res.status(400).json({ error: "Only failed tasks can be resumed" });

  const [updated] = await db.update(tasks)
    .set({ status: "pending", error: null, resume_count: task.resume_count + 1, updated_at: new Date() })
    .where(eq(tasks.task_id, task_id))
    .returning();

  setImmediate(() => runTaskOrchestrator(task_id));
  return res.json({ task_id, status: "running", resume_count: updated.resume_count });
});

// ─── Post-mortem Markdown export ─────────────────────────────────────────────

tasksRouter.get("/tasks/:task_id/export.md", async (req, res) => {
  const [task] = await db.select().from(tasks).where(eq(tasks.task_id, req.params.task_id));
  if (!task) return res.status(404).json({ error: "Task not found" });
  if (req.teamId && task.team_id && task.team_id !== req.teamId) return res.status(403).json({ error: "Forbidden" });
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
});

import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { db, tasks, checkpoints } from "../server/db/index.js";
import { runTaskOrchestrator, taskEventEmitter } from "../server/executor.js";
import { generateTraceId } from "../utils/index.js";

export const tasksRouter = Router();

tasksRouter.post("/tasks", async (req, res) => {
  const { goal, context, task_type, user_id, inject_failure } = req.body;
  if (!goal) return res.status(400).json({ error: "Missing goal" });

  const traceId = generateTraceId();
  const [newTask] = await db.insert(tasks).values({
    goal,
    context: context || "",
    task_type: task_type || "incident",
    user_id: user_id || "demo-user-1",
    trace_id: traceId,
    inject_failure: inject_failure || false,
    team_id: req.teamId ?? null,
  }).returning();

  setImmediate(() => runTaskOrchestrator(newTask.task_id));
  return res.status(201).json({ task_id: newTask.task_id, status: "pending", trace_id: traceId });
});

tasksRouter.get("/tasks", async (req, res) => {
  const rows = req.teamId
    ? await db.select().from(tasks).where(eq(tasks.team_id, req.teamId)).orderBy(desc(tasks.created_at))
    : await db.select().from(tasks).orderBy(desc(tasks.created_at));
  return res.json({ items: rows });
});

tasksRouter.get("/tasks/:task_id", async (req, res) => {
  const [task] = await db.select().from(tasks).where(eq(tasks.task_id, req.params.task_id));
  if (!task) return res.status(404).json({ error: "Task not found" });
  if (req.teamId && task.team_id && task.team_id !== req.teamId) return res.status(403).json({ error: "Forbidden" });
  return res.json(task);
});

tasksRouter.get("/tasks/:task_id/checkpoints", async (req, res) => {
  const rows = await db.select().from(checkpoints).where(eq(checkpoints.task_id, req.params.task_id));
  return res.json({ task_id: req.params.task_id, checkpoints: rows });
});

tasksRouter.get("/tasks/:task_id/stream", (req, res) => {
  const { task_id } = req.params;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.write(`data: {"connected":true}\n\n`);

  const onUpdate = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  taskEventEmitter.on(`checkpoint-${task_id}`, onUpdate);
  taskEventEmitter.on(`task-update-${task_id}`, onUpdate);
  req.on("close", () => {
    taskEventEmitter.off(`checkpoint-${task_id}`, onUpdate);
    taskEventEmitter.off(`task-update-${task_id}`, onUpdate);
  });
});

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

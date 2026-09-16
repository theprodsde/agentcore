/**
 * Webhook ingestion — normalises alert payloads from PagerDuty, OpsGenie,
 * and Prometheus Alertmanager into AgentCore tasks automatically.
 */
import { Router } from "express";
import { db, tasks } from "../server/db/index.js";
import { runTaskOrchestrator } from "../server/executor.js";
import { generateTraceId } from "../utils/index.js";
import { logger } from "../server/logger.js";

export const webhooksRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createTaskFromAlert(goal: string, context: string, source: string) {
  const traceId = generateTraceId();
  const [newTask] = await db.insert(tasks).values({
    goal,
    context: `Auto-triggered from ${source}: ${context}`,
    task_type: "incident",
    user_id: `webhook:${source}`,
    trace_id: traceId,
    inject_failure: false,
    dry_run: false,
  }).returning();

  setImmediate(() => runTaskOrchestrator(newTask.task_id));
  logger.info({ source, task_id: newTask.task_id, goal }, "Task created from webhook");
  return { task_id: newTask.task_id, trace_id: traceId };
}

// ─── PagerDuty ────────────────────────────────────────────────────────────────

webhooksRouter.post("/webhooks/pagerduty", async (req, res) => {
  // Acknowledge immediately — PagerDuty expects < 200ms
  res.status(202).json({ accepted: true });

  try {
    const messages: unknown[] = req.body?.messages ?? [];
    for (const msg of messages) {
      const event = msg as Record<string, unknown>;
      if (event.event !== "incident.trigger" && event.event !== "incident.alert") continue;

      const incident = (event.incident ?? event.log_entry) as Record<string, unknown> | undefined;
      const title   = (incident?.title ?? incident?.description ?? "Unknown PagerDuty incident") as string;
      const service = ((incident?.service as Record<string, unknown>)?.summary ?? "unknown-service") as string;
      const urgency = (incident?.urgency ?? "high") as string;
      const url     = (incident?.html_url ?? "") as string;

      const goal = `${title} — ${service}`;
      const context = `Urgency: ${urgency}. PagerDuty URL: ${url}`;
      await createTaskFromAlert(goal, context, "pagerduty");
    }
  } catch (err) {
    logger.error({ err }, "Failed to process PagerDuty webhook");
  }
});

// ─── OpsGenie ─────────────────────────────────────────────────────────────────

webhooksRouter.post("/webhooks/opsgenie", async (req, res) => {
  res.status(202).json({ accepted: true });

  try {
    const body = req.body as Record<string, unknown>;
    if (body.action !== "Create") return;

    const alert  = (body.alert ?? {}) as Record<string, unknown>;
    const title  = (alert.message ?? "Unknown OpsGenie alert") as string;
    const source = (alert.source ?? "unknown-service") as string;
    const tags   = ((alert.tags as string[]) ?? []).join(", ");

    const goal    = `${title} — ${source}`;
    const context = `Tags: ${tags || "none"}. OpsGenie alert ID: ${alert.alertId ?? ""}`;
    await createTaskFromAlert(goal, context, "opsgenie");
  } catch (err) {
    logger.error({ err }, "Failed to process OpsGenie webhook");
  }
});

// ─── Prometheus Alertmanager ──────────────────────────────────────────────────

webhooksRouter.post("/webhooks/alertmanager", async (req, res) => {
  res.status(202).json({ accepted: true });

  try {
    const body   = req.body as Record<string, unknown>;
    const alerts = (body.alerts as Record<string, unknown>[]) ?? [];

    for (const alert of alerts) {
      if (alert.status !== "firing") continue;

      const labels     = (alert.labels ?? {}) as Record<string, string>;
      const annotations = (alert.annotations ?? {}) as Record<string, string>;

      const name     = labels.alertname ?? "Unknown Alert";
      const service  = labels.service ?? labels.job ?? "unknown-service";
      const severity = labels.severity ?? "warning";
      const summary  = annotations.summary ?? annotations.description ?? "";

      const goal    = `${name} on ${service}`;
      const context = `Severity: ${severity}. ${summary}. Labels: ${JSON.stringify(labels)}`;
      await createTaskFromAlert(goal, context, "alertmanager");
    }
  } catch (err) {
    logger.error({ err }, "Failed to process Alertmanager webhook");
  }
});

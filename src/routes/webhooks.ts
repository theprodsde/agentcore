/**
 * Webhook ingestion — normalises alert payloads from PagerDuty, OpsGenie,
 * and Prometheus Alertmanager into AgentCore tasks automatically.
 */
import crypto from "crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import { db, tasks } from "../server/db/index.js";
import { runTaskOrchestrator } from "../server/executor.js";
import { generateTraceId } from "../utils/index.js";
import { logger } from "../server/logger.js";

// ─── Signature verification middleware ───────────────────────────────────────

function verifyHmac(secret: string, payload: string, signature: string, algorithm = "sha256"): boolean {
  const expected = crypto.createHmac(algorithm, secret).update(payload).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature.replace(/^sha256=/, ""), "hex"));
  } catch { return false; }
}

function requirePagerDutySignature(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.PAGERDUTY_WEBHOOK_SECRET;
  if (!secret) return next(); // skip if not configured (development)
  const sig = req.headers["x-pagerduty-signature"] as string | undefined;
  if (!sig || !verifyHmac(secret, JSON.stringify(req.body), sig)) {
    return res.status(401).json({ error: "Invalid PagerDuty signature" });
  }
  next();
}

function requireOpsGenieSignature(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.OPSGENIE_WEBHOOK_SECRET;
  if (!secret) return next();
  const sig = req.headers["x-opsgenie-hmac-sha256-signature"] as string | undefined;
  if (!sig || !verifyHmac(secret, JSON.stringify(req.body), sig)) {
    return res.status(401).json({ error: "Invalid OpsGenie signature" });
  }
  next();
}

function requireAlertmanagerSecret(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.ALERTMANAGER_SECRET;
  if (!secret) return next();
  const provided = req.headers["x-alertmanager-secret"] as string | undefined;
  if (provided !== secret) return res.status(401).json({ error: "Invalid Alertmanager secret" });
  next();
}

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

webhooksRouter.post("/webhooks/pagerduty", requirePagerDutySignature, async (req, res) => {
  // Acknowledge immediately — PagerDuty expects < 200ms
  res.status(202).json({ accepted: true });

  // Process all alerts in parallel — independent DB inserts, no reason to serialise
  Promise.all(
    ((req.body?.messages ?? []) as Record<string, unknown>[])
      .filter(event => event.event === "incident.trigger" || event.event === "incident.alert")
      .map(event => {
        const incident = (event.incident ?? event.log_entry) as Record<string, unknown> | undefined;
        const title   = (incident?.title ?? incident?.description ?? "Unknown PagerDuty incident") as string;
        const service = ((incident?.service as Record<string, unknown>)?.summary ?? "unknown-service") as string;
        const urgency = (incident?.urgency ?? "high") as string;
        const url     = (incident?.html_url ?? "") as string;
        return createTaskFromAlert(`${title} — ${service}`, `Urgency: ${urgency}. PagerDuty URL: ${url}`, "pagerduty");
      })
  ).catch(err => logger.error({ err }, "Failed to process PagerDuty webhook"));
});

// ─── OpsGenie ─────────────────────────────────────────────────────────────────

webhooksRouter.post("/webhooks/opsgenie", requireOpsGenieSignature, async (req, res) => {
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

webhooksRouter.post("/webhooks/alertmanager", requireAlertmanagerSecret, async (req, res) => {
  res.status(202).json({ accepted: true });

  // Process all firing alerts in parallel
  Promise.all(
    (((req.body as Record<string, unknown>).alerts as Record<string, unknown>[]) ?? [])
      .filter(alert => alert.status === "firing")
      .map(alert => {
        const labels      = (alert.labels ?? {}) as Record<string, string>;
        const annotations = (alert.annotations ?? {}) as Record<string, string>;
        const name        = labels.alertname ?? "Unknown Alert";
        const service     = labels.service ?? labels.job ?? "unknown-service";
        const severity    = labels.severity ?? "warning";
        const summary     = annotations.summary ?? annotations.description ?? "";
        return createTaskFromAlert(
          `${name} on ${service}`,
          `Severity: ${severity}. ${summary}. Labels: ${JSON.stringify(labels)}`,
          "alertmanager"
        );
      })
  ).catch(err => logger.error({ err }, "Failed to process Alertmanager webhook"));
});

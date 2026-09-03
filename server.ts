import "dotenv/config";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { z } from "zod";
import crypto from "crypto";
import { eq } from "drizzle-orm";

const ConfigSchema = z.object({
  OPENAI_API_KEY:              z.string().optional(),
  OPENAI_BASE_URL:             z.string().optional(),
  DATABASE_URL:                z.string(),
  PORT:                        z.coerce.number().default(3000),
  JWT_SECRET:                  z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  LOG_LEVEL:                   z.string().optional(),
});

const config = (() => {
  try {
    return ConfigSchema.parse(process.env);
  } catch (err) {
    console.error("❌ Invalid environment variables:", err);
    process.exit(1);
  }
})();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { logger } from "./src/server/logger.js";
import { sendSlackResponse } from "./src/server/slack.js";
import { db, tasks } from "./src/server/db/index.js";
import { runTaskOrchestrator, recoverStaleTasks } from "./src/server/executor.js";
import { listMcpTools } from "./src/server/mcp.js";
import { getLLMClient, LLM_MODELS } from "./src/server/llm.js";
import { authMiddleware, isAuthEnabled } from "./src/server/auth.js";
import { parseLLMJson, generateTraceId, toErrorMessage } from "./src/utils/index.js";

import { healthRouter } from "./src/routes/health.js";
import { authRouter }   from "./src/routes/auth.js";
import { tasksRouter }  from "./src/routes/tasks.js";
import { memoryRouter } from "./src/routes/memory.js";

// ─── Public routes (no auth) ──────────────────────────────────────────────────

app.post("/api/slack/events", async (req, res) => {
  const body = req.body || {};
  if (body.type === "url_verification") {
    return res.status(200).type("text/plain").send(body.challenge);
  }

  const { event } = body;
  logger.info({ event: req.body }, "Slack event received");
  res.status(200).send();

  if (event?.type === "message" && !event.bot_id && event.text) {
    const text: string = event.text.trim();
    if (text.startsWith("!incident ") || text.startsWith("<@")) {
      const goal = text.replace("!incident ", "").replace(/<@[^>]+>/g, "").trim();
      const traceId = generateTraceId();

      const [newTask] = await db.insert(tasks).values({
        goal,
        context: `Triggered from Slack Channel: ${event.channel}`,
        task_type: "incident",
        user_id: event.user || "slack-user",
        trace_id: traceId,
        inject_failure: false,
      }).returning();

      await sendSlackResponse(event.channel, event.ts, [], `*Task Enqueued:* \`${traceId}\`\nWorking on: ${goal}...`);

      try {
        await runTaskOrchestrator(newTask.task_id);
        const [finalTask] = await db.select().from(tasks).where(eq(tasks.task_id, newTask.task_id));
        if (finalTask?.status === "completed") {
          await sendSlackResponse(event.channel, event.ts, [], `*Task Completed:* \`${traceId}\`\n\n${finalTask.final_output}`);
        } else if (finalTask?.status === "failed") {
          await sendSlackResponse(event.channel, event.ts, [], `*Task Failed:* \`${traceId}\`\nError: ${finalTask.error}`);
        }
      } catch (err) {
        logger.error({ err }, "Task orchestrator failed from Slack event");
      }
    }
  }
});

app.get("/api/slack/oauth_redirect", (_req, res) => {
  res.send("Slack OAuth redirect successful. You can close this window.");
});

app.get("/api/tools", async (_req, res) => {
  try {
    const tools = await listMcpTools();
    return res.json({ tools });
  } catch (err) {
    logger.error({ err }, "Failed to list MCP tools");
    return res.status(503).json({ error: "MCP tools server unavailable" });
  }
});

// Incident simulation (quick LLM call, not checkpointed — for demo purposes)
app.post("/api/simulate", async (req, res) => {
  const { title, description, severity, channel } = req.body;
  if (!title || !description) return res.status(400).json({ error: "Missing incident title or description" });

  const ai = getLLMClient();
  const traceId = generateTraceId();

  if (!ai) {
    const isDbSpike = title.toLowerCase().includes("database") || title.toLowerCase().includes("pg");
    const isOom = title.toLowerCase().includes("memory") || title.toLowerCase().includes("oom");
    await new Promise((r) => setTimeout(r, 2000));
    return res.json({
      plannerOutput: {
        plan: `Automated analysis for "${title}".`,
        steps: [
          { stepNumber: 1, outputData: isDbSpike ? "Discovered deadlock in reports-writer." : isOom ? "Memory spike in service." : "Anomalous config detected." },
          { stepNumber: 2, outputData: isDbSpike ? "Terminated idle connections." : isOom ? "Drained container." : "Reverted routing config." },
          { stepNumber: 3, outputData: "Synthesized post-mortem. Wrote episodic memory." },
        ],
      },
      suggestedMemory: { goal: isDbSpike ? "Clear PG locks" : isOom ? "Handle OOM" : "Resolve routing timeout", outcome: "Mitigated." },
      remediation: {
        report: `[POST-MORTEM: ${traceId}] Channel: ${channel || "ops"}. Investigated and mitigated automatically.`,
        actionTaken: isDbSpike ? "Reset max_connections." : isOom ? "Scaled replicas." : "Flushed caches.",
      },
      traceId,
      fallbackMode: true,
    });
  }

  try {
    const completion = await ai.chat.completions.create({
      model: LLM_MODELS.PLANNER,
      messages: [
        { role: "system", content: `Analyze the incident and produce a remediation plan. Output raw JSON: {"plannerOutput":{"plan":"string","steps":[{"stepNumber":1,"outputData":"string"}]},"suggestedMemory":{"goal":"string","outcome":"string"},"remediation":{"report":"string","actionTaken":"string"}}` },
        { role: "user", content: `Title: ${title}\nDescription: ${description}\nSeverity: ${severity}\nChannel: ${channel}` },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    });
    const data = parseLLMJson(completion.choices[0].message.content || "{}");
    return res.json({ ...(data as object), traceId, fallbackMode: false });
  } catch (err) {
    return res.status(500).json({ error: "Simulation pipeline failed", details: toErrorMessage(err) });
  }
});

app.use("/api", authRouter);

// Apply JWT auth to all remaining /api routes
app.use("/api", authMiddleware);

app.use("/api", healthRouter);
app.use("/api", tasksRouter);
app.use("/api", memoryRouter);

// ─── Frontend ─────────────────────────────────────────────────────────────────

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  app.listen(config.PORT, "0.0.0.0", async () => {
    console.log(`AgentCore running on http://localhost:${config.PORT}`);
    await recoverStaleTasks();
  });
}

startServer();

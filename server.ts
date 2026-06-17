import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import OpenAI from "openai";
import { z } from "zod";

dotenv.config();

// ST-001: Environment and config foundation
const ConfigSchema = z.object({
  OPENAI_API_KEY: z.string().optional(),
  COMET_API_BASE_URL: z.string().default("https://api.cometapi.com/v1"),
  PORT: z.coerce.number().default(3000),
});

const parseConfig = () => {
  try {
    return ConfigSchema.parse(process.env);
  } catch (error) {
    console.error("❌ Invalid environment variables:", error);
    process.exit(1);
  }
};

const config = parseConfig();

const app = express();
const PORT = 3000;

  // Body parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

// Lazy-initialize OpenAI Client with Comet API base URL
let aiInstance: OpenAI | null = null;
function getOpenAIClient(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY || "sk-Mlb1tbUTb9VVoZcx9pCKqTHeQQTnjgKd8ge4jloaFrjGf24f";
  if (!key || key.trim() === "") {
    return null;
  }
  if (!aiInstance) {
    aiInstance = new OpenAI({
      apiKey: key,
      baseURL: "https://api.cometapi.com/v1",
    });
  }
  return aiInstance;
}

import { logger } from "./src/server/logger.js";
import { getSlackClient, sendSlackResponse } from "./src/server/slack.js";

// ST-061: Slack event ingestion webhook
app.post("/api/slack/events", async (req, res) => {
  logger.info({ headers: req.headers, body: req.body }, "Received request on /api/slack/events");
  
  const body = req.body || {};

  // 1. Initial Challenge verification for Slack Event Subscriptions
  if (body.type === "url_verification") {
    // Slack explicitly says: respond with HTTP 200 and the challenge string
    // Sending it as plain text or JSON both work. We'll send plain text to be absolutely safe
    // and avoid any JSON encoding issues.
    return res.status(200).type("text/plain").send(body.challenge);
  }

  const { event } = body;

  // 2. Further Event Handling (ST-061 / ST-062)
  logger.info({ event: req.body }, "Slack event received");
  
  // Acknowledge immediately to prevent Slack retry timeouts
  res.status(200).send();

  if (event && event.type === "message" && !event.bot_id && event.text) {
    const text = event.text.trim();
    if (text.startsWith("!incident ") || text.startsWith("<@")) {
      const goal = text.replace("!incident ", "").replace(/<@[^>]+>/g, "").trim();
      
      const taskId = crypto.randomUUID();
      const traceId = `tr-${Math.random().toString(36).substring(2, 11)}-${Date.now().toString().slice(-4)}`;
      
      const newTask: Task = {
        task_id: taskId,
        goal,
        context: `Triggered from Slack Channel: ${event.channel}`,
        task_type: "incident",
        user_id: event.user,
        status: "pending",
        resume_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        final_output: null,
        error: null,
        trace_id: traceId,
        inject_failure: false,
      };

      inMemoryDB.tasks.set(taskId, newTask);

      // Acknowledge in thread
      await sendSlackResponse(event.channel, event.ts, [], `*Task Enqueued:* \`${traceId}\`\nWorking on: ${goal}...`);

      try {
        await runTaskOrchestrator(taskId);
        
        const finalTask = inMemoryDB.tasks.get(taskId);
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

// OAuth Redirect for Slack
app.get("/api/slack/oauth_redirect", (req, res) => {
  res.send("Slack OAuth redirect successful. You can close this window.");
});

// 1. Health API Route
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    system: "Slack Incident Commander + GPT-4o-Mini MemoryAgent",
    llmConfigured: getOpenAIClient() !== null,
  });
});

// 2. Incident Simulation API (Direct AI Core integration)
app.post("/api/simulate", async (req, res) => {
  const { title, description, severity, channel } = req.body;

  if (!title || !description) {
    return res.status(400).json({ error: "Missing incident title or description" });
  }

  const ai = getOpenAIClient();
  const traceId = `tr-${Math.random().toString(36).substring(2, 11)}-${Date.now().toString().slice(-4)}`;

  if (!ai) {
    // Elegant fallbacks for offline or unconfigured environments using procedural smart generator.
    console.log("Using procedural smart engine fallback for incident simulation.");
    const isDbSpike = title.toLowerCase().includes("database") || title.toLowerCase().includes("pg");
    const isOom = title.toLowerCase().includes("memory") || title.toLowerCase().includes("oom");

    const fallbackResponse = {
      plannerOutput: {
        plan: `Stateless Incident analysis for "${title}". Triggered distributed lock on Redis for idempotency. Checking checkpoint databases.`,
        steps: [
          {
            stepNumber: 1,
            outputData: isDbSpike
              ? "Successfully queried PG table list. Discovered 12 concurrent holding transactions from service 'reports-writer'."
              : isOom
              ? "Polled Pod metrics on auth-service deployment. Witnessed sudden 300% memory allocation increase after version release."
              : "Scanned telemetry logs for recent deployment tags. Discovered anomalous network configurations.",
          },
          {
            stepNumber: 2,
            outputData: isDbSpike
              ? "Terminated idle process backend PID 2049. Confirmed connection pool count dropped under 40%."
              : isOom
              ? "Triggered container drain on auth-service. Instantiated fresh replica with updated stack flags."
              : "Reverted configuration state in routing table. Polled endpoint for latency recovery.",
          },
          {
            stepNumber: 3,
            outputData: "Synthesized post-mortem recommendations. Generated episodic memory log. Alerted Slack operations.",
          },
        ],
      },
      suggestedMemory: isDbSpike
        ? {
            goal: "Reboot PG clusters and clear locks",
            outcome: "Terminating reporting-service connections drop idle limits instantly. Increased max pool limits.",
          }
        : isOom
        ? {
            goal: "Handle runaway Pod memory leaks in Node/Go runtimes",
            outcome: "Identified infinite loop in channel references. Swapped to buffered queues. Added strict sandbox container limits.",
          }
        : {
            goal: "Resolve general routing timeout",
            outcome: "Flushed Local Cache. Swapped bad gateway mapping config.",
          },
      remediation: {
        report: `[POST-MORTEM REPORT: ${traceId}]\n\nTrigger: Slack Alert received in ${channel || "operations"}.\nRoot Cause Analysis: Investigated system performance metrics using MCP adapters.\nResolution: Automatically mitigated using the Incident Commander automation routine.\nRecommended Precautions: Establish connection threshold alerts at 80% with automated worker throttling.`,
        actionTaken: isDbSpike
          ? "Reset PostgreSQL max_connections to 300 and restarted database proxies."
          : isOom
          ? "Scaled up replicas to 3 and adjusted JVM/Go garbage collector intervals."
          : "Flushed edge caches and adjusted Keep-Alive headers in API Gateway.",
      },
      traceId,
      fallbackMode: true,
    };

    // Inject a small simulated duration delay for visual UI fidelity
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return res.json(fallbackResponse);
  }

  try {
    const prompt = `Analyze this simulated live Slack Incident:
Title: ${title}
Description: ${description}
Severity: ${severity}
Channel: ${channel}`;

    const completion = await ai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are GPT-4o-Mini running inside the Slack Incident Commander runtime.
Analyze the incident alert, choose appropriate diagnostic steps, suggest MCP tools to execute, match episodic memory contexts, and build a full remediation post-mortem.
You MUST output raw JSON matching this structure EXACTLY (do not wrap in markdown or backticks, return pure parsable JSON):
{
  "plannerOutput": {
    "plan": "Give a concise architectural diagnosis plan",
    "steps": [
      { "stepNumber": 1, "outputData": "Specify what diagnostics are conducted in step 1" },
      { "stepNumber": 2, "outputData": "Specify tool outcomes in step 2" },
      { "stepNumber": 3, "outputData": "Specify output of synthesis in step 3" }
    ]
  },
  "suggestedMemory": {
    "goal": "Describe a general historic incident goal that matches this case closely",
    "outcome": "Describe the resolution of that historic case"
  },
  "remediation": {
    "report": "Formulate a professional post-mortem analysis containing triggers, findings, and resolutions",
    "actionTaken": "Describe the ultimate automation block triggered by the bot"
  }
}`
        },
        { role: "user", content: prompt }
      ],
      temperature: 0.2, // low temperature for highly stable procedural code outputs
      response_format: { type: "json_object" }
    });

    const text = completion.choices[0].message.content || "{}";
    const data = JSON.parse(text.trim());
    return res.json({
      ...data,
      traceId,
      fallbackMode: false,
    });
  } catch (error: any) {
    console.error("OpenAI API simulation call failed:", error);
    return res.status(500).json({
      error: "AI simulation pipeline encountered an error",
      details: error.message,
    });
  }
});

// 3. Cognitive Memory Extrapolator API (OpenAI semantic modeling)
app.post("/api/memory/query", async (req, res) => {
  const { query, memories } = req.body;

  if (!query) {
    return res.status(400).json({ error: "Query query is required" });
  }

  const ai = getOpenAIClient();
  if (!ai) {
    // Local text parsing similarity emulator
    console.log("No AI client configured for semantic matching; using word frequency similarity heuristics.");
    const words0 = query.toLowerCase().split(/\W+/);
    const scored = (memories || []).map((m: any) => {
      const combinedText = `${m.goal} ${m.outcome}`.toLowerCase();
      let matches = 0;
      words0.forEach((w: string) => {
        if (w.length > 2 && combinedText.includes(w)) {
          matches += 1;
        }
      });
      const similarity = Math.min(1.0, 0.15 + (matches / Math.max(words0.length, 3)) * 0.85);
      return { ...m, similarity };
    });

    const sorted = scored.sort((a: any, b: any) => (b.similarity || 0) - (a.similarity || 0));
    return res.json({ matches: sorted });
  }

  try {
    const prompt = `Query semantic matcher request.
We want to score a collection of historic episodic memories based on how relevant they are to the current search query or target incident.
Search Query: "${query}"

Memories collection:
${JSON.stringify(memories, null, 2)}

Calculate cosine similarity scores relative to the query.
Output a JSON object containing a property 'matches' which is an array of identical structured items but with a calculated 'similarity' decimal score between 0.0 and 1.0 inserted into each item.
Your response must be a valid JSON object. Example:
{
  "matches": [
    { "id": "mem-001", "goal": "...", "outcome": "...", "similarity": 0.95 }
  ]
}`;

    const completion = await ai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are an advanced dense-vector semantic matching model. Calculate conceptual similarities between a search query and multiple memories."
        },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" }
    });

    const text = completion.choices[0].message.content || '{"matches": []}';
    const parsedData = JSON.parse(text.trim());
    const parsedMatches = parsedData.matches || [];
    return res.json({ matches: parsedMatches });
  } catch (error: any) {
    console.error("Semantic memory scaling failed:", error);
    return res.status(500).json({ error: "Memory retrieval failure", details: error.message });
  }
});

import { inMemoryDB, Task } from "./src/server/db";
import { runTaskOrchestrator, taskEventEmitter } from "./src/server/executor";
import crypto from "crypto";

// --- Epic E3: Task lifecycle and recovery ---

// ST-020 — Task creation API
app.post("/api/tasks", (req, res) => {
  const { goal, context, task_type, user_id, inject_failure } = req.body;
  
  if (!goal) return res.status(400).json({ error: "Missing goal" });

  const taskId = crypto.randomUUID();
  const traceId = `tr-${Math.random().toString(36).substring(2, 11)}-${Date.now().toString().slice(-4)}`;

  const newTask: Task = {
    task_id: taskId,
    goal,
    context: context || "",
    task_type: task_type || "incident",
    user_id: user_id || "demo-user-1",
    status: "pending",
    resume_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    final_output: null,
    error: null,
    trace_id: traceId,
    inject_failure: inject_failure || false,
  };

  inMemoryDB.tasks.set(taskId, newTask);

  // ST-024: Run executor asynchronously
  setImmediate(() => {
    runTaskOrchestrator(taskId);
  });

  return res.status(201).json({
    task_id: taskId,
    status: "pending",
    trace_id: traceId
  });
});

app.get("/api/tasks", (req, res) => {
  const tasks = Array.from(inMemoryDB.tasks.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  return res.json({ items: tasks });
});

// ST-021 — Task details API
app.get("/api/tasks/:task_id", (req, res) => {
  const task = inMemoryDB.tasks.get(req.params.task_id);
  if (!task) return res.status(404).json({ error: "Task not found" });
  return res.json(task);
});

// ST-022 — Checkpoint listing API
app.get("/api/tasks/:task_id/checkpoints", (req, res) => {
  const checkpoints = inMemoryDB.checkpoints.get(req.params.task_id) || [];
  return res.json({ task_id: req.params.task_id, checkpoints });
});

// ST-023 — Live status stream
app.get("/api/tasks/:task_id/stream", (req, res) => {
  const taskId = req.params.task_id;
  
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  
  // Send an initial ping
  res.write(`data: {"connected": true}\n\n`);

  const onUpdate = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  taskEventEmitter.on(`checkpoint-${taskId}`, onUpdate);
  taskEventEmitter.on(`task-update-${taskId}`, onUpdate);

  req.on("close", () => {
    taskEventEmitter.off(`checkpoint-${taskId}`, onUpdate);
    taskEventEmitter.off(`task-update-${taskId}`, onUpdate);
  });
});

// ST-026 — Manual resume API
app.post("/api/tasks/:task_id/resume", (req, res) => {
  const taskId = req.params.task_id;
  const task = inMemoryDB.tasks.get(taskId);
  
  if (!task) return res.status(404).json({ error: "Task not found" });
  if (task.status !== "failed") {
    return res.status(400).json({ error: "Only failed tasks can be resumed" });
  }

  task.resume_count += 1;
  task.status = "pending";
  task.error = null;
  task.updated_at = new Date().toISOString();
  inMemoryDB.tasks.set(taskId, task);

  // Resume orchestrator asynchronously
  setImmediate(() => {
    runTaskOrchestrator(taskId);
  });

  return res.status(200).json({
    task_id: taskId,
    status: "running",
    resume_count: task.resume_count
  });
});

// --- Epic E4: Memory system ---

// ST-031 — Episodic memory retrieval API
app.get("/api/tasks/:task_id/memory", (req, res) => {
  const taskId = req.params.task_id;
  // This simplifies ST-031 by strictly returning all memories for visual inspection.
  // We can filter out memories from *this exact task* if we want
  const relatedMemories = inMemoryDB.memories.filter(m => m.task_id !== taskId).slice(0, 5);

  return res.json({
    task_id: taskId,
    related_memories: relatedMemories
  });
});

app.get("/api/memory", (req, res) => {
  return res.json({ items: inMemoryDB.memories });
});


// Serve frontend assets
async function setupViteServerOrStatic() {
  if (process.env.NODE_ENV !== "production") {
    // Development Mode
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite developmental asset middleware hooked into Express.");
  } else {
    // Production Mode
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log("Production precompiled static server operational.");
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server active and accessible on http://localhost:${PORT}`);
  });
}

setupViteServerOrStatic();

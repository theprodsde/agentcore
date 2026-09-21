/**
 * AgentCore MCP Server — exposes a running AgentCore instance to any MCP
 * client (Claude Code, Claude Desktop, Cursor, ...).
 *
 * Runs over stdio and talks to AgentCore's REST API, so it works locally or
 * against a remote deployment, with or without JWT auth.
 *
 * Env:
 *   AGENTCORE_URL    — base URL of the AgentCore server (default: http://localhost:3000)
 *   AGENTCORE_TOKEN  — JWT bearer token (only needed when JWT_SECRET is set server-side)
 *
 * Example client config (Claude Desktop / Claude Code):
 *   {
 *     "mcpServers": {
 *       "agentcore": {
 *         "command": "node",
 *         "args": ["/path/to/agentcore/dist/tools/agentcore-mcp.cjs"],
 *         "env": { "AGENTCORE_URL": "http://localhost:3000" }
 *       }
 *     }
 *   }
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z, ZodError } from "zod";

const BASE_URL = (process.env.AGENTCORE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const TOKEN = process.env.AGENTCORE_TOKEN;

// ─── REST helpers ─────────────────────────────────────────────────────────────

async function api(pathname: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${pathname}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      ...init.headers,
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`AgentCore API ${res.status} on ${pathname}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return text; }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Schemas ──────────────────────────────────────────────────────────────────

const InvestigateSchema = z.object({
  goal:         z.string().min(1).describe("Incident description"),
  context:      z.string().optional(),
  dry_run:      z.boolean().optional().default(false),
  wait_seconds: z.number().int().min(0).max(300).optional().default(120),
});

const TaskIdSchema = z.object({ task_id: z.string().min(1) });

const SearchMemorySchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional().default(5),
});

// ─── Server ───────────────────────────────────────────────────────────────────

const server = new Server({ name: "agentcore", version: "0.1.0" }, {
  capabilities: { tools: {} },
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "investigate_incident",
      description:
        "Run an AgentCore incident investigation: retrieves similar past incidents from episodic memory, " +
        "plans tool calls with an LLM, queries logs/metrics/runbooks, and synthesizes a report. " +
        "Waits for completion by default and returns the synthesized incident report.",
      inputSchema: {
        type: "object",
        properties: {
          goal:         { type: "string", description: "Incident description, e.g. 'payments-service p99 latency at 4s after deploy v2.3'" },
          context:      { type: "string", description: "Optional extra context: alert payload, log snippets, recent changes" },
          dry_run:      { type: "boolean", description: "Skip side effects (no ticket creation, no memory write). Default false" },
          wait_seconds: { type: "number", description: "Max seconds to wait for completion (0 = return task_id immediately). Default 120" },
        },
        required: ["goal"],
      },
    },
    {
      name: "get_investigation",
      description: "Fetch an investigation's status, checkpoint timeline (per-step status and durations), and final report if completed.",
      inputSchema: {
        type: "object",
        properties: { task_id: { type: "string", description: "Task ID returned by investigate_incident" } },
        required: ["task_id"],
      },
    },
    {
      name: "search_incident_memory",
      description: "Semantic search over AgentCore's episodic memory of past incidents and their outcomes. Use to find how similar incidents were resolved before.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Incident description or error pattern to search for" },
          limit: { type: "number", description: "Max results (default 5)" },
        },
        required: ["query"],
      },
    },
    {
      name: "export_postmortem",
      description: "Export a completed investigation as a Markdown post-mortem (summary, probable cause, affected systems, next actions, checkpoint timeline).",
      inputSchema: {
        type: "object",
        properties: { task_id: { type: "string", description: "Task ID of a completed investigation" } },
        required: ["task_id"],
      },
    },
  ],
}));

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function investigateIncident(args: z.infer<typeof InvestigateSchema>) {
  const created = await api("/api/tasks", {
    method: "POST",
    body: JSON.stringify({ goal: args.goal, context: args.context ?? "", dry_run: args.dry_run }),
  }) as { task_id: string; trace_id: string; correlated?: boolean; message?: string };

  if (created.correlated) {
    return { ...created, note: "A similar investigation is already running — returning the existing task." };
  }
  if (args.wait_seconds === 0) {
    return { ...created, note: "Investigation started. Poll with get_investigation." };
  }

  const deadline = Date.now() + args.wait_seconds * 1000;
  while (Date.now() < deadline) {
    await sleep(2500);
    const task = await api(`/api/tasks/${created.task_id}`) as Record<string, unknown>;
    if (task.status === "completed") {
      return { task_id: created.task_id, trace_id: created.trace_id, status: "completed", report: safeParse(task.final_output) };
    }
    if (task.status === "failed") {
      return { task_id: created.task_id, trace_id: created.trace_id, status: "failed", error: task.error,
        note: "The task can be resumed from its last checkpoint via the AgentCore dashboard or POST /api/tasks/:id/resume." };
    }
  }
  return { ...created, status: "running", note: `Still running after ${args.wait_seconds}s. Poll with get_investigation.` };
}

async function getInvestigation(args: z.infer<typeof TaskIdSchema>) {
  const [task, cps] = await Promise.all([
    api(`/api/tasks/${args.task_id}`) as Promise<Record<string, unknown>>,
    api(`/api/tasks/${args.task_id}/checkpoints`) as Promise<{ checkpoints: Record<string, unknown>[] }>,
  ]);
  return {
    task_id: args.task_id,
    status: task.status,
    goal: task.goal,
    error: task.error ?? undefined,
    report: task.final_output ? safeParse(task.final_output) : undefined,
    checkpoints: cps.checkpoints.map((c) => ({
      step: c.step_number, name: c.step_name, status: c.step_status, duration_ms: c.duration_ms,
    })),
  };
}

async function searchIncidentMemory(args: z.infer<typeof SearchMemorySchema>) {
  return api("/api/memory/query", { method: "POST", body: JSON.stringify(args) });
}

async function exportPostmortem(args: z.infer<typeof TaskIdSchema>) {
  return api(`/api/tasks/${args.task_id}/export.md`);
}

function safeParse(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

const TOOL_REGISTRY: Record<string, (args: unknown) => Promise<unknown>> = {
  investigate_incident:   (args) => investigateIncident(InvestigateSchema.parse(args)),
  get_investigation:      (args) => getInvestigation(TaskIdSchema.parse(args)),
  search_incident_memory: (args) => searchIncidentMemory(SearchMemorySchema.parse(args)),
  export_postmortem:      (args) => exportPostmortem(TaskIdSchema.parse(args)),
};

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const handler = TOOL_REGISTRY[name];
  if (!handler) throw new Error(`Unknown tool: ${name}`);
  try {
    const result = await handler(args);
    const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
    return { content: [{ type: "text", text }] };
  } catch (err) {
    if (err instanceof ZodError) {
      throw new Error(`Invalid arguments for tool ${name}: ${err.issues.map(i => `${i.path.join(".")}: ${i.message}`).join(", ")}`);
    }
    throw err;
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("AgentCore MCP server failed to start:", err);
  process.exit(1);
});

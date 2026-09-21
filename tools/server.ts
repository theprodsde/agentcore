/**
 * AgentCore MCP Tool Server
 *
 * Runs as a subprocess communicating over stdio.
 * Exposes five tools: search_logs, get_metrics, search_runbook, create_ticket, list_services.
 *
 * Each tool checks for a real backend env var first; falls back to a
 * deterministic simulation so the stack works without any external infra.
 *
 * Real backends (opt-in via env):
 *   LOKI_URL          — Loki HTTP API for search_logs
 *   PROMETHEUS_URL    — Prometheus HTTP API for get_metrics
 *   LINEAR_API_KEY +
 *   LINEAR_TEAM_ID    — Linear API for create_ticket
 */

import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z, ZodError } from "zod";
import { simulateLogs, simulateMetrics, simulateServices, parseRange } from "./simulation.js";

// ─── Zod schemas for tool arg validation (G-2) ───────────────────────────────
const SearchLogsSchema = z.object({
  service:    z.string(),
  query:      z.string(),
  severity:   z.enum(["error", "warn", "info", "debug"]).optional(),
  limit:      z.number().int().positive().max(100).default(20),
  time_range: z.string().optional().default("1h"),
});

const GetMetricsSchema = z.object({
  service:    z.string(),
  metric:     z.string(),
  time_range: z.string().optional().default("1h"),
});

const CreateTicketSchema = z.object({
  title:            z.string(),
  description:      z.string(),
  severity:         z.enum(["critical", "high", "medium", "low"]),
  affected_service: z.string().optional(),
});

const ListServicesSchema = z.object({
  filter_status: z.enum(["all", "degraded", "down"]).optional().default("all"),
});

const SearchRunbookSchema = z.object({
  query:   z.string(),
  service: z.string().optional(),
});

const server = new Server({ name: "agentcore-tools", version: "1.0.0" }, {
  capabilities: { tools: {} },
});

// ─── Tool definitions ────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_logs",
      description: "Search structured logs for a service. Returns matching log entries with timestamps and severity.",
      inputSchema: {
        type: "object",
        properties: {
          service:    { type: "string", description: "Service name to search logs for, e.g. 'payments-service'" },
          query:      { type: "string", description: "Free-text search query or error pattern" },
          severity:   { type: "string", enum: ["error", "warn", "info", "debug"], description: "Minimum log severity" },
          limit:      { type: "number", description: "Max number of log lines to return (default 20)" },
          time_range: { type: "string", description: "Time range, e.g. '15m', '1h', '24h' (default '1h')" },
        },
        required: ["service", "query"],
      },
    },
    {
      name: "get_metrics",
      description: "Query time-series metrics for a service. Returns current values and recent trend.",
      inputSchema: {
        type: "object",
        properties: {
          service:    { type: "string", description: "Service name, e.g. 'payments-service'" },
          metric:     { type: "string", description: "Metric name or pattern, e.g. 'cpu_usage', 'error_rate', 'latency_p99'" },
          time_range: { type: "string", description: "Time range, e.g. '15m', '1h' (default '1h')" },
        },
        required: ["service", "metric"],
      },
    },
    {
      name: "create_ticket",
      description: "Create an incident ticket in the tracking system. Returns the ticket ID.",
      inputSchema: {
        type: "object",
        properties: {
          title:            { type: "string", description: "Ticket title" },
          description:      { type: "string", description: "Full incident description" },
          severity:         { type: "string", enum: ["critical", "high", "medium", "low"] },
          affected_service: { type: "string", description: "Primary service affected" },
        },
        required: ["title", "description", "severity"],
      },
    },
    {
      name: "list_services",
      description: "List known services and their current health status.",
      inputSchema: {
        type: "object",
        properties: {
          filter_status: { type: "string", enum: ["all", "degraded", "down"], description: "Filter by health status (default 'all')" },
        },
      },
    },
    {
      name: "search_runbook",
      description: "Search internal runbooks for procedures matching this incident type. Returns relevant runbook excerpts and recommended steps.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Incident description or error pattern to search for" },
          service: { type: "string", description: "Service name to narrow runbook search" },
        },
        required: ["query"],
      },
    },
  ],
}));

// ─── Tool handlers ────────────────────────────────────────────────────────────

// Tool registry — add new tools here without touching the dispatch loop.
// Each entry parses + validates args with Zod before calling the handler (G-2).
const TOOL_REGISTRY: Record<string, (args: unknown) => Promise<unknown>> = {
  search_logs:    (args) => searchLogs(SearchLogsSchema.parse(args)),
  get_metrics:    (args) => getMetrics(GetMetricsSchema.parse(args)),
  create_ticket:  (args) => createTicket(CreateTicketSchema.parse(args)),
  list_services:  (args) => listServices(ListServicesSchema.parse(args)),
  search_runbook: (args) => searchRunbook(SearchRunbookSchema.parse(args)),
};

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const handler = TOOL_REGISTRY[name];
  if (!handler) throw new Error(`Unknown tool: ${name}`);
  try {
    const result = await handler(args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    if (err instanceof ZodError) {
      throw new Error(`Invalid arguments for tool ${name}: ${err.issues.map(i => `${i.path.join(".")}: ${i.message}`).join(", ")}`);
    }
    throw err;
  }
});

// ─── search_logs ─────────────────────────────────────────────────────────────

interface SearchLogsArgs {
  service: string;
  query: string;
  severity?: string;
  limit?: number;
  time_range?: string;
}

async function searchLogs(args: SearchLogsArgs) {
  const { service, query, severity = "error", limit = 20, time_range = "1h" } = args;

  if (process.env.LOKI_URL) {
    return await queryLoki(service, query, severity, limit, time_range);
  }

  // Simulation: log content is derived from the world model's state for this
  // service (see tools/simulation.ts) — not from the query. Healthy or unknown
  // services return routine noise only, so "found nothing" is a possible outcome.
  const { total_matched, entries, note } = simulateLogs(service, query, limit);
  return {
    backend: "simulation",
    service,
    query,
    time_range,
    total_matched,
    ...(note ? { note } : {}),
    entries,
  };
}

async function queryLoki(service: string, query: string, _severity: string, limit: number, range: string) {
  const rangeSeconds = parseRange(range);
  const end = Math.floor(Date.now() / 1000);
  const start = end - rangeSeconds;
  const logql = `{service="${service}"} |~ "${query}"`;
  const url = `${process.env.LOKI_URL}/loki/api/v1/query_range?query=${encodeURIComponent(logql)}&start=${start}&end=${end}&limit=${limit}`;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Loki query failed: ${resp.status} ${await resp.text()}`);
  const data = await resp.json() as { data: { result: { values: [string, string][] }[] } };

  const entries = data.data.result.flatMap((stream) =>
    stream.values.map(([ts, line]) => ({
      timestamp: new Date(Number(ts) / 1e6).toISOString(),
      service,
      message: line,
    }))
  );

  return { backend: "loki", service, query, time_range: range, total_matched: entries.length, entries };
}

// ─── get_metrics ─────────────────────────────────────────────────────────────

interface GetMetricsArgs {
  service: string;
  metric: string;
  time_range?: string;
}

async function getMetrics(args: GetMetricsArgs) {
  const { service, metric, time_range = "1h" } = args;

  if (process.env.PROMETHEUS_URL) {
    return await queryPrometheus(service, metric, time_range);
  }

  // Simulation: values come from the world model — a healthy service reports
  // healthy numbers even if the caller expected a breach.
  const { threshold, ...sim } = simulateMetrics(service, metric, parseRange(time_range));
  return {
    backend: "simulation",
    service,
    metric,
    time_range,
    ...sim,
    ...(threshold !== null ? { threshold } : {}),
  };
}

async function queryPrometheus(service: string, metric: string, range: string) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - parseRange(range);
  const promql = `${metric}{service="${service}"}`;
  const url = `${process.env.PROMETHEUS_URL}/api/v1/query_range?query=${encodeURIComponent(promql)}&start=${start}&end=${end}&step=60`;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Prometheus query failed: ${resp.status}`);
  const data = await resp.json() as { data: { result: { values: [number, string][] }[] } };

  const result = data.data.result[0];
  const datapoints = (result?.values || []).map(([ts, val]) => ({
    timestamp: new Date(ts * 1000).toISOString(),
    value: parseFloat(val),
  }));
  const current = datapoints.at(-1)?.value ?? 0;

  return { backend: "prometheus", service, metric, time_range: range, current, datapoints };
}

// ─── create_ticket ────────────────────────────────────────────────────────────

interface CreateTicketArgs {
  title: string;
  description: string;
  severity: string;
  affected_service?: string;
}

async function createTicket(args: CreateTicketArgs) {
  const { title, description, severity, affected_service } = args;

  if (process.env.LINEAR_API_KEY && process.env.LINEAR_TEAM_ID) {
    return await createLinearTicket(args);
  }

  // Simulation
  const ticketId = `INC-${Math.floor(1000 + Math.random() * 9000)}`;
  return {
    backend: "simulation",
    ticket_id: ticketId,
    url: `https://linear.app/issues/${ticketId}`,
    title,
    severity,
    affected_service: affected_service || "unknown",
    status: "open",
    created_at: new Date().toISOString(),
  };
}

async function createLinearTicket(args: CreateTicketArgs) {
  const PriorityMap: Record<string, number> = { critical: 1, high: 2, medium: 3, low: 4 };
  const mutation = `
    mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) { success issue { id identifier title url } }
    }`;

  const resp = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: process.env.LINEAR_API_KEY! },
    body: JSON.stringify({
      query: mutation,
      variables: {
        input: {
          teamId: process.env.LINEAR_TEAM_ID,
          title: args.title,
          description: args.description,
          priority: PriorityMap[args.severity] ?? 3,
        },
      },
    }),
  });

  if (!resp.ok) throw new Error(`Linear API failed: ${resp.status}`);
  const { data } = await resp.json() as { data: { issueCreate: { success: boolean; issue: { identifier: string; title: string; url: string } } } };

  return {
    backend: "linear",
    ticket_id: data.issueCreate.issue.identifier,
    url: data.issueCreate.issue.url,
    title: data.issueCreate.issue.title,
    severity: args.severity,
    status: "open",
    created_at: new Date().toISOString(),
  };
}

// ─── list_services ────────────────────────────────────────────────────────────

interface ListServicesArgs {
  filter_status?: string;
}

async function listServices(args: ListServicesArgs) {
  const { filter_status = "all" } = args;
  const filtered = simulateServices(filter_status);

  return {
    backend: "simulation",
    total: filtered.length,
    services: filtered,
    checked_at: new Date().toISOString(),
  };
}

// ─── search_runbook ───────────────────────────────────────────────────────────

interface SearchRunbookArgs {
  query: string;
  service?: string;
}

async function searchRunbook(args: SearchRunbookArgs) {
  const { query, service } = args;

  if (process.env.RUNBOOK_URL) {
    try {
      const resp = await fetch(`${process.env.RUNBOOK_URL}/search?q=${encodeURIComponent(query)}&service=${encodeURIComponent(service ?? "")}`);
      if (resp.ok) {
        const data = await resp.json() as { results: unknown[] };
        return { backend: "runbook_api", query, results: data.results };
      }
    } catch { /* fall through to simulation */ }
  }

  // Simulation: return contextual runbook entries based on query keywords
  const q = query.toLowerCase();
  const isDeadlock  = q.includes("deadlock") || q.includes("lock");
  const isOom       = q.includes("oom") || q.includes("memory") || q.includes("heap");
  const isLatency   = q.includes("latency") || q.includes("slow") || q.includes("p99");
  const isCpu       = q.includes("cpu") || q.includes("throttl");
  const svc         = service ?? "your-service";

  const runbooks: { title: string; url: string; steps: string[] }[] = [];

  if (isDeadlock) runbooks.push({
    title: `DB Deadlock Runbook — ${svc}`,
    url: "#runbook/db-deadlock",
    steps: [
      "Check active transactions: `SELECT * FROM pg_locks JOIN pg_stat_activity USING (pid) WHERE NOT granted;`",
      "Kill blocking queries: `SELECT pg_cancel_backend(<pid>);`",
      "Increase `lock_timeout` to fail fast rather than wait indefinitely",
      "Review slow query log for missing indexes causing full-table scans",
    ],
  });

  if (isOom) runbooks.push({
    title: `Memory Leak / OOM Runbook — ${svc}`,
    url: "#runbook/oom-response",
    steps: [
      "Cordon the affected pod: `kubectl cordon <node>`",
      "Capture heap dump before restart: `kubectl exec <pod> -- node --prof`",
      "Drain and restart: `kubectl rollout restart deployment/${svc}`",
      "Set memory limits if not already configured in the Deployment spec",
      "Check for event-listener leaks using `process.listenerCount('data')`",
    ],
  });

  if (isLatency) runbooks.push({
    title: `High Latency Runbook — ${svc}`,
    url: "#runbook/latency",
    steps: [
      "Check downstream dependencies with `GET /api/health/detailed`",
      "Review circuit-breaker state — open breakers cause immediate fallback latency",
      "Query slow-query log: `SELECT query, mean_exec_time FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;`",
      "Scale horizontal replicas if CPU > 80%: `kubectl scale deployment/${svc} --replicas=N`",
    ],
  });

  if (isCpu) runbooks.push({
    title: `CPU Saturation Runbook — ${svc}`,
    url: "#runbook/cpu-saturation",
    steps: [
      "Identify hot function: attach profiler `clinic flame -- node server.js`",
      "Check for synchronous operations blocking the event loop",
      "Review recent deploys for N+1 query patterns or tight loops",
      "Horizontal scale immediately to restore SLO, then investigate root cause",
    ],
  });

  if (runbooks.length === 0) runbooks.push({
    title: `General Incident Response — ${svc}`,
    url: "#runbook/general",
    steps: [
      "Check service health endpoint and compare against last known-good baseline",
      "Review recent deploys (last 2h) for correlation",
      "Escalate to service owner if issue persists > 15 minutes",
    ],
  });

  return { backend: "simulation", query, service: svc, results: runbooks };
}

// ─── Start ────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP tools server failed to start:", err);
  process.exit(1);
});

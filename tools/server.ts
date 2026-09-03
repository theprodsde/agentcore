/**
 * AgentCore MCP Tool Server
 *
 * Runs as a subprocess communicating over stdio.
 * Exposes four tools: search_logs, get_metrics, create_ticket, list_services.
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
import { z } from "zod";

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
  ],
}));

// ─── Tool handlers ────────────────────────────────────────────────────────────

// Tool registry — add new tools here without touching the dispatch loop
const TOOL_REGISTRY: Record<string, (args: unknown) => Promise<unknown>> = {
  search_logs:   (args) => searchLogs(args as SearchLogsArgs),
  get_metrics:   (args) => getMetrics(args as GetMetricsArgs),
  create_ticket: (args) => createTicket(args as CreateTicketArgs),
  list_services: (args) => listServices(args as ListServicesArgs),
};

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const handler = TOOL_REGISTRY[name];
  if (!handler) throw new Error(`Unknown tool: ${name}`);
  const result = await handler(args);
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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

  // Simulation: produce realistic log lines keyed on query keywords
  const now = Date.now();
  const keywords = query.toLowerCase();
  const isDeadlock = keywords.includes("deadlock") || keywords.includes("lock") || keywords.includes("timeout");
  const isOom      = keywords.includes("memory") || keywords.includes("oom") || keywords.includes("heap");
  const isLatency  = keywords.includes("latency") || keywords.includes("slow") || keywords.includes("response");

  const templates = isDeadlock
    ? [
        `[ERROR] ${service}: ER_LOCK_WAIT_TIMEOUT — transaction ${rnd("tx")} waited >30s for row lock on table orders`,
        `[ERROR] ${service}: deadlock detected between workers ${rnd("w")} and ${rnd("w")} on connection pool slot 14`,
        `[WARN]  ${service}: lock wait threshold breached 5 times in last 60s — pool utilisation 94%`,
        `[ERROR] ${service}: SQLSTATE[40P01]: deadlock detected, query aborted — rolling back transaction`,
        `[INFO]  ${service}: auto-retry attempt 3/3 on transaction ${rnd("tx")} — still failing`,
      ]
    : isOom
    ? [
        `[ERROR] ${service}: FATAL: JavaScript heap out of memory — rss 3.1GB, heapUsed 2.9GB`,
        `[WARN]  ${service}: GC overhead limit exceeded — 98% of CPU time spent in GC over 30s window`,
        `[ERROR] ${service}: process killed by OOMKiller — cgroup memory limit 3GB exceeded`,
        `[WARN]  ${service}: memory allocation failed for buffer size 512MB — retrying with reduced batch`,
      ]
    : isLatency
    ? [
        `[WARN]  ${service}: p99 latency 4230ms — SLO threshold 1000ms`,
        `[WARN]  ${service}: downstream call to postgres-primary timed out after 3000ms`,
        `[ERROR] ${service}: circuit breaker OPEN after 10 consecutive 504s to dependency inventory-service`,
        `[INFO]  ${service}: slow query detected — SELECT on orders table took 2840ms (missing index?)`,
      ]
    : [
        `[ERROR] ${service}: unexpected error in request handler — ${query}`,
        `[WARN]  ${service}: retrying failed operation — attempt 2/3`,
        `[ERROR] ${service}: dependency health check failed`,
      ];

  const entries = templates.slice(0, Math.min(limit, templates.length)).map((msg, i) => ({
    timestamp: new Date(now - (i * 12000)).toISOString(),
    severity: msg.startsWith("[ERROR]") ? "error" : msg.startsWith("[WARN]") ? "warn" : "info",
    service,
    message: msg.replace(/^\[.*?\]\s+\S+:\s+/, ""),
    trace_id: rnd("tr"),
  }));

  return {
    backend: "simulation",
    service,
    query,
    time_range,
    total_matched: entries.length,
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

  const key = metric.toLowerCase();
  const isCpu     = key.includes("cpu");
  const isLatency = key.includes("latency") || key.includes("p99") || key.includes("p95");
  const isError   = key.includes("error") || key.includes("rate");
  const isMem     = key.includes("mem") || key.includes("heap");

  const current = isCpu ? 87.4 : isLatency ? 4230 : isError ? 12.3 : isMem ? 89.1 : 42.0;
  const unit    = isCpu ? "%" : isLatency ? "ms" : isError ? "req/s errors" : isMem ? "%" : "req/s";
  const trend   = "rising";
  const threshold = isCpu ? 80 : isLatency ? 1000 : isError ? 5 : isMem ? 85 : null;

  const now = Date.now();
  const datapoints = Array.from({ length: 8 }, (_, i) => ({
    timestamp: new Date(now - (7 - i) * (parseRange(time_range) / 8) * 1000).toISOString(),
    value: +(current * (0.6 + (i / 7) * 0.5)).toFixed(2),
  }));

  return {
    backend: "simulation",
    service,
    metric,
    time_range,
    current,
    unit,
    trend,
    ...(threshold !== null && { threshold, threshold_breached: current > threshold }),
    datapoints,
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

  const services = [
    { name: "payments-service",   status: "degraded", latency_p99_ms: 4230, error_rate: 12.3, replicas: "2/3", last_deploy: "2h ago" },
    { name: "inventory-service",  status: "degraded", latency_p99_ms: 890,  error_rate: 3.1,  replicas: "3/3", last_deploy: "4h ago" },
    { name: "auth-service",       status: "healthy",  latency_p99_ms: 120,  error_rate: 0.1,  replicas: "3/3", last_deploy: "1d ago" },
    { name: "notification-service", status: "healthy", latency_p99_ms: 45,  error_rate: 0.0,  replicas: "2/2", last_deploy: "3d ago" },
    { name: "postgres-primary",   status: "degraded", latency_p99_ms: 3100, error_rate: 8.7,  replicas: "1/1", last_deploy: "n/a" },
    { name: "redis-cache",        status: "healthy",  latency_p99_ms: 2,    error_rate: 0.0,  replicas: "1/1", last_deploy: "n/a" },
    { name: "api-gateway",        status: "healthy",  latency_p99_ms: 210,  error_rate: 0.4,  replicas: "3/3", last_deploy: "6h ago" },
  ];

  const filtered = filter_status === "all"
    ? services
    : services.filter((s) => s.status === filter_status);

  return {
    backend: "simulation",
    total: filtered.length,
    services: filtered,
    checked_at: new Date().toISOString(),
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function rnd(prefix: string) {
  return `${prefix}-${Math.random().toString(36).substring(2, 9)}`;
}

function parseRange(range: string): number {
  const match = range.match(/^(\d+)(m|h|d)$/);
  if (!match) return 3600;
  const [, n, unit] = match;
  return parseInt(n) * (unit === "m" ? 60 : unit === "h" ? 3600 : 86400);
}

// ─── Start ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);

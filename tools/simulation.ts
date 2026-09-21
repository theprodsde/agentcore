/**
 * Simulation world model — pure functions, no I/O.
 *
 * The simulated infrastructure has a fixed internal state (which services are
 * degraded and *why*), and log/metric output is derived from THAT state — never
 * from the caller's query. This is deliberate: an investigation can be wrong,
 * find nothing, or find something different from what the alert claimed.
 * Echoing the query back (the old behavior) made every investigation
 * trivially "correct" and tested nothing.
 *
 * The eval harness (scripts/eval.mjs) scores pipeline output against this
 * world, including anti-circularity cases ("deadlock on payments-service"
 * must report the latency regression that is actually there, not a deadlock).
 */

export type FailureMode = "deadlock" | "oom" | "latency" | "cpu";

export interface ServiceState {
  name: string;
  status: "healthy" | "degraded" | "down";
  failureMode?: FailureMode;
  latency_p99_ms: number;
  error_rate: number;
  replicas: string;
  last_deploy: string;
}

export const SERVICE_WORLD: readonly ServiceState[] = [
  { name: "payments-service",     status: "degraded", failureMode: "latency",  latency_p99_ms: 4230, error_rate: 12.3, replicas: "2/3", last_deploy: "2h ago" },
  { name: "orders-service",       status: "degraded", failureMode: "deadlock", latency_p99_ms: 2900, error_rate: 8.1,  replicas: "3/3", last_deploy: "45m ago" },
  { name: "inventory-service",    status: "degraded", failureMode: "oom",      latency_p99_ms: 890,  error_rate: 3.1,  replicas: "3/3", last_deploy: "4h ago" },
  { name: "postgres-primary",     status: "degraded", failureMode: "deadlock", latency_p99_ms: 3100, error_rate: 8.7,  replicas: "1/1", last_deploy: "n/a" },
  { name: "auth-service",         status: "healthy",                            latency_p99_ms: 120,  error_rate: 0.1,  replicas: "3/3", last_deploy: "1d ago" },
  { name: "notification-service", status: "healthy",                            latency_p99_ms: 45,   error_rate: 0.0,  replicas: "2/2", last_deploy: "3d ago" },
  { name: "redis-cache",          status: "healthy",                            latency_p99_ms: 2,    error_rate: 0.0,  replicas: "1/1", last_deploy: "n/a" },
  { name: "api-gateway",          status: "healthy",                            latency_p99_ms: 210,  error_rate: 0.4,  replicas: "3/3", last_deploy: "6h ago" },
];

export function getServiceState(name: string): ServiceState | undefined {
  return SERVICE_WORLD.find((s) => s.name === name);
}

// ─── Deterministic IDs (same input → same output, for tests and evals) ───────

export function deterministicId(prefix: string, ...parts: (string | number)[]): string {
  let h = 5381;
  const input = parts.join("|");
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return `${prefix}-${h.toString(36)}`;
}

// ─── Log simulation ───────────────────────────────────────────────────────────

export interface SimLogEntry {
  timestamp: string;
  severity: "error" | "warn" | "info" | "debug";
  service: string;
  message: string;
  trace_id: string;
}

export interface SimLogsResult {
  total_matched: number;
  entries: SimLogEntry[];
  /** True when error-level signal exists for this service. */
  signal: boolean;
  note?: string;
}

// Routine operational noise — present for every service, healthy or not.
// Real log searches are mostly this; triage means finding signal within it.
function noiseLines(service: string): string[] {
  return [
    `[INFO]  ${service}: GET /healthz 200 in 2ms`,
    `[INFO]  ${service}: request completed route=/api/v1/orders status=200 duration=48ms`,
    `[DEBUG] ${service}: connection pool stats — active 3/20, idle 17`,
    `[INFO]  ${service}: scheduled cache refresh completed in 412ms`,
    `[WARN]  ${service}: metrics flush retried (attempt 1/3) — succeeded`,
    `[INFO]  ${service}: config reloaded, 0 changes detected`,
  ];
}

function signalLines(service: string, mode: FailureMode): string[] {
  switch (mode) {
    case "deadlock":
      return [
        `[ERROR] ${service}: ER_LOCK_WAIT_TIMEOUT — transaction waited >30s for row lock on table orders`,
        `[ERROR] ${service}: deadlock detected between workers on connection pool slot 14`,
        `[WARN]  ${service}: lock wait threshold breached 5 times in last 60s — pool utilisation 94%`,
        `[ERROR] ${service}: SQLSTATE[40P01]: deadlock detected, query aborted — rolling back transaction`,
      ];
    case "oom":
      return [
        `[ERROR] ${service}: FATAL: JavaScript heap out of memory — rss 3.1GB, heapUsed 2.9GB`,
        `[WARN]  ${service}: GC overhead limit exceeded — 98% of CPU time spent in GC over 30s window`,
        `[ERROR] ${service}: process killed by OOMKiller — cgroup memory limit 3GB exceeded`,
      ];
    case "latency":
      return [
        `[WARN]  ${service}: p99 latency 4230ms — SLO threshold 1000ms`,
        `[WARN]  ${service}: downstream call to postgres-primary timed out after 3000ms`,
        `[ERROR] ${service}: circuit breaker OPEN after 10 consecutive 504s to dependency inventory-service`,
        `[INFO]  ${service}: slow query detected — SELECT on orders table took 2840ms (missing index?)`,
      ];
    case "cpu":
      return [
        `[ERROR] ${service}: event loop lag 1840ms — CPU saturated`,
        `[WARN]  ${service}: CPU throttling active — cgroup quota exceeded in 8 of last 10 periods`,
        `[WARN]  ${service}: request queue depth 412 and rising`,
      ];
  }
}

function toEntry(raw: string, service: string, query: string, index: number, now: number): SimLogEntry {
  const severity = raw.startsWith("[ERROR]") ? "error" : raw.startsWith("[WARN]") ? "warn" : raw.startsWith("[DEBUG]") ? "debug" : "info";
  return {
    timestamp: new Date(now - index * 12_000).toISOString(),
    severity,
    service,
    message: raw.replace(/^\[.*?\]\s+\S+:\s+/, ""),
    trace_id: deterministicId("tr", service, query, index),
  };
}

export function simulateLogs(service: string, query: string, limit: number, now = Date.now()): SimLogsResult {
  const state = getServiceState(service);
  const noise = noiseLines(service);

  if (state?.status === "degraded" && state.failureMode) {
    // Interleave signal with noise — signal exists but isn't handed over clean
    const signal = signalLines(service, state.failureMode);
    const raw: string[] = [];
    const max = Math.max(signal.length, noise.length);
    for (let i = 0; i < max; i++) {
      if (i < signal.length) raw.push(signal[i]);
      if (i < noise.length && raw.length < signal.length + 2) raw.push(noise[i]);
    }
    const entries = raw.slice(0, Math.max(1, limit)).map((line, i) => toEntry(line, service, query, i, now));
    return { total_matched: entries.length, entries, signal: true };
  }

  // Healthy or unknown service: routine activity only — no error-level signal.
  // The synthesizer must be able to say "nothing found" instead of inventing a cause.
  const entries = noise.slice(0, Math.max(1, Math.min(limit, 4))).map((line, i) => toEntry(line, service, query, i, now));
  return {
    total_matched: entries.length,
    entries,
    signal: false,
    note: `No error-level entries matched for ${service} in the window — logs show routine activity only.`,
  };
}

// ─── Metric simulation ────────────────────────────────────────────────────────

type MetricKind = "cpu" | "latency" | "error" | "mem" | "other";

function metricKind(metric: string): MetricKind {
  const key = metric.toLowerCase();
  if (key.includes("cpu")) return "cpu";
  if (key.includes("latency") || key.includes("p99") || key.includes("p95")) return "latency";
  if (key.includes("error") || key.includes("rate")) return "error";
  if (key.includes("mem") || key.includes("heap")) return "mem";
  return "other";
}

const THRESHOLDS: Record<Exclude<MetricKind, "other">, number> = { cpu: 80, latency: 1000, error: 5, mem: 85 };
const UNITS: Record<MetricKind, string> = { cpu: "%", latency: "ms", error: "req/s errors", mem: "%", other: "req/s" };

// Baselines for an unknown service — plausible and healthy
const UNKNOWN_SERVICE: Pick<ServiceState, "latency_p99_ms" | "error_rate"> = { latency_p99_ms: 180, error_rate: 0.3 };

export interface SimMetricsResult {
  current: number;
  unit: string;
  trend: "rising" | "stable";
  threshold: number | null;
  threshold_breached: boolean;
  datapoints: { timestamp: string; value: number }[];
}

export function simulateMetrics(service: string, metric: string, rangeSeconds: number, now = Date.now()): SimMetricsResult {
  const state = getServiceState(service);
  const kind = metricKind(metric);
  const mode = state?.status === "degraded" ? state.failureMode : undefined;

  // Values come from the service's actual state — not from what was asked about
  const current =
    kind === "latency" ? (state?.latency_p99_ms ?? UNKNOWN_SERVICE.latency_p99_ms)
    : kind === "error" ? (state?.error_rate ?? UNKNOWN_SERVICE.error_rate)
    : kind === "cpu"   ? (mode === "cpu" ? 91.2 : 34.2)
    : kind === "mem"   ? (mode === "oom" ? 93.6 : 58.3)
    : 42.0;

  const threshold = kind === "other" ? null : THRESHOLDS[kind];
  const breached = threshold !== null && current > threshold;
  const trend: "rising" | "stable" = breached ? "rising" : "stable";

  const datapoints = Array.from({ length: 8 }, (_, i) => ({
    timestamp: new Date(now - (7 - i) * (rangeSeconds / 8) * 1000).toISOString(),
    value: breached
      ? +(current * (0.6 + (i / 7) * 0.5)).toFixed(2)   // ramping up toward the breach
      : +(current * (0.95 + (i % 3) * 0.03)).toFixed(2), // steady with minor jitter
  }));

  return { current, unit: UNITS[kind], trend, threshold, threshold_breached: breached, datapoints };
}

// ─── Service listing ──────────────────────────────────────────────────────────

export function simulateServices(filterStatus: string) {
  const services = SERVICE_WORLD.map(({ name, status, latency_p99_ms, error_rate, replicas, last_deploy }) =>
    ({ name, status, latency_p99_ms, error_rate, replicas, last_deploy }));
  return filterStatus === "all" ? services : services.filter((s) => s.status === filterStatus);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function parseRange(range: string): number {
  const match = range.match(/^(\d+)(m|h|d)$/);
  if (!match) return 3600;
  const [, n, unit] = match;
  return parseInt(n) * (unit === "m" ? 60 : unit === "h" ? 3600 : 86400);
}

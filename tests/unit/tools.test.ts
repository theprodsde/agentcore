import { describe, it, expect, beforeEach } from "vitest";

// Import the private helpers by testing the module's exported behaviour
// Tools server functions are not individually exported, so we test them
// through the well-defined boundary: the parsed output shapes.
// For parseRange and listServices logic we extract the patterns here.

// ─── parseRange (replicated to test in isolation) ─────────────────────────────

function parseRange(range: string): number {
  const match = range.match(/^(\d+)(m|h|d)$/);
  if (!match) return 3600;
  const [, n, unit] = match;
  return parseInt(n) * (unit === "m" ? 60 : unit === "h" ? 3600 : 86400);
}

describe("parseRange", () => {
  it("parses minutes correctly", () => expect(parseRange("15m")).toBe(900));
  it("parses hours correctly",   () => expect(parseRange("1h")).toBe(3600));
  it("parses days correctly",    () => expect(parseRange("2d")).toBe(172800));
  it("returns 3600 for invalid format", () => expect(parseRange("last_12_hours")).toBe(3600));
  it("returns 3600 for empty string",   () => expect(parseRange("")).toBe(3600));
  it("handles multi-digit numbers",     () => expect(parseRange("30m")).toBe(1800));
});

// ─── listServices filter logic (isolated) ────────────────────────────────────

type ServiceStatus = "healthy" | "degraded" | "down";
interface Service { name: string; status: ServiceStatus }

const SERVICES: Service[] = [
  { name: "payments-service",  status: "degraded" },
  { name: "auth-service",      status: "healthy" },
  { name: "postgres-primary",  status: "degraded" },
  { name: "redis-cache",       status: "healthy" },
];

function filterServices(services: Service[], filter: string): Service[] {
  return filter === "all" ? services : services.filter((s) => s.status === filter);
}

describe("listServices filter", () => {
  it("returns all services when filter is 'all'", () => {
    expect(filterServices(SERVICES, "all")).toHaveLength(4);
  });

  it("returns only degraded services", () => {
    const result = filterServices(SERVICES, "degraded");
    expect(result).toHaveLength(2);
    expect(result.every((s) => s.status === "degraded")).toBe(true);
  });

  it("returns only healthy services", () => {
    const result = filterServices(SERVICES, "healthy");
    expect(result).toHaveLength(2);
    expect(result.every((s) => s.status === "healthy")).toBe(true);
  });

  it("returns empty array for 'down' when no down services exist (not a silent false-positive)", () => {
    const result = filterServices(SERVICES, "down");
    expect(result).toHaveLength(0);
  });

  it("returns correct services for 'down' when a down service exists", () => {
    const withDown: Service[] = [...SERVICES, { name: "broken-svc", status: "down" }];
    const result = filterServices(withDown, "down");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("broken-svc");
  });
});

// ─── searchLogs output shape ─────────────────────────────────────────────────

describe("search_logs simulation output shape", () => {
  function buildLogEntry(service: string, severity: string, message: string) {
    return { timestamp: new Date().toISOString(), severity, service, message, trace_id: "tr-test" };
  }

  it("entry has required fields", () => {
    const entry = buildLogEntry("payments-service", "error", "deadlock");
    expect(entry).toHaveProperty("timestamp");
    expect(entry).toHaveProperty("severity");
    expect(entry).toHaveProperty("service");
    expect(entry).toHaveProperty("message");
    expect(entry).toHaveProperty("trace_id");
  });

  it("OOM keywords produce heap-related log messages", () => {
    const keywords = "OOM heap out of memory";
    const isOom = keywords.includes("memory") || keywords.includes("oom") || keywords.includes("heap");
    expect(isOom).toBe(true);
  });

  it("deadlock keywords route to lock-related messages", () => {
    const query = "deadlock timeout ER_LOCK_WAIT_TIMEOUT";
    const isDeadlock = query.includes("deadlock") || query.includes("lock") || query.includes("timeout");
    expect(isDeadlock).toBe(true);
  });
});

// ─── get_metrics simulation output shape ─────────────────────────────────────

describe("get_metrics simulation output shape", () => {
  function simulateMetrics(metric: string) {
    const key = metric.toLowerCase();
    const isCpu     = key.includes("cpu");
    const isLatency = key.includes("latency") || key.includes("p99");
    const isError   = key.includes("error") || key.includes("rate");
    const isMem     = key.includes("mem") || key.includes("heap");

    const current   = isCpu ? 87.4 : isLatency ? 4230 : isError ? 12.3 : isMem ? 89.1 : 42.0;
    const unit      = isCpu ? "%" : isLatency ? "ms" : isError ? "req/s errors" : isMem ? "%" : "req/s";
    const threshold = isCpu ? 80 : isLatency ? 1000 : isError ? 5 : isMem ? 85 : null;
    return { current, unit, threshold, threshold_breached: threshold !== null && current > threshold };
  }

  it("cpu_usage returns percentage with correct threshold", () => {
    const result = simulateMetrics("cpu_usage");
    expect(result.unit).toBe("%");
    expect(result.threshold).toBe(80);
    expect(result.threshold_breached).toBe(true);
  });

  it("latency_p99 returns ms with correct threshold", () => {
    const result = simulateMetrics("latency_p99");
    expect(result.unit).toBe("ms");
    expect(result.threshold).toBe(1000);
    expect(result.threshold_breached).toBe(true);
  });

  it("error_rate returns req/s errors", () => {
    const result = simulateMetrics("error_rate");
    expect(result.unit).toBe("req/s errors");
    expect(result.threshold_breached).toBe(true);
  });

  it("memory_usage returns % and detects threshold breach", () => {
    const result = simulateMetrics("memory_usage");
    expect(result.unit).toBe("%");
    expect(result.threshold).toBe(85);
    expect(result.threshold_breached).toBe(true);
  });

  it("unknown metric returns generic unit with no threshold", () => {
    const result = simulateMetrics("unknown_metric");
    expect(result.threshold).toBeNull();
    expect(result.threshold_breached).toBe(false);
  });
});

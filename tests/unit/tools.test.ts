/**
 * Tests the simulation world model directly (tools/simulation.ts is pure).
 * The key property under test: output is derived from the simulated system's
 * STATE, not from the caller's query — investigations can find nothing, or
 * find something different from what was asked about.
 */
import { describe, it, expect } from "vitest";
import {
  SERVICE_WORLD, getServiceState, simulateLogs, simulateMetrics, simulateServices, parseRange,
} from "../../tools/simulation";

const NOW = 1_758_400_000_000; // fixed clock for deterministic assertions

// ─── parseRange ───────────────────────────────────────────────────────────────

describe("parseRange", () => {
  it("parses minutes correctly", () => expect(parseRange("15m")).toBe(900));
  it("parses hours correctly",   () => expect(parseRange("1h")).toBe(3600));
  it("parses days correctly",    () => expect(parseRange("2d")).toBe(172800));
  it("returns 3600 for invalid format", () => expect(parseRange("last_12_hours")).toBe(3600));
  it("returns 3600 for empty string",   () => expect(parseRange("")).toBe(3600));
  it("handles multi-digit numbers",     () => expect(parseRange("30m")).toBe(1800));
});

// ─── World model ──────────────────────────────────────────────────────────────

describe("service world model", () => {
  it("every degraded service has a failure mode", () => {
    for (const s of SERVICE_WORLD.filter((s) => s.status === "degraded")) {
      expect(s.failureMode, `${s.name} missing failureMode`).toBeTruthy();
    }
  });

  it("looks up services by exact name", () => {
    expect(getServiceState("payments-service")?.failureMode).toBe("latency");
    expect(getServiceState("ghost-service")).toBeUndefined();
  });
});

describe("simulateServices filter", () => {
  it("returns all services when filter is 'all'", () => {
    expect(simulateServices("all")).toHaveLength(SERVICE_WORLD.length);
  });

  it("returns only degraded services", () => {
    const result = simulateServices("degraded");
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((s) => s.status === "degraded")).toBe(true);
  });

  it("returns empty array for 'down' when no down services exist (not a silent false-positive)", () => {
    expect(simulateServices("down")).toHaveLength(0);
  });
});

// ─── Log simulation ───────────────────────────────────────────────────────────

describe("simulateLogs", () => {
  it("entries have the required fields", () => {
    const { entries } = simulateLogs("payments-service", "latency", 10, NOW);
    for (const e of entries) {
      expect(e).toHaveProperty("timestamp");
      expect(e).toHaveProperty("severity");
      expect(e).toHaveProperty("service");
      expect(e).toHaveProperty("message");
      expect(e).toHaveProperty("trace_id");
    }
  });

  it("is anti-circular: querying 'deadlock' on a latency-degraded service returns latency signal, not deadlock", () => {
    const { entries, signal } = simulateLogs("payments-service", "database deadlock", 20, NOW);
    expect(signal).toBe(true);
    const text = entries.map((e) => e.message).join(" ");
    expect(text).not.toMatch(/deadlock/i);
    expect(text).toMatch(/latency|circuit breaker|timed out/i);
  });

  it("degraded services mix signal with routine noise", () => {
    const { entries } = simulateLogs("orders-service", "anything", 20, NOW);
    const severities = new Set(entries.map((e) => e.severity));
    expect(severities.has("error")).toBe(true);
    expect(severities.has("info")).toBe(true); // noise is present too
  });

  it("healthy services return no error-level entries and set a note", () => {
    const { entries, signal, note } = simulateLogs("auth-service", "OOM heap out of memory", 20, NOW);
    expect(signal).toBe(false);
    expect(note).toContain("routine activity");
    expect(entries.some((e) => e.severity === "error")).toBe(false);
  });

  it("unknown services return no signal instead of fabricating one", () => {
    const { signal, entries } = simulateLogs("ghost-service", "everything is on fire", 20, NOW);
    expect(signal).toBe(false);
    expect(entries.some((e) => e.severity === "error")).toBe(false);
  });

  it("is deterministic: same input produces identical output", () => {
    const a = simulateLogs("orders-service", "deadlock", 10, NOW);
    const b = simulateLogs("orders-service", "deadlock", 10, NOW);
    expect(a).toEqual(b);
  });

  it("respects the limit", () => {
    expect(simulateLogs("payments-service", "q", 2, NOW).entries).toHaveLength(2);
  });
});

// ─── Metric simulation ────────────────────────────────────────────────────────

describe("simulateMetrics", () => {
  it("reports the breach that actually exists (latency on payments-service)", () => {
    const m = simulateMetrics("payments-service", "latency_p99", 3600, NOW);
    expect(m.current).toBe(4230);
    expect(m.unit).toBe("ms");
    expect(m.threshold).toBe(1000);
    expect(m.threshold_breached).toBe(true);
    expect(m.trend).toBe("rising");
  });

  it("reports healthy numbers for a healthy service even when a breach was expected", () => {
    const m = simulateMetrics("auth-service", "latency_p99", 3600, NOW);
    expect(m.current).toBe(120);
    expect(m.threshold_breached).toBe(false);
    expect(m.trend).toBe("stable");
  });

  it("memory breaches only on the OOM-degraded service", () => {
    expect(simulateMetrics("inventory-service", "memory_usage", 3600, NOW).threshold_breached).toBe(true);
    expect(simulateMetrics("payments-service", "memory_usage", 3600, NOW).threshold_breached).toBe(false);
  });

  it("cpu is healthy when no service has a cpu failure mode", () => {
    const m = simulateMetrics("payments-service", "cpu_usage", 3600, NOW);
    expect(m.unit).toBe("%");
    expect(m.threshold_breached).toBe(false);
  });

  it("unknown metrics have no threshold and never breach", () => {
    const m = simulateMetrics("payments-service", "custom_widget_count", 3600, NOW);
    expect(m.threshold).toBeNull();
    expect(m.threshold_breached).toBe(false);
  });

  it("unknown services get healthy baselines", () => {
    const m = simulateMetrics("ghost-service", "latency_p99", 3600, NOW);
    expect(m.threshold_breached).toBe(false);
  });

  it("returns 8 datapoints spanning the requested range", () => {
    const m = simulateMetrics("payments-service", "latency_p99", 3600, NOW);
    expect(m.datapoints).toHaveLength(8);
    expect(new Date(m.datapoints[0].timestamp).getTime()).toBeLessThan(new Date(m.datapoints[7].timestamp).getTime());
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseLLMJson } from "../../src/utils/index";
import { deriveSynthesisFromOutput } from "../../src/server/executor";

// ─── deriveSynthesisFromOutput (pure function — no mocks needed) ──────────────

describe("deriveSynthesisFromOutput", () => {
  const mockLogsResult = {
    backend: "simulation",
    service: "payments-service",
    total_matched: 2,
    entries: [
      { timestamp: "2026-01-01T00:00:00Z", severity: "error", service: "payments-service", message: "ER_LOCK_WAIT_TIMEOUT in transaction pool", trace_id: "tr-abc" },
      { timestamp: "2026-01-01T00:00:01Z", severity: "warn",  service: "payments-service", message: "High latency on DB connection",            trace_id: "tr-def" },
    ],
  };

  const mockMetricsResult = {
    backend: "simulation",
    service: "payments-service",
    metric: "latency_p99",
    current: 4230,
    unit: "ms",
    trend: "rising",
    threshold: 1000,
    threshold_breached: true,
  };

  const mockTicketResult = {
    backend: "simulation",
    ticket_id: "INC-7777",
    title: "Latency spike",
    status: "open",
  };

  function wrapAsContent(data: object) {
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  }

  it("extracts summary from the first error log entry", () => {
    const out = deriveSynthesisFromOutput(
      { tool_search_logs: wrapAsContent(mockLogsResult) },
      "latency spike"
    );
    expect(out.summary).toContain("ER_LOCK_WAIT_TIMEOUT");
  });

  it("uses the affected service from log results", () => {
    const out = deriveSynthesisFromOutput(
      { tool_search_logs: wrapAsContent(mockLogsResult) },
      "some goal"
    );
    expect(out.affected_systems).toContain("payments-service");
  });

  it("captures threshold breach in probable_cause from metrics", () => {
    const out = deriveSynthesisFromOutput(
      { tool_get_metrics: wrapAsContent(mockMetricsResult) },
      "latency spike"
    );
    expect(out.probable_cause).toContain("4230");
    expect(out.probable_cause).toContain("ms");
  });

  it("uses ticket_id from create_ticket result", () => {
    const out = deriveSynthesisFromOutput(
      { tool_create_ticket: wrapAsContent(mockTicketResult) },
      "some goal"
    );
    expect(out.ticket_id).toBe("INC-7777");
  });

  it("generates a fallback ticket_id when no ticket tool ran", () => {
    const out = deriveSynthesisFromOutput({}, "some goal");
    expect(out.ticket_id).toMatch(/^INC-\d{4}$/);
  });

  it("combines data from all three tools correctly", () => {
    const out = deriveSynthesisFromOutput(
      {
        tool_search_logs:   wrapAsContent(mockLogsResult),
        tool_get_metrics:   wrapAsContent(mockMetricsResult),
        tool_create_ticket: wrapAsContent(mockTicketResult),
      },
      "payments latency"
    );
    expect(out.summary).toContain("ER_LOCK_WAIT_TIMEOUT");
    expect(out.probable_cause).toContain("threshold");
    expect(out.ticket_id).toBe("INC-7777");
    expect(out.affected_systems).toContain("payments-service");
    expect(out.next_actions.length).toBeGreaterThan(0);
  });

  it("falls back gracefully when execution output is empty", () => {
    const out = deriveSynthesisFromOutput({}, "DB deadlock on inventory-service");
    expect(out.summary).toContain("DB deadlock on inventory-service");
    expect(out.next_actions).toContain("Review logs for root cause");
  });

  it("falls back gracefully when tool results contain invalid JSON", () => {
    const out = deriveSynthesisFromOutput(
      { tool_search_logs: { content: [{ type: "text", text: "not valid json" }] } },
      "some goal"
    );
    expect(out).toBeDefined();
    expect(out.ticket_id).toMatch(/^INC-\d{4}$/);
  });
});

// ─── parseLLMJson round-trip for planner and synthesizer output shapes ────────

describe("planner output shape contract", () => {
  it("parses a valid planner JSON response", () => {
    const raw = `{"intent":"incident","tool_calls":[{"tool":"search_logs","args":{"service":"auth-service","query":"OOM"}}],"reasoning_summary":"checking logs"}`;
    const parsed = parseLLMJson<{ intent: string; tool_calls: unknown[]; reasoning_summary: string }>(raw);
    expect(parsed?.intent).toBe("incident");
    expect(parsed?.tool_calls).toHaveLength(1);
    expect(parsed?.reasoning_summary).toBe("checking logs");
  });

  it("parses planner response wrapped in markdown fences", () => {
    const raw = "```json\n{\"intent\":\"incident\",\"tool_calls\":[],\"reasoning_summary\":\"no tools\"}\n```";
    const parsed = parseLLMJson<{ intent: string }>(raw);
    expect(parsed?.intent).toBe("incident");
  });

  it("returns null for malformed planner output", () => {
    expect(parseLLMJson("I'll use the search_logs tool.")).toBeNull();
  });
});

describe("synthesizer output shape contract", () => {
  it("parses a valid synthesizer JSON response", () => {
    const raw = `{"summary":"latency","probable_cause":"db lock","affected_systems":["payments"],"next_actions":["restart pods"],"ticket_id":"INC-001"}`;
    const parsed = parseLLMJson<{ summary: string; ticket_id: string }>(raw);
    expect(parsed?.summary).toBe("latency");
    expect(parsed?.ticket_id).toBe("INC-001");
  });
});

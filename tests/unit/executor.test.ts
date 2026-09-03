/**
 * Executor unit tests.
 *
 * deriveSynthesisFromOutput lives in src/utils/synthesis — a pure module with zero
 * infrastructure imports — so these tests run without DATABASE_URL, a running
 * Postgres, or any LLM credentials. That is intentional: if a function touches
 * the DB or network it is not a unit and belongs in an integration test.
 */
import { describe, it, expect } from "vitest";
import { deriveSynthesisFromOutput } from "../../src/utils/synthesis";
import { parseLLMJson } from "../../src/utils/index";

// ─── helpers ─────────────────────────────────────────────────────────────────

function wrapAsContent(data: object) {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

const mockLogs = {
  backend: "simulation",
  service: "payments-service",
  total_matched: 2,
  entries: [
    { timestamp: "2026-01-01T00:00:00Z", severity: "error", service: "payments-service", message: "ER_LOCK_WAIT_TIMEOUT in transaction pool", trace_id: "tr-abc" },
    { timestamp: "2026-01-01T00:00:01Z", severity: "warn",  service: "payments-service", message: "High latency on DB connection",            trace_id: "tr-def" },
  ],
};

const mockMetrics = {
  backend: "simulation",
  service: "payments-service",
  metric: "latency_p99",
  current: 4230,
  unit: "ms",
  trend: "rising",
  threshold: 1000,
  threshold_breached: true,
};

const mockTicket = {
  backend: "simulation",
  ticket_id: "INC-7777",
  title: "Latency spike",
  status: "open",
};

// ─── deriveSynthesisFromOutput ────────────────────────────────────────────────

describe("deriveSynthesisFromOutput", () => {
  it("extracts summary from the first error log entry", () => {
    const out = deriveSynthesisFromOutput(
      { tool_search_logs: wrapAsContent(mockLogs) },
      "latency spike"
    );
    expect(out.summary).toContain("ER_LOCK_WAIT_TIMEOUT");
  });

  it("uses the affected service from log results", () => {
    const out = deriveSynthesisFromOutput(
      { tool_search_logs: wrapAsContent(mockLogs) },
      "some goal"
    );
    expect(out.affected_systems).toContain("payments-service");
  });

  it("captures threshold breach in probable_cause from metrics", () => {
    const out = deriveSynthesisFromOutput(
      { tool_get_metrics: wrapAsContent(mockMetrics) },
      "latency spike"
    );
    expect(out.probable_cause).toContain("4230");
    expect(out.probable_cause).toContain("ms");
  });

  it("uses ticket_id from create_ticket result", () => {
    const out = deriveSynthesisFromOutput(
      { tool_create_ticket: wrapAsContent(mockTicket) },
      "some goal"
    );
    expect(out.ticket_id).toBe("INC-7777");
  });

  it("generates a fallback INC- ticket when no ticket tool ran", () => {
    const out = deriveSynthesisFromOutput({}, "some goal");
    expect(out.ticket_id).toMatch(/^INC-\d{4}$/);
  });

  it("combines all three tool results correctly", () => {
    const out = deriveSynthesisFromOutput(
      {
        tool_search_logs:   wrapAsContent(mockLogs),
        tool_get_metrics:   wrapAsContent(mockMetrics),
        tool_create_ticket: wrapAsContent(mockTicket),
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

  it("falls back gracefully when tool result contains invalid JSON", () => {
    const out = deriveSynthesisFromOutput(
      { tool_search_logs: { content: [{ type: "text", text: "not valid json" }] } },
      "some goal"
    );
    expect(out).toBeDefined();
    expect(out.ticket_id).toMatch(/^INC-\d{4}$/);
  });

  it("does not include the fallback runbook action more than once", () => {
    const out = deriveSynthesisFromOutput({}, "goal");
    const count = out.next_actions.filter((a) => a === "Update runbook with incident details").length;
    expect(count).toBe(1);
  });
});

// ─── LLM output shape contracts ──────────────────────────────────────────────

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

  it("returns null for malformed planner output (prose instead of JSON)", () => {
    expect(parseLLMJson("I'll use the search_logs tool to investigate this.")).toBeNull();
  });

  it("tool_calls array contains objects with tool and args fields", () => {
    const raw = `{"intent":"investigate","tool_calls":[{"tool":"get_metrics","args":{"service":"auth-service","metric":"cpu_usage"}}],"reasoning_summary":"cpu check"}`;
    const parsed = parseLLMJson<{ tool_calls: { tool: string; args: Record<string, string> }[] }>(raw);
    expect(parsed?.tool_calls[0].tool).toBe("get_metrics");
    expect(parsed?.tool_calls[0].args.service).toBe("auth-service");
  });
});

describe("synthesizer output shape contract", () => {
  it("parses a valid synthesizer JSON response", () => {
    const raw = `{"summary":"latency issue","probable_cause":"db lock","affected_systems":["payments"],"next_actions":["restart pods"],"ticket_id":"INC-001"}`;
    const parsed = parseLLMJson<{ summary: string; ticket_id: string }>(raw);
    expect(parsed?.summary).toBe("latency issue");
    expect(parsed?.ticket_id).toBe("INC-001");
  });

  it("a missing summary field causes the synthesizer to fall back to deriveSynthesisFromOutput", () => {
    // When parsed?.summary is falsy the synthesizerHandler falls back.
    // Test that deriveSynthesisFromOutput always returns a non-empty summary.
    const out = deriveSynthesisFromOutput(
      { tool_search_logs: wrapAsContent(mockLogs) },
      "any goal"
    );
    expect(out.summary.length).toBeGreaterThan(0);
  });
});

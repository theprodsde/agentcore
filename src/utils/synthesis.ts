/**
 * Pure synthesis utilities — no DB, MCP, or LLM imports.
 * Kept separate so they can be unit-tested without any infrastructure.
 */

import { parseLLMJson } from "./index";

export interface SynthOutput {
  summary: string;
  probable_cause: string;
  affected_systems: string[];
  next_actions: string[];
  ticket_id: string;
}

interface McpContentResult {
  content?: { type: string; text: string }[];
}

/**
 * Derives a meaningful incident synthesis from the raw MCP tool execution output.
 * Parses content[0].text from each tool result — used as the LLM fallback and in tests.
 */
export function deriveSynthesisFromOutput(
  executionOutput: Record<string, unknown>,
  goal: string
): SynthOutput {
  let topError = "";
  let affectedService = "";
  let ticketId = `INC-${Math.floor(1000 + Math.random() * 9000)}`;
  let thresholdBreach = "";
  const nextActions: string[] = [];

  for (const [key, value] of Object.entries(executionOutput)) {
    const result = value as McpContentResult;
    const text = result?.content?.[0]?.text;
    if (!text) continue;

    const parsed = parseLLMJson<Record<string, unknown>>(text);
    if (!parsed) continue;

    if (key.includes("search_logs")) {
      const entries = parsed.entries as { message: string; severity: string }[] | undefined;
      if (entries?.length) {
        topError = entries.find((e) => e.severity === "error")?.message ?? entries[0].message ?? "";
      }
      affectedService = (parsed.service as string) ?? affectedService;
    }

    if (key.includes("get_metrics")) {
      affectedService = (parsed.service as string) ?? affectedService;
      if (parsed.threshold_breached) {
        thresholdBreach = `${parsed.metric} at ${parsed.current}${parsed.unit} (threshold: ${parsed.threshold}${parsed.unit})`;
        nextActions.push(`Investigate ${parsed.metric} breach on ${parsed.service}`);
      }
    }

    if (key.includes("create_ticket")) {
      ticketId = (parsed.ticket_id as string) ?? ticketId;
    }
  }

  if (nextActions.length === 0) {
    nextActions.push("Review logs for root cause", "Check metrics dashboard");
  }
  nextActions.push("Update runbook with incident details");

  const summary = topError
    ? `Incident detected on ${affectedService || "service"}: ${topError.slice(0, 120)}`
    : `Service degradation detected for goal: ${goal.slice(0, 80)}`;

  const probable_cause = thresholdBreach
    ? `Threshold breach: ${thresholdBreach}`
    : topError || "Root cause requires further investigation";

  return {
    summary,
    probable_cause,
    affected_systems: affectedService ? [affectedService] : ["unknown-service"],
    next_actions: nextActions,
    ticket_id: ticketId,
  };
}

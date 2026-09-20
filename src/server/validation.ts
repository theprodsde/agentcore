/**
 * Request-body schemas for every task-creating entry point.
 *
 * goal/context flow directly into LLM prompts, so unbounded input is a
 * token-cost and prompt-stuffing vector — every path that creates a task
 * (API, Slack, webhooks) must pass through these limits.
 */
import { z } from "zod";

export const GOAL_MAX_CHARS    = 500;
export const CONTEXT_MAX_CHARS = 8_000;

export const CreateTaskSchema = z.object({
  goal:           z.string().trim().min(1, "goal is required").max(GOAL_MAX_CHARS),
  context:        z.string().max(CONTEXT_MAX_CHARS).optional().default(""),
  task_type:      z.string().max(50).optional().default("incident"),
  user_id:        z.string().max(100).optional().default("demo-user-1"),
  inject_failure: z.boolean().optional().default(false),
  dry_run:        z.boolean().optional().default(false),
});

export const MemoryQuerySchema = z.object({
  query: z.string().trim().min(1, "query is required").max(1_000),
  limit: z.coerce.number().int().min(1).max(50).optional().default(5),
});

export const SimulateSchema = z.object({
  title:       z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(4_000),
  severity:    z.string().max(20).optional(),
  channel:     z.string().max(100).optional(),
});

export const CreateTeamSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(100),
});

/** Formats a ZodError into a compact, client-friendly message. */
export function zodMessage(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
}

/** Hard truncation for goal/context assembled server-side (Slack, webhooks). */
export function clampGoal(s: string): string {
  return s.slice(0, GOAL_MAX_CHARS);
}

export function clampContext(s: string): string {
  return s.slice(0, CONTEXT_MAX_CHARS);
}

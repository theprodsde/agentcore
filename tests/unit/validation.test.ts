import { describe, it, expect } from "vitest";
import {
  CreateTaskSchema, MemoryQuerySchema, CreateTeamSchema,
  clampGoal, clampContext, zodMessage,
  GOAL_MAX_CHARS, CONTEXT_MAX_CHARS,
} from "../../src/server/validation";

describe("CreateTaskSchema", () => {
  it("accepts a minimal valid body and applies defaults", () => {
    const parsed = CreateTaskSchema.parse({ goal: "payments-service p99 at 4s" });
    expect(parsed.goal).toBe("payments-service p99 at 4s");
    expect(parsed.context).toBe("");
    expect(parsed.task_type).toBe("incident");
    expect(parsed.inject_failure).toBe(false);
    expect(parsed.dry_run).toBe(false);
  });

  it("rejects a missing or empty goal", () => {
    expect(CreateTaskSchema.safeParse({}).success).toBe(false);
    expect(CreateTaskSchema.safeParse({ goal: "   " }).success).toBe(false);
  });

  it("rejects a goal over the max length (token-cost guard)", () => {
    const result = CreateTaskSchema.safeParse({ goal: "x".repeat(GOAL_MAX_CHARS + 1) });
    expect(result.success).toBe(false);
  });

  it("rejects an oversized context", () => {
    const result = CreateTaskSchema.safeParse({ goal: "ok", context: "x".repeat(CONTEXT_MAX_CHARS + 1) });
    expect(result.success).toBe(false);
  });

  it("rejects non-boolean flags", () => {
    expect(CreateTaskSchema.safeParse({ goal: "ok", dry_run: "yes" }).success).toBe(false);
  });
});

describe("MemoryQuerySchema", () => {
  it("clamps and defaults the limit", () => {
    expect(MemoryQuerySchema.parse({ query: "deadlock" }).limit).toBe(5);
    expect(MemoryQuerySchema.safeParse({ query: "deadlock", limit: 500 }).success).toBe(false);
  });

  it("requires a non-empty query", () => {
    expect(MemoryQuerySchema.safeParse({ query: "" }).success).toBe(false);
  });
});

describe("CreateTeamSchema", () => {
  it("trims and validates the name", () => {
    expect(CreateTeamSchema.parse({ name: "  Platform  " }).name).toBe("Platform");
    expect(CreateTeamSchema.safeParse({ name: "" }).success).toBe(false);
    expect(CreateTeamSchema.safeParse({ name: "x".repeat(101) }).success).toBe(false);
  });
});

describe("clamp helpers", () => {
  it("hard-truncates server-assembled goal and context", () => {
    expect(clampGoal("x".repeat(10_000))).toHaveLength(GOAL_MAX_CHARS);
    expect(clampContext("x".repeat(100_000))).toHaveLength(CONTEXT_MAX_CHARS);
    expect(clampGoal("short")).toBe("short");
  });
});

describe("zodMessage", () => {
  it("produces a compact field: message string", () => {
    const result = CreateTaskSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(zodMessage(result.error)).toContain("goal");
    }
  });
});

/**
 * Integration test for the checkpoint/resume orchestration — the core
 * differentiator. Runs against a real pgvector Postgres.
 *
 * Requires TEST_DATABASE_URL (skipped otherwise):
 *   docker run -d --name agentcore-pg-test -e POSTGRES_USER=agentcore \
 *     -e POSTGRES_PASSWORD=agentcore -e POSTGRES_DB=agentcore \
 *     -p 5432:5432 pgvector/pgvector:pg16
 *   TEST_DATABASE_URL=postgres://agentcore:agentcore@localhost:5432/agentcore npm run test:integration
 *
 * The suite runs fully hermetic: OPENAI_API_KEY is blanked so the planner and
 * synthesizer use their deterministic fallbacks, and inject_failure prevents
 * any MCP subprocess from spawning.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";

const TEST_DB = process.env.TEST_DATABASE_URL;

// Loaded dynamically in beforeAll — after DATABASE_URL is pointed at the test DB
type Db = typeof import("../../src/server/db/index");
type Executor = typeof import("../../src/server/executor");
let dbMod: Db;
let executor: Executor;

describe.runIf(!!TEST_DB)("checkpoint resume (integration)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    // Empty (not deleted) so dotenv can't re-populate it from .env — forces
    // the deterministic planner/synthesizer fallbacks.
    process.env.OPENAI_API_KEY = "";

    // Ensure pgvector + schema exist (idempotent)
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const admin = postgres(TEST_DB!, { max: 1 });
    await admin.unsafe("CREATE EXTENSION IF NOT EXISTS vector");
    await migrate(drizzle(admin), { migrationsFolder: "drizzle" });
    await admin.unsafe("TRUNCATE tasks, checkpoints, memories CASCADE");
    await admin.end();

    dbMod = await import("../../src/server/db/index");
    executor = await import("../../src/server/executor");
  }, 60_000);

  afterAll(async () => {
    // The dry-run test exercises the real stdio MCP path — close the subprocess
    const mcp = await import("../../src/server/mcp");
    await mcp.closeMcpClient();
    const client = (dbMod?.db as unknown as { $client?: { end: () => Promise<void> } })?.$client;
    await client?.end();
  });

  it("fails at step 3 with inject_failure, then resumes without re-running steps 1–2", async () => {
    const { db, tasks, checkpoints, memories } = dbMod;

    // ── Run 1: pipeline fails at step 3 (simulated network timeout) ──────────
    const [task] = await db.insert(tasks).values({
      goal: "payments-service p99 latency at 4s after deploy",
      context: "integration test",
      task_type: "incident",
      user_id: "integration-test",
      trace_id: "tr-integration-test",
      inject_failure: true,
    }).returning();

    await executor.runTaskOrchestrator(task.task_id);

    const [failed] = await db.select().from(tasks).where(eq(tasks.task_id, task.task_id));
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("Simulated network timeout");

    const cpsAfterFailure = await db.select().from(checkpoints).where(eq(checkpoints.task_id, task.task_id));
    const byStep = (n: number, status: string) =>
      cpsAfterFailure.filter((c) => c.step_number === n && c.step_status === status);
    expect(byStep(1, "success")).toHaveLength(1);
    expect(byStep(2, "success")).toHaveLength(1);
    expect(byStep(3, "failed")).toHaveLength(1);
    expect(cpsAfterFailure.filter((c) => c.step_number === 4)).toHaveLength(0);

    // ── Run 2: resume — steps 1–2 must be loaded from checkpoints, not re-run ─
    await db.update(tasks)
      .set({ status: "pending", error: null, resume_count: 1 })
      .where(eq(tasks.task_id, task.task_id));

    await executor.runTaskOrchestrator(task.task_id);

    const [completed] = await db.select().from(tasks).where(eq(tasks.task_id, task.task_id));
    expect(completed.status).toBe("completed");
    expect(completed.final_output).toBeTruthy();
    const report = JSON.parse(completed.final_output!);
    expect(report.summary).toBeTruthy();

    const cpsAfterResume = await db.select().from(checkpoints).where(eq(checkpoints.task_id, task.task_id));
    const byStepFinal = (n: number, status: string) =>
      cpsAfterResume.filter((c) => c.step_number === n && c.step_status === status);

    // Steps 1 and 2 still have exactly one success checkpoint each — proof they were skipped
    expect(byStepFinal(1, "success")).toHaveLength(1);
    expect(byStepFinal(2, "success")).toHaveLength(1);
    // Step 3 keeps its failure record and gains a success on the retry
    expect(byStepFinal(3, "failed")).toHaveLength(1);
    expect(byStepFinal(3, "success")).toHaveLength(1);
    expect(byStepFinal(4, "success")).toHaveLength(1);

    // Completed (non-dry-run) task writes an episodic memory
    const mems = await db.select().from(memories).where(eq(memories.task_id, task.task_id));
    expect(mems).toHaveLength(1);
    expect(mems[0].score).toBeGreaterThan(0);
  }, 60_000);

  it("dry_run completes without writing memory", async () => {
    const { db, tasks, memories } = dbMod;

    const [task] = await db.insert(tasks).values({
      goal: "auth-service 401 errors spiking",
      context: "integration test dry run",
      task_type: "incident",
      user_id: "integration-test",
      trace_id: "tr-integration-dryrun",
      inject_failure: false,
      dry_run: true,
    }).returning();

    await executor.runTaskOrchestrator(task.task_id);

    const [completed] = await db.select().from(tasks).where(eq(tasks.task_id, task.task_id));
    expect(completed.status).toBe("completed");

    const mems = await db.select().from(memories).where(eq(memories.task_id, task.task_id));
    expect(mems).toHaveLength(0);
  }, 60_000);
});

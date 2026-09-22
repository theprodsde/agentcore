import { EventEmitter } from "events";
import crypto from "crypto";
import { eq, and, gte, inArray, sql, desc } from "drizzle-orm";
import { db, tasks, checkpoints, memories, memorySummaryColumns } from "./db/index";
import { logger } from "./logger";
import { getMcpClient, executeMcpTool, getMcpToolSummary } from "./mcp";
import { embed } from "./embeddings";
import { getLLMClient, LLM_MODELS } from "./llm";
import { tracer, SpanStatusCode } from "./telemetry";
import { parseLLMJson, toErrorMessage } from "../utils/index";
import { deriveSynthesisFromOutput, type SynthOutput } from "../utils/synthesis";
import { getCached, setCached, toolCacheKey } from "./cache";
import { simulateLogs, simulateMetrics, simulateServices } from "../../tools/simulation";
import { topK, selectOptimalTools, type ToolOption } from "../utils/algorithms";
export { deriveSynthesisFromOutput } from "../utils/synthesis";

export const taskEventEmitter = new EventEmitter();
taskEventEmitter.setMaxListeners(100); // many concurrent SSE clients per task

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlanContext {
  intent?: string;
  tool_calls?: ToolCall[];
  reasoning_summary?: string;
  [key: string]: unknown;
}

interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

// ─── Shared checkpoint wrapper ─────────────────────────────────────────────────

async function executeStep(
  taskId: string,
  stepNumber: number,
  stepName: string,
  inputData: unknown,
  runLogic: () => Promise<unknown>,
  // Pass the already-loaded task to avoid a redundant SELECT on every step (C-1)
  preloadedTask?: typeof tasks.$inferSelect
): Promise<unknown> {
  const task = preloadedTask ?? (await db.select().from(tasks).where(eq(tasks.task_id, taskId)))[0];
  if (!task) return null;

  return tracer.startActiveSpan(`step.${stepName}`, async (span) => {
    span.setAttributes({ "task.id": taskId, "task.trace_id": task.trace_id, "step.number": stepNumber, "step.name": stepName });

    await db.update(tasks)
      .set({ current_step: { step_number: stepNumber, step_name: stepName, step_status: "running" }, updated_at: new Date() })
      .where(eq(tasks.task_id, taskId));

    taskEventEmitter.emit(`checkpoint-${taskId}`, { step_number: stepNumber, step_name: stepName, step_status: "running", event: "started" });
    logger.info({ taskId, stepNumber, stepName }, "Starting step");

    const startTime = Date.now();
    let outputData: unknown = null;
    let errorInfo: string | null = null;
    let status: "success" | "failed" = "success";

    try {
      if (task.inject_failure && stepNumber === 3 && stepName === "execution" && task.resume_count === 0) {
        throw new Error("Simulated network timeout during tool execution. Pod lost connection to database.");
      }
      outputData = await runLogic();
    } catch (error: unknown) {
      status = "failed";
      errorInfo = toErrorMessage(error);
      span.recordException(error instanceof Error ? error : new Error(errorInfo));
      span.setStatus({ code: SpanStatusCode.ERROR, message: errorInfo });
      logger.error({ taskId, stepNumber, err: error }, "Step failed");
    }

    const durationMs = Date.now() - startTime;
    span.setAttributes({ "step.duration_ms": durationMs, "step.status": status });

    const [checkpoint] = await db.insert(checkpoints).values({
      id: crypto.randomUUID(),
      task_id: taskId,
      step_number: stepNumber,
      step_name: stepName,
      step_status: status,
      duration_ms: durationMs,
      input_data: inputData as Record<string, unknown>,
      output_data: outputData as Record<string, unknown>,
      error_info: errorInfo,
    }).returning();

    await db.update(tasks)
      .set({ current_step: { step_number: stepNumber, step_name: stepName, step_status: status }, updated_at: new Date() })
      .where(eq(tasks.task_id, taskId));

    taskEventEmitter.emit(`checkpoint-${taskId}`, { ...checkpoint, event: status });

    if (status !== "failed") {
      span.setStatus({ code: SpanStatusCode.OK });
      logger.info({ taskId, stepNumber, durationMs }, "Step completed successfully");
    }
    span.end();

    if (status === "failed") throw new Error(errorInfo || "Step failed");
    return outputData;
  });
}

// ─── Step handlers ─────────────────────────────────────────────────────────────

export async function memoryRetrievalHandler(goal: string, teamId: string | null = null): Promise<Record<string, unknown>> {
  const queryEmbedding = await embed(goal);
  let related: { goal: string; outcome: string; score: number; created_at: Date }[] = [];

  // Memories are strictly team-scoped: a team's incidents must never surface in
  // another team's LLM context. Tasks without a team only see team-less memories.
  const teamFilter = sql`${memories.team_id} IS NOT DISTINCT FROM ${teamId}`;

  if (queryEmbedding) {
    // Fetch top 20 by cosine similarity, then re-rank with time-decay weighting
    // using top-k selection (O(n·log k)) instead of full sort (O(n log n)).
    // Only the summary columns are selected — the vectors stay in the database.
    const candidates = await db.select(memorySummaryColumns).from(memories)
      .where(sql`${memories.embedding} IS NOT NULL AND ${teamFilter}`)
      .orderBy(sql`${memories.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector`)
      .limit(20);

    const now = Date.now();
    const HALF_LIFE_MS = 180 * 24 * 60 * 60 * 1000; // 180 days

    const scored = candidates.map((m) => ({
      ...m,
      _effective_score: m.score * Math.exp(-(now - new Date(m.created_at).getTime()) / HALF_LIFE_MS),
    }));

    related = topK(scored, 3, (m) => m._effective_score);
  } else {
    related = await db.select(memorySummaryColumns).from(memories)
      .where(teamFilter).orderBy(desc(memories.created_at)).limit(3);
  }

  return {
    loaded_memories: related.length,
    context: related.length > 0 ? "Relevant past incidents loaded from episodic memory." : "No prior incidents found.",
    similar_incidents: related.map((m) => ({ goal: m.goal, outcome: m.outcome, score: m.score })),
  };
}

export async function plannerHandler(
  goal: string,
  context: string,
  taskType: string,
  injectFailure: boolean,
  dryRun: boolean
): Promise<PlanContext> {
  const llm = getLLMClient();

  if (llm && !injectFailure) {
    // getMcpToolSummary() returns a cached string — built once per process lifetime
    const toolSummary = await getMcpToolSummary().catch(() => null)
      ?? "search_logs(service, query), get_metrics(service, metric), search_runbook(query), create_ticket(title, description, severity), list_services()";

    const dryNote = dryRun ? "\nNote: this is a dry run — do NOT include create_ticket in tool_calls." : "";
    const response = await llm.chat.completions.create({
      model: LLM_MODELS.PLANNER,
      messages: [{
        role: "user",
        content: `Plan a response for this incident goal: ${goal}\nContext: ${context}${dryNote}\n\nAvailable tools:\n${toolSummary}\n\nRespond in strict JSON:\n{"intent":"string","tool_calls":[{"tool":"string","args":{}}],"reasoning_summary":"string"}`,
      }],
    });

    const parsed = parseLLMJson<PlanContext>(response.choices[0]?.message?.content ?? "{}");
    if (parsed) return parsed;
    logger.error("LLM JSON parse failed, falling back to procedural plan");
  }

  await sleep(1000);
  const service = goal.split(" ").find((w) => w.includes("-service")) ?? "unknown-service";
  const fallbackCalls: ToolCall[] = [
    { tool: "search_logs",     args: { service, query: goal, severity: "error" } },
    { tool: "get_metrics",     args: { service, metric: "latency_p99", time_range: "1h" } },
    { tool: "search_runbook",  args: { query: goal } },
  ];
  if (!dryRun) {
    fallbackCalls.push({ tool: "create_ticket", args: { title: `Incident: ${goal.slice(0, 80)}`, description: goal, severity: "high" } });
  }
  return {
    intent: taskType,
    tool_calls: fallbackCalls,
    reasoning_summary: "Examining logs, metrics, and runbooks to isolate the issue.",
  };
}

/**
 * Queries historical avg duration per tool name from the checkpoints table,
 * then uses 0/1 Knapsack DP to select the optimal subset within budgetMs.
 * Falls back to the full list when no history exists (first run).
 */
async function pruneToolsWithKnapsack(
  toolCalls: ToolCall[],
  budgetMs: number
): Promise<ToolCall[]> {
  if (toolCalls.length === 0) return toolCalls;

  try {
    // Load historical avg duration per tool from the checkpoints table
    const stats = await db.select({
      step_name: checkpoints.step_name,
      avg_ms:    sql<number>`AVG(duration_ms)`,
    })
      .from(checkpoints)
      .where(and(eq(checkpoints.step_status, "success"), sql`step_name LIKE 'tool_%'`))
      .groupBy(checkpoints.step_name);

    const durMap = new Map(stats.map(s => [s.step_name.replace("tool_", ""), Math.round(Number(s.avg_ms))]));

    const options: ToolOption[] = toolCalls.map(call => ({
      name: call.tool,
      args: call.args,
      // Default to 2 000 ms if no history; tools without history are assumed cheap
      avgDurationMs: durMap.get(call.tool) ?? 2_000,
      // All tools are treated as equally valuable by default — the LLM chose them
      value: 1,
    }));

    const totalEstimate = options.reduce((s, t) => s + t.avgDurationMs, 0);
    if (totalEstimate <= budgetMs) return toolCalls; // all fit — skip DP

    const selected = selectOptimalTools(options, budgetMs);
    const selectedNames = new Set(selected.map(t => t.name));
    logger.info({ budget_ms: budgetMs, total_ms: totalEstimate, kept: selected.map(t => t.name) }, "Knapsack pruned tool set");

    return toolCalls.filter(c => selectedNames.has(c.tool));
  } catch {
    // Non-fatal: fall back to the full tool list on any error
    return toolCalls;
  }
}

// Tools with external side effects must never be served from cache (a "cached"
// ticket means no ticket was created) and must be skipped entirely on dry runs.
const SIDE_EFFECT_TOOLS = new Set(["create_ticket"]);

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

export async function executionHandler(
  planContext: PlanContext,
  goal: string,
  injectFailure: boolean,
  dryRun = false
): Promise<Record<string, unknown>> {
  let toolCalls = planContext.tool_calls;

  // Enforce dry-run at the execution boundary — the planner prompt asks the LLM
  // to omit side-effect tools, but prompts are not guarantees.
  if (dryRun && Array.isArray(toolCalls)) {
    toolCalls = toolCalls.filter((c) => !SIDE_EFFECT_TOOLS.has(c.tool));
  }

  // Only connect (and potentially spawn the tools subprocess) when it can be used
  const canUseMcp = !injectFailure && Array.isArray(toolCalls) && toolCalls.length > 0;
  const mcpClient = canUseMcp ? await getMcpClient() : null;

  if (mcpClient && Array.isArray(toolCalls) && toolCalls.length > 0) {
    // 0/1 Knapsack: prune tool set to fit within budget using historical avg durations
    // Avoids blowing the step SLO when the planner selects many expensive tools.
    const STEP_BUDGET_MS = Number(process.env.TOOL_BUDGET_MS ?? 15_000);
    // Hard wall-clock cap per tool call — a hung backend must not stall the step forever
    const CALL_TIMEOUT_MS = Number(process.env.TOOL_CALL_TIMEOUT_MS ?? 10_000);
    const prunedCalls = await pruneToolsWithKnapsack(toolCalls, STEP_BUDGET_MS);

    // Run all tools in parallel — independent calls, no reason to serialize
    const entries = await Promise.all(
      prunedCalls.map(async ({ tool, args }) => {
        const cacheable = !SIDE_EFFECT_TOOLS.has(tool);
        const key = toolCacheKey(tool, args);
        if (cacheable) {
          const cached = getCached(key);
          if (cached) {
            logger.info({ tool }, "Tool result served from cache");
            return [`tool_${tool}`, cached] as const;
          }
        }
        try {
          const result = await withTimeout(executeMcpTool(tool, args), CALL_TIMEOUT_MS, `tool ${tool}`);
          if (cacheable) setCached(key, result);
          return [`tool_${tool}`, result] as const;
        } catch (e: unknown) {
          logger.error({ err: e, tool }, "MCP tool execution failed");
          return [`tool_${tool}`, { success: false, error: toErrorMessage(e) }] as const;
        }
      })
    );
    return Object.fromEntries(entries);
  }

  // Fallback: service-aware stubs when MCP unavailable
  await sleep(1500);
  const service = toolCalls?.[0]?.args?.service as string ?? "unknown-service";
  const results: Record<string, unknown> = {};

  for (const call of toolCalls ?? []) {
    results[`tool_${call.tool}`] = buildFallbackToolResult(call.tool, call.args, service);
  }

  return Object.keys(results).length > 0 ? results : {
    tool_search_logs: buildFallbackToolResult("search_logs", { service, query: goal }, service),
    tool_get_metrics: buildFallbackToolResult("get_metrics",  { service, metric: "latency_p99" }, service),
  };
}

/**
 * MCP-unavailable fallback. Uses the same simulation world model as the tools
 * server (state-derived output, never query-echo) and wraps payloads in MCP
 * content shape so the synthesizer treats them identically to real tool output.
 */
function buildFallbackToolResult(tool: string, args: Record<string, unknown>, defaultService: string): unknown {
  const now = new Date().toISOString();
  const service = String(args.service ?? defaultService);

  const payload = (() => {
    switch (tool) {
      case "search_logs": {
        const { total_matched, entries, note } = simulateLogs(service, String(args.query ?? ""), 10);
        return { backend: "fallback", service, query: args.query, total_matched, ...(note ? { note } : {}), entries };
      }
      case "get_metrics": {
        const metric = String(args.metric ?? "latency_p99");
        const { threshold, ...sim } = simulateMetrics(service, metric, 3600);
        return { backend: "fallback", service, metric, ...sim, ...(threshold !== null ? { threshold } : {}) };
      }
      case "search_runbook":
        return { backend: "fallback", query: args.query, results: [
          { title: `Runbook: ${service} incident response`, url: "#", excerpt: `Standard procedure for ${service} incidents: 1. Check logs 2. Review metrics 3. Escalate if SLO breached.` },
        ]};
      case "create_ticket":
        return { backend: "fallback", ticket_id: `INC-${Math.floor(1000 + Math.random() * 9000)}`, title: args.title, status: "open", created_at: now };
      case "list_services":
        return { backend: "fallback", total: simulateServices("all").length, services: simulateServices("all"), checked_at: now };
      default:
        return { backend: "fallback", result: `Tool ${tool} executed` };
    }
  })();

  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

export async function synthesizerHandler(
  executionOutput: Record<string, unknown>,
  goal: string,
  injectFailure: boolean
): Promise<SynthOutput> {
  const llm = getLLMClient();

  if (llm && !injectFailure) {
    const response = await llm.chat.completions.create({
      model: LLM_MODELS.SYNTHESIZER,
      messages: [{
        role: "user",
        content: `Synthesize this incident data into a report. Respond in strict JSON: {"summary":"string","probable_cause":"string","affected_systems":["string"],"next_actions":["string"],"ticket_id":"string"}\n\nData:\n${JSON.stringify(executionOutput, null, 2)}`,
      }],
    });

    const parsed = parseLLMJson<SynthOutput>(response.choices[0]?.message?.content ?? "{}");
    if (parsed?.summary) return parsed;
    logger.error("LLM JSON parse failed, falling back to derived synthesis");
  }

  await sleep(1200);
  return deriveSynthesisFromOutput(executionOutput, goal);
}

// ─── Memory score ───────────────────────────────────────────────────────────

function calculateMemoryScore(resumeCount: number, synth: SynthOutput): number {
  let score = 0.7;
  if (synth.ticket_id && !synth.ticket_id.startsWith("tr-")) score += 0.1;
  if (synth.probable_cause && !synth.probable_cause.includes("further investigation")) score += 0.1;
  if (synth.affected_systems.length > 0 && synth.affected_systems[0] !== "unknown-service") score += 0.05;
  if (synth.next_actions.length >= 2) score += 0.05;
  score -= Math.min(0.2, resumeCount * 0.05); // penalise retries
  return Math.min(1.0, Math.max(0.3, parseFloat(score.toFixed(2))));
}

// ─── Pipeline definition ──────────────────────────────────────────────────────

type TaskRow = typeof tasks.$inferSelect;

/**
 * One pipeline step. To add a step, append an entry here — checkpointing,
 * resume-skip, tracing, and SSE events all come from executeStep() for free.
 *
 * Contract:
 * - `run` output must be JSON-serializable (it is persisted as the checkpoint
 *   and fed to later steps verbatim on resume).
 * - Read earlier outputs from `ctx[<step name>]`; never from module state,
 *   because on resume those steps may not have run in this process.
 * - Anything with external side effects must respect task.dry_run.
 */
interface PipelineStep {
  number: number;
  name: string;
  /** Checkpoint input payload — recorded for the audit trail. */
  input: (task: TaskRow, ctx: Record<string, unknown>) => unknown;
  run: (task: TaskRow, ctx: Record<string, unknown>) => Promise<unknown>;
}

const PIPELINE: PipelineStep[] = [
  {
    number: 1,
    name: "memory_retrieval",
    input: (task) => ({ goal: task.goal }),
    run: (task) => memoryRetrievalHandler(task.goal, task.team_id),
  },
  {
    number: 2,
    name: "planner",
    input: (_task, ctx) => ({ memoryContext: ctx.memory_retrieval }),
    run: (task) => plannerHandler(task.goal, task.context, task.task_type, task.inject_failure, task.dry_run),
  },
  {
    number: 3,
    name: "execution",
    input: (_task, ctx) => ({ planContext: ctx.planner }),
    run: (task, ctx) => executionHandler(ctx.planner as PlanContext, task.goal, task.inject_failure, task.dry_run),
  },
  {
    number: 4,
    name: "synthesizer",
    input: (_task, ctx) => ({ executionOutput: ctx.execution }),
    run: (task, ctx) => synthesizerHandler(ctx.execution as Record<string, unknown>, task.goal, task.inject_failure),
  },
];

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export async function runTaskOrchestrator(taskId: string) {
  const [task] = await db.select().from(tasks).where(eq(tasks.task_id, taskId));
  if (!task) return;

  return tracer.startActiveSpan("task.run", async (taskSpan) => {
    taskSpan.setAttributes({
      "task.id": taskId,
      "task.trace_id": task.trace_id,
      "task.goal": task.goal,
      "task.dry_run": task.dry_run,
    });

    try {
      await db.update(tasks)
        .set({ status: "running", updated_at: new Date() })
        .where(eq(tasks.task_id, taskId));
      taskEventEmitter.emit(`task-update-${taskId}`, { status: "running" });

      const done = await db.select().from(checkpoints)
        .where(and(eq(checkpoints.task_id, taskId), eq(checkpoints.step_status, "success")));

      // Map for O(1) lookup instead of repeated O(n) done.find() scans
      const doneMap = new Map(done.map((c) => [c.step_number, c]));
      const completedSteps = new Set(doneMap.keys());

      // Walk the pipeline: completed steps are loaded from their checkpoints
      // (never re-run — that's the resume guarantee), pending steps execute.
      // The preloaded task is passed through to avoid a redundant SELECT per step.
      const ctx: Record<string, unknown> = {};
      for (const step of PIPELINE) {
        ctx[step.name] = completedSteps.has(step.number)
          ? (doneMap.get(step.number)?.output_data ?? {})
          : await executeStep(taskId, step.number, step.name, step.input(task, ctx),
              () => step.run(task, ctx), task);
      }
      const synthOutput = ctx.synthesizer as SynthOutput;

      await db.update(tasks)
        .set({ status: "completed", final_output: JSON.stringify(synthOutput, null, 2), updated_at: new Date() })
        .where(eq(tasks.task_id, taskId));

      // Dry-run: skip memory write and ticket creation side-effects
      if (!task.dry_run) {
        const memOutcome = synthOutput.summary ?? `Incident resolved: ${task.goal}`;
        const embeddingVector = await embed(`${task.goal} ${memOutcome}`);
        const memScore = calculateMemoryScore(task.resume_count, synthOutput);
        await db.insert(memories).values({
          memory_id: crypto.randomUUID(),
          task_id: taskId,
          team_id: task.team_id ?? null,
          goal: task.goal,
          outcome: memOutcome,
          score: memScore,
          embedding: embeddingVector ?? undefined,
        });
        logger.info({ taskId, memScore }, "Episodic memory written");
      }

      taskEventEmitter.emit(`task-update-${taskId}`, { status: "completed", final_output: JSON.stringify(synthOutput, null, 2) });
      taskSpan.setStatus({ code: SpanStatusCode.OK });

    } catch (error: unknown) {
      const message = toErrorMessage(error);
      logger.error({ taskId, err: error }, "Task orchestrator failed");
      taskSpan.recordException(error instanceof Error ? error : new Error(message));
      taskSpan.setStatus({ code: SpanStatusCode.ERROR, message });
      await db.update(tasks)
        .set({ status: "failed", error: message, updated_at: new Date() })
        .where(eq(tasks.task_id, taskId));
      taskEventEmitter.emit(`task-update-${taskId}`, { status: "failed", error: message });
    } finally {
      taskSpan.end();
    }
  });
}

export async function recoverStaleTasks() {
  // Only resume tasks touched in the last 24h — restarting after a long outage
  // must not stampede-rerun weeks of abandoned tasks (and their LLM calls).
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const stale = await db.select({ task_id: tasks.task_id }).from(tasks).where(
    and(inArray(tasks.status, ["running", "pending"]), gte(tasks.updated_at, dayAgo))
  );
  if (stale.length === 0) return;
  logger.info({ count: stale.length }, "Recovering stale tasks from previous run");

  // Single bulk UPDATE instead of N sequential writes — O(1) round-trip vs O(N)
  // The status filter guards against a TOCTOU race: a task that completed between
  // the SELECT above and this UPDATE must not be reset to pending and re-run.
  await db.update(tasks)
    .set({ status: "pending", error: null, updated_at: new Date() })
    .where(and(
      inArray(tasks.task_id, stale.map(t => t.task_id)),
      inArray(tasks.status, ["running", "pending"])
    ));

  stale.forEach(t => setImmediate(() => runTaskOrchestrator(t.task_id)));
}

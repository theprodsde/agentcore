import { EventEmitter } from "events";
import crypto from "crypto";
import { eq, and, inArray, sql, desc } from "drizzle-orm";
import { db, tasks, checkpoints, memories } from "./db/index";
import { logger } from "./logger";
import { getMcpClient, executeMcpTool, listMcpTools } from "./mcp";
import { embed } from "./embeddings";
import { getLLMClient, LLM_MODELS } from "./llm";
import { tracer, SpanStatusCode } from "./telemetry";
import { parseLLMJson, toErrorMessage } from "../utils/index";
import { deriveSynthesisFromOutput, type SynthOutput } from "../utils/synthesis";
import { getCached, setCached, toolCacheKey } from "./cache";
export { deriveSynthesisFromOutput } from "../utils/synthesis";

export const taskEventEmitter = new EventEmitter();

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
  runLogic: () => Promise<unknown>
): Promise<unknown> {
  const [task] = await db.select().from(tasks).where(eq(tasks.task_id, taskId));
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

export async function memoryRetrievalHandler(goal: string): Promise<Record<string, unknown>> {
  const queryEmbedding = await embed(goal);
  let related: typeof memories.$inferSelect[] = [];

  if (queryEmbedding) {
    // Fetch top 10 by cosine similarity, then re-rank with time-decay weighting
    const candidates = await db.select().from(memories)
      .where(sql`${memories.embedding} IS NOT NULL`)
      .orderBy(sql`${memories.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector`)
      .limit(10);

    const now = Date.now();
    const HALF_LIFE_MS = 180 * 24 * 60 * 60 * 1000; // 180 days

    related = candidates
      .map((m) => ({
        ...m,
        _effective_score: m.score * Math.exp(-(now - new Date(m.created_at).getTime()) / HALF_LIFE_MS),
      }))
      .sort((a, b) => b._effective_score - a._effective_score)
      .slice(0, 3);
  } else {
    related = await db.select().from(memories).orderBy(desc(memories.created_at)).limit(3);
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
    const toolList = await listMcpTools().catch(() => []);
    const toolSummary = toolList.length > 0
      ? toolList.map((t) => {
          const schema = t.inputSchema as { properties?: Record<string, { type: string }> } | undefined;
          const params = Object.entries(schema?.properties ?? {}).map(([k, v]) => `${k}(${v.type})`).join(", ");
          return `- ${t.name}(${params}): ${t.description}`;
        }).join("\n")
      : "search_logs(service, query), get_metrics(service, metric), search_runbook(query), create_ticket(title, description, severity), list_services()";

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

export async function executionHandler(
  planContext: PlanContext,
  goal: string,
  injectFailure: boolean
): Promise<Record<string, unknown>> {
  const mcpClient = await getMcpClient();
  const toolCalls = planContext.tool_calls;

  if (mcpClient && !injectFailure && Array.isArray(toolCalls) && toolCalls.length > 0) {
    // Run all tools in parallel — independent calls, no reason to serialize
    const entries = await Promise.all(
      toolCalls.map(async ({ tool, args }) => {
        const key = toolCacheKey(tool, args);
        const cached = getCached(key);
        if (cached) {
          logger.info({ tool }, "Tool result served from cache");
          return [`tool_${tool}`, cached] as const;
        }
        try {
          const result = await executeMcpTool(tool, args);
          setCached(key, result);
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
  const service = planContext.tool_calls?.[0]?.args?.service as string ?? "unknown-service";
  const results: Record<string, unknown> = {};

  for (const call of planContext.tool_calls ?? []) {
    results[`tool_${call.tool}`] = buildFallbackToolResult(call.tool, call.args, service);
  }

  return Object.keys(results).length > 0 ? results : {
    tool_search_logs: buildFallbackToolResult("search_logs", { service, query: goal }, service),
    tool_get_metrics: buildFallbackToolResult("get_metrics",  { service, metric: "latency_p99" }, service),
  };
}

function buildFallbackToolResult(tool: string, args: Record<string, unknown>, service: string): unknown {
  const now = new Date().toISOString();
  switch (tool) {
    case "search_logs":
      return { backend: "fallback", service, query: args.query, total_matched: 2, entries: [
        { timestamp: now, severity: "error", service, message: `Repeated failures detected in ${service}`, trace_id: `tr-${crypto.randomBytes(4).toString("hex")}` },
        { timestamp: now, severity: "warn",  service, message: `High latency observed in ${service} request path`, trace_id: `tr-${crypto.randomBytes(4).toString("hex")}` },
      ]};
    case "get_metrics":
      return { backend: "fallback", service, metric: args.metric, current: 87.4, unit: "%", trend: "rising", threshold: 80, threshold_breached: true };
    case "search_runbook":
      return { backend: "fallback", query: args.query, results: [
        { title: `Runbook: ${service} incident response`, url: "#", excerpt: `Standard procedure for ${service} incidents: 1. Check logs 2. Review metrics 3. Escalate if SLO breached.` },
      ]};
    case "create_ticket":
      return { backend: "fallback", ticket_id: `INC-${Math.floor(1000 + Math.random() * 9000)}`, title: args.title, status: "open", created_at: now };
    case "list_services":
      return { backend: "fallback", services: [{ name: service, status: "degraded" }] };
    default:
      return { backend: "fallback", result: `Tool ${tool} executed` };
  }
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
      const completedSteps = new Set(done.map((c) => c.step_number));

      const memoryContext = completedSteps.has(1)
        ? (done.find((c) => c.step_number === 1)?.output_data ?? {})
        : await executeStep(taskId, 1, "memory_retrieval", { goal: task.goal },
            () => memoryRetrievalHandler(task.goal));

      const planContext = completedSteps.has(2)
        ? (done.find((c) => c.step_number === 2)?.output_data ?? {}) as PlanContext
        : await executeStep(taskId, 2, "planner", { memoryContext },
            () => plannerHandler(task.goal, task.context, task.task_type, task.inject_failure, task.dry_run)) as PlanContext;

      const executionOutput = completedSteps.has(3)
        ? (done.find((c) => c.step_number === 3)?.output_data ?? {}) as Record<string, unknown>
        : await executeStep(taskId, 3, "execution", { planContext },
            () => executionHandler(planContext, task.goal, task.inject_failure)) as Record<string, unknown>;

      const synthOutput = completedSteps.has(4)
        ? (done.find((c) => c.step_number === 4)?.output_data ?? {}) as SynthOutput
        : await executeStep(taskId, 4, "synthesizer", { executionOutput },
            () => synthesizerHandler(executionOutput, task.goal, task.inject_failure)) as SynthOutput;

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
  const stale = await db.select().from(tasks).where(inArray(tasks.status, ["running", "pending"]));
  if (stale.length === 0) return;
  logger.info({ count: stale.length }, "Recovering stale tasks from previous run");
  for (const task of stale) {
    await db.update(tasks)
      .set({ status: "pending", error: null, updated_at: new Date() })
      .where(eq(tasks.task_id, task.task_id));
    setImmediate(() => runTaskOrchestrator(task.task_id));
  }
}

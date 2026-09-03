import { EventEmitter } from "events";
import crypto from "crypto";
import { eq, and, inArray, sql } from "drizzle-orm";
import { db, tasks, checkpoints, memories } from "./db/index";
import { logger } from "./logger";
import { getMcpClient, executeMcpTool, listMcpTools } from "./mcp";
import { embed } from "./embeddings";
import { getLLMClient, LLM_MODELS } from "./llm";
import { tracer, SpanStatusCode } from "./telemetry";
import { parseLLMJson, toErrorMessage } from "../utils/index";
import { deriveSynthesisFromOutput, type SynthOutput } from "../utils/synthesis";
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


// ─── Shared checkpoint wrapper ────────────────────────────────────────────────

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
    span.setAttributes({
      "task.id": taskId,
      "task.trace_id": task.trace_id,
      "step.number": stepNumber,
      "step.name": stepName,
    });

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

// ─── Step handlers (each independently testable) ─────────────────────────────

export async function memoryRetrievalHandler(goal: string): Promise<Record<string, unknown>> {
  const queryEmbedding = await embed(goal);
  let related: typeof memories.$inferSelect[] = [];

  if (queryEmbedding) {
    related = await db.select().from(memories)
      .where(sql`${memories.embedding} IS NOT NULL`)
      .orderBy(sql`${memories.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector`)
      .limit(3);
  } else {
    related = await db.select().from(memories).limit(3);
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
  injectFailure: boolean
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
      : "search_logs(service, query), get_metrics(service, metric), create_ticket(title, description, severity), list_services()";

    const response = await llm.chat.completions.create({
      model: LLM_MODELS.PLANNER,
      messages: [{
        role: "user",
        content: `Plan a response for this incident goal: ${goal}\nContext: ${context}\n\nAvailable tools:\n${toolSummary}\n\nRespond in strict JSON:\n{"intent":"string","tool_calls":[{"tool":"string","args":{}}],"reasoning_summary":"string"}`,
      }],
    });

    const parsed = parseLLMJson<PlanContext>(response.choices[0]?.message?.content ?? "{}");
    if (parsed) return parsed;
    logger.error("LLM JSON parse failed, falling back to procedural plan");
  }

  await sleep(1000);
  const service = goal.split(" ").find((w) => w.includes("-service")) ?? "unknown-service";
  return {
    intent: taskType,
    tool_calls: [
      { tool: "search_logs", args: { service, query: goal, severity: "error" } },
      { tool: "get_metrics",  args: { service, metric: "latency_p99", time_range: "1h" } },
    ],
    reasoning_summary: "Examining recent logs and metrics to isolate the issue.",
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
    const results: Record<string, unknown> = {};
    for (const { tool, args } of toolCalls) {
      try {
        results[`tool_${tool}`] = await executeMcpTool(tool, args);
      } catch (e: unknown) {
        logger.error({ err: e, tool }, "MCP tool execution failed");
        results[`tool_${tool}`] = { success: false, error: toErrorMessage(e) };
      }
    }
    return results;
  }

  // Fallback: generate realistic stub results keyed to the actual tools the planner selected
  await sleep(1500);
  const service = planContext.tool_calls?.[0]?.args?.service as string ?? "unknown-service";
  const results: Record<string, unknown> = {};

  for (const call of planContext.tool_calls ?? []) {
    results[`tool_${call.tool}`] = buildFallbackToolResult(call.tool, call.args, service);
  }

  return Object.keys(results).length > 0 ? results : {
    tool_search_logs: buildFallbackToolResult("search_logs", { service, query: goal }, service),
    tool_get_metrics:  buildFallbackToolResult("get_metrics",  { service, metric: "latency_p99" }, service),
  };
}

/** Builds a plausible stub result for a given tool and its args — used when MCP is unavailable. */
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

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export async function runTaskOrchestrator(taskId: string) {
  const [task] = await db.select().from(tasks).where(eq(tasks.task_id, taskId));
  if (!task) return;

  return tracer.startActiveSpan("task.run", async (taskSpan) => {
    taskSpan.setAttributes({ "task.id": taskId, "task.trace_id": task.trace_id, "task.goal": task.goal });

    try {
      await db.update(tasks)
        .set({ status: "running", updated_at: new Date() })
        .where(eq(tasks.task_id, taskId));
      taskEventEmitter.emit(`task-update-${taskId}`, { status: "running" });

      const done = await db.select().from(checkpoints)
        .where(and(eq(checkpoints.task_id, taskId), eq(checkpoints.step_status, "success")));
      const completedSteps = new Set(done.map((c) => c.step_number));

      // Step 1 — Memory Retrieval
      const memoryContext = completedSteps.has(1)
        ? (done.find((c) => c.step_number === 1)?.output_data ?? {})
        : await executeStep(taskId, 1, "memory_retrieval", { goal: task.goal },
            () => memoryRetrievalHandler(task.goal));

      // Step 2 — Planning
      const planContext = completedSteps.has(2)
        ? (done.find((c) => c.step_number === 2)?.output_data ?? {}) as PlanContext
        : await executeStep(taskId, 2, "planner", { memoryContext },
            () => plannerHandler(task.goal, task.context, task.task_type, task.inject_failure)) as PlanContext;

      // Step 3 — MCP Tool Execution
      const executionOutput = completedSteps.has(3)
        ? (done.find((c) => c.step_number === 3)?.output_data ?? {}) as Record<string, unknown>
        : await executeStep(taskId, 3, "execution", { planContext },
            () => executionHandler(planContext, task.goal, task.inject_failure)) as Record<string, unknown>;

      // Step 4 — Synthesis
      const synthOutput = completedSteps.has(4)
        ? (done.find((c) => c.step_number === 4)?.output_data ?? {}) as SynthOutput
        : await executeStep(taskId, 4, "synthesizer", { executionOutput },
            () => synthesizerHandler(executionOutput, task.goal, task.inject_failure)) as SynthOutput;

      await db.update(tasks)
        .set({ status: "completed", final_output: JSON.stringify(synthOutput, null, 2), updated_at: new Date() })
        .where(eq(tasks.task_id, taskId));

      // Write episodic memory using the actual synthesized summary
      const memOutcome = synthOutput.summary ?? `Incident resolved: ${task.goal}`;
      const embeddingVector = await embed(`${task.goal} ${memOutcome}`);
      await db.insert(memories).values({
        memory_id: crypto.randomUUID(),
        task_id: taskId,
        team_id: task.team_id ?? null,
        goal: task.goal,
        outcome: memOutcome,
        score: synthOutput.probable_cause ? 0.9 : 0.6,
        embedding: embeddingVector ?? undefined,
      });

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

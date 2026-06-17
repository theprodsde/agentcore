import { inMemoryDB, Task, Checkpoint } from "./db";
import { EventEmitter } from "events";
import crypto from "crypto";

export const taskEventEmitter = new EventEmitter();

// Simulate an LLM call or MCP Tool execution
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function executeStep(
  taskId: string,
  stepNumber: number,
  stepName: string,
  inputData: any,
  runLogic: () => Promise<any>
) {
  const task = inMemoryDB.tasks.get(taskId);
  if (!task) return null;

  task.current_step = { step_number: stepNumber, step_name: stepName, step_status: "running" };
  taskEventEmitter.emit(`checkpoint-${taskId}`, { ...task.current_step, event: "started" });

  const startTime = Date.now();
  let outputData = null;
  let errorInfo = null;
  let status: "success" | "failed" = "success";

  try {
    // Artificial failure injection mechanism for Demo Case 1 (ST-070)
    if (task.inject_failure && stepNumber === 3 && stepName === "execution" && task.resume_count === 0) {
      throw new Error("Simulated network timeout during tool execution. Pod lost connection to database.");
    }

    outputData = await runLogic();
  } catch (error: any) {
    status = "failed";
    errorInfo = error.message;
  }

  const durationMs = Date.now() - startTime;

  const checkpoint: Checkpoint = {
    id: crypto.randomUUID(),
    task_id: taskId,
    step_number: stepNumber,
    step_name: stepName,
    step_status: status,
    duration_ms: durationMs,
    input_data: inputData,
    output_data: outputData,
    error_info: errorInfo,
    created_at: new Date().toISOString(),
  };

  const checkpoints = inMemoryDB.checkpoints.get(taskId) || [];
  checkpoints.push(checkpoint);
  inMemoryDB.checkpoints.set(taskId, checkpoints);

  task.current_step = { step_number: stepNumber, step_name: stepName, step_status: status };
  taskEventEmitter.emit(`checkpoint-${taskId}`, { ...checkpoint, event: status });

  if (status === "failed") {
    throw new Error(errorInfo || "Step failed");
  }

  return outputData;
}

export async function runTaskOrchestrator(taskId: string) {
  const task = inMemoryDB.tasks.get(taskId);
  if (!task) return;

  try {
    task.status = "running";
    task.updated_at = new Date().toISOString();
    taskEventEmitter.emit(`task-update-${taskId}`, { status: task.status });

    const checkpoints = inMemoryDB.checkpoints.get(taskId) || [];
    const completedStepNumbers = checkpoints.filter((c) => c.step_status === "success").map((c) => c.step_number);

    // Step 1: Memory Retrieval (ST-032)
    let memoryContext = {};
    if (!completedStepNumbers.includes(1)) {
      memoryContext = await executeStep(taskId, 1, "memory_retrieval", { goal: task.goal }, async () => {
        await sleep(600);
        const related = inMemoryDB.memories.slice(0, 2);
        return { loaded_memories: related.length, context: "Enhanced context loaded from episodic memory." };
      });
    } else {
      memoryContext = checkpoints.find((c) => c.step_number === 1)?.output_data || {};
    }

    // Step 2: Planning (ST-011)
    let planContext = {};
    if (!completedStepNumbers.includes(2)) {
      planContext = await executeStep(taskId, 2, "planner", { memoryContext }, async () => {
        await sleep(1000);
        return {
          intent: task.task_type,
          tools_selected: ["search_logs", "get_metrics"],
          reasoning_summary: "Based on the goal, examining recent system logs and metric telemetry will isolate the bottleneck.",
        };
      });
    } else {
      planContext = checkpoints.find((c) => c.step_number === 2)?.output_data || {};
    }

    // Step 3: MCP Tool Execution (ST-012, ST-040, ST-041)
    let executionOutput = {};
    if (!completedStepNumbers.includes(3)) {
      executionOutput = await executeStep(taskId, 3, "execution", { planContext }, async () => {
        await sleep(1500);
        return {
          tool_search_logs: { success: true, duration: 42, result: "Discovered repeated deadlock error in module 'inventory-service': ER_LOCK_WAIT_TIMEOUT." },
          tool_get_metrics: { success: true, duration: 25, result: "CPU spike corresponding to deadlock timestamps." },
        };
      });
    } else {
      executionOutput = checkpoints.find((c) => c.step_number === 3)?.output_data || {};
    }

    // Step 4: Synthesizer (ST-011)
    let synthOutput = {};
    if (!completedStepNumbers.includes(4)) {
      synthOutput = await executeStep(taskId, 4, "synthesizer", { executionOutput }, async () => {
        await sleep(1200);
        return {
          summary: "Isolated the issue to a deadlock timeout in the inventory service.",
          probable_cause: "High contention on row locks for popular items during the spike.",
          affected_systems: ["inventory-service", "postgres-primary"],
          next_actions: ["Restart affected pods to flush connection blocks", "Increase max pooled connections"],
          ticket_id: "INC-9952",
        };
      });
    } else {
      synthOutput = checkpoints.find((c) => c.step_number === 4)?.output_data || {};
    }

    // Task Complete Updates (ST-030)
    task.status = "completed";
    task.final_output = JSON.stringify(synthOutput, null, 2);
    task.updated_at = new Date().toISOString();

    // Write to memory
    inMemoryDB.memories.push({
      memory_id: crypto.randomUUID(),
      task_id: taskId,
      goal: task.goal,
      outcome: `Successfully mapped ${task.task_type} intent. Resolved via: High contention row locks.`,
      score: 0.95,
      created_at: new Date().toISOString()
    });

    taskEventEmitter.emit(`task-update-${taskId}`, { status: task.status, final_output: task.final_output });
  } catch (error: any) {
    console.error(`Task ${taskId} failed at step ${task.current_step?.step_number}: ${error.message}`);
    task.status = "failed";
    task.error = error.message;
    task.updated_at = new Date().toISOString();
    taskEventEmitter.emit(`task-update-${taskId}`, { status: task.status, error: task.error });
  }
}

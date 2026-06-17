// In-memory Database for Task and Checkpoint Lifecycle

export interface Task {
  task_id: string;
  goal: string;
  context: string;
  task_type: string;
  user_id: string;
  status: "pending" | "running" | "failed" | "completed";
  current_step?: {
    step_number: number;
    step_name: string;
    step_status: string;
  };
  resume_count: number;
  created_at: string;
  updated_at: string;
  final_output: string | null;
  error: string | null;
  trace_id: string;
  inject_failure?: boolean;
}

export interface Checkpoint {
  id: string;
  task_id: string;
  step_number: number;
  step_name: string;
  step_status: "pending" | "running" | "success" | "failed";
  duration_ms: number;
  input_data: any;
  output_data: any;
  error_info: string | null;
  created_at: string;
}

export interface Memory {
  memory_id: string;
  task_id: string;
  goal: string;
  outcome: string;
  score: number;
  created_at: string;
}

export const inMemoryDB = {
  tasks: new Map<string, Task>(),
  checkpoints: new Map<string, Checkpoint[]>(),
  memories: [] as Memory[],
};

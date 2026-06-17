export const API_BASE = '/api';

export async function fetchTasks() {
  const res = await fetch(`${API_BASE}/tasks`);
  const data = await res.json();
  return data.items || [];
}

export async function createTask(task: { goal: string; context?: string; task_type?: string; inject_failure?: boolean }) {
  const res = await fetch(`${API_BASE}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(task),
  });
  return res.json();
}

export async function fetchTask(taskId: string) {
  const res = await fetch(`${API_BASE}/tasks/${taskId}`);
  return res.json();
}

export async function fetchCheckpoints(taskId: string) {
  const res = await fetch(`${API_BASE}/tasks/${taskId}/checkpoints`);
  const data = await res.json();
  return data.checkpoints || [];
}

export async function fetchMemory(taskId: string) {
  const res = await fetch(`${API_BASE}/tasks/${taskId}/memory`);
  const data = await res.json();
  return data.related_memories || [];
}

export async function fetchAllMemory() {
  const res = await fetch(`${API_BASE}/memory`);
  const data = await res.json();
  return data.items || [];
}

export async function resumeTask(taskId: string) {
  const res = await fetch(`${API_BASE}/tasks/${taskId}/resume`, { method: 'POST' });
  return res.json();
}

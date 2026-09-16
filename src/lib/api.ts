import type { Task, Checkpoint, Memory } from "../types";

export const API_BASE = "/api";

// ─── Auth token ───────────────────────────────────────────────────────────────
// In-memory token store. Set via setApiToken() after a successful /auth/token call.
let _token: string | null =
  typeof localStorage !== "undefined" ? localStorage.getItem("agentcore_token") : null;

export function setApiToken(token: string | null): void {
  _token = token;
  if (typeof localStorage !== "undefined") {
    if (token) localStorage.setItem("agentcore_token", token);
    else localStorage.removeItem("agentcore_token");
  }
}

function authHeaders(): Record<string, string> {
  return _token ? { Authorization: `Bearer ${_token}` } : {};
}

// ─── Fetch wrapper ────────────────────────────────────────────────────────────
async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export async function fetchTasks(opts?: { limit?: number; offset?: number }): Promise<Task[]> {
  const params = new URLSearchParams();
  if (opts?.limit)  params.set("limit",  String(opts.limit));
  if (opts?.offset) params.set("offset", String(opts.offset));
  const qs = params.toString() ? `?${params}` : "";
  const data = await apiFetch<{ items: Task[] }>(`${API_BASE}/tasks${qs}`);
  return data.items || [];
}

export async function createTask(task: {
  goal: string;
  context?: string;
  task_type?: string;
  inject_failure?: boolean;
  dry_run?: boolean;
}): Promise<{ task_id: string; status: string; trace_id: string; correlated?: boolean }> {
  return apiFetch(`${API_BASE}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(task),
  });
}

export async function fetchTask(taskId: string): Promise<Task> {
  return apiFetch<Task>(`${API_BASE}/tasks/${taskId}`);
}

export async function fetchCheckpoints(taskId: string): Promise<Checkpoint[]> {
  const data = await apiFetch<{ checkpoints: Checkpoint[] }>(`${API_BASE}/tasks/${taskId}/checkpoints`);
  return data.checkpoints || [];
}

// ─── Memory ───────────────────────────────────────────────────────────────────

export async function fetchMemory(taskId: string): Promise<Memory[]> {
  const data = await apiFetch<{ related_memories: Memory[] }>(`${API_BASE}/tasks/${taskId}/memory`);
  return data.related_memories || [];
}

export async function fetchAllMemory(opts?: { limit?: number; offset?: number }): Promise<Memory[]> {
  const params = new URLSearchParams();
  if (opts?.limit)  params.set("limit",  String(opts.limit));
  if (opts?.offset) params.set("offset", String(opts.offset));
  const qs = params.toString() ? `?${params}` : "";
  const data = await apiFetch<{ items: Memory[] }>(`${API_BASE}/memory${qs}`);
  return data.items || [];
}

export async function resumeTask(taskId: string): Promise<{ task_id: string; status: string; resume_count: number }> {
  return apiFetch(`${API_BASE}/tasks/${taskId}/resume`, { method: "POST" });
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function exchangeApiKey(apiKey: string): Promise<string | null> {
  const data = await apiFetch<{ token: string | null }>(`${API_BASE}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey }),
  });
  if (data.token) setApiToken(data.token);
  return data.token;
}

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

export function hasApiToken(): boolean {
  return _token !== null;
}

function authHeaders(): Record<string, string> {
  return _token ? { Authorization: `Bearer ${_token}` } : {};
}

/** Fired when any API call returns 401 — AuthGate listens and shows the login screen. */
export const UNAUTHORIZED_EVENT = "agentcore:unauthorized";

function handleUnauthorized(): void {
  setApiToken(null);
  window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
}

// ─── Fetch wrapper ────────────────────────────────────────────────────────────
async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (res.status === 401 && !url.endsWith("/auth/token")) handleUnauthorized();
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
}): Promise<{ task_id: string; status: string; trace_id: string; correlated?: boolean; message?: string }> {
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

// ─── Metrics ──────────────────────────────────────────────────────────────────

export async function fetchMetrics<T>(): Promise<T> {
  return apiFetch<T>(`${API_BASE}/metrics`);
}

// ─── SSE stream (fetch-based) ─────────────────────────────────────────────────
// EventSource cannot send an Authorization header, so live task streaming would
// 401 whenever JWT auth is enabled. This reads the SSE stream via fetch instead.

export function streamTask(
  taskId: string,
  onEvent: (data: Record<string, unknown>) => void,
  onError?: () => void
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${API_BASE}/tasks/${taskId}/stream`, {
        headers: authHeaders(),
        signal: controller.signal,
      });
      if (res.status === 401) { handleUnauthorized(); throw new Error("Unauthorized"); }
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line; heartbeats start with ":"
        let sep;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try { onEvent(JSON.parse(line.slice(6))); } catch { /* ignore malformed */ }
          }
        }
      }
    } catch {
      if (!controller.signal.aborted) onError?.();
    }
  })();

  return () => controller.abort();
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function fetchAuthStatus(): Promise<{ auth_enabled: boolean }> {
  return apiFetch(`${API_BASE}/auth/status`);
}

export async function exchangeApiKey(apiKey: string): Promise<string | null> {
  const data = await apiFetch<{ token: string | null }>(`${API_BASE}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey }),
  });
  if (data.token) setApiToken(data.token);
  return data.token;
}

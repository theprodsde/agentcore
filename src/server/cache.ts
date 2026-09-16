/**
 * In-process TTL cache for MCP tool results.
 * Prevents redundant calls to search_logs / get_metrics when the same
 * tool is called twice with identical args within a short window (e.g. resume flows).
 */

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const store = new Map<string, CacheEntry>();

const DEFAULT_TTL_MS = 2 * 60 * 1000; // 2 minutes

export function getCached(key: string): unknown | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

export function setCached(key: string, value: unknown, ttlMs = DEFAULT_TTL_MS): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function toolCacheKey(tool: string, args: Record<string, unknown>): string {
  return `${tool}:${JSON.stringify(args, Object.keys(args).sort())}`;
}

/** Flush all expired entries — call periodically to avoid unbounded growth. */
export function pruneExpired(): void {
  const now = Date.now();
  for (const [k, v] of store) {
    if (now > v.expiresAt) store.delete(k);
  }
}

// Prune every 10 minutes
setInterval(pruneExpired, 10 * 60 * 1000).unref();

/**
 * In-process TTL cache with true LRU eviction.
 *
 * Data structure: doubly-linked list (recency order) + HashMap (O(1) lookup).
 * - get:    O(1) — hash lookup + move-to-front
 * - set:    O(1) — hash insert + add-to-front + optional LRU eviction from tail
 * - delete: O(1) — hash remove + unlink node
 *
 * FIFO eviction (Map.keys().next()) was replaced because it evicts the
 * oldest-inserted entry regardless of access recency, producing worse
 * hit rates under realistic "same incident re-queried soon after" patterns.
 */

interface CacheEntry<V> {
  value: V;
  expiresAt: number;
  prev: CacheEntry<V> | null;
  next: CacheEntry<V> | null;
  key: string;
}

class LRUTTLCache<V> {
  private map = new Map<string, CacheEntry<V>>();
  private head: CacheEntry<V>; // dummy MRU sentinel
  private tail: CacheEntry<V>; // dummy LRU sentinel

  constructor(private readonly maxSize: number) {
    this.head = { value: null as V, expiresAt: 0, prev: null, next: null, key: "" };
    this.tail = { value: null as V, expiresAt: 0, prev: null, next: null, key: "" };
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  get(key: string): V | null {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this._remove(entry);
      this.map.delete(key);
      return null;
    }
    this._moveToFront(entry);
    return entry.value;
  }

  set(key: string, value: V, ttlMs: number): void {
    const existing = this.map.get(key);
    if (existing) {
      existing.value = value;
      existing.expiresAt = Date.now() + ttlMs;
      this._moveToFront(existing);
      return;
    }

    const entry: CacheEntry<V> = { key, value, expiresAt: Date.now() + ttlMs, prev: null, next: null };
    this.map.set(key, entry);
    this._addToFront(entry);

    if (this.map.size > this.maxSize) this._evictLRU();
  }

  delete(key: string): void {
    const entry = this.map.get(key);
    if (!entry) return;
    this._remove(entry);
    this.map.delete(key);
  }

  pruneExpired(): void {
    const now = Date.now();
    // Walk from LRU end — expired entries tend to cluster there
    let cur = this.tail.prev;
    while (cur && cur !== this.head) {
      const prev = cur.prev;
      if (now > cur.expiresAt) {
        this._remove(cur);
        this.map.delete(cur.key);
      }
      cur = prev;
    }
  }

  get size(): number { return this.map.size; }

  private _addToFront(entry: CacheEntry<V>): void {
    entry.prev = this.head;
    entry.next = this.head.next;
    this.head.next!.prev = entry;
    this.head.next = entry;
  }

  private _remove(entry: CacheEntry<V>): void {
    entry.prev!.next = entry.next;
    entry.next!.prev = entry.prev;
  }

  private _moveToFront(entry: CacheEntry<V>): void {
    this._remove(entry);
    this._addToFront(entry);
  }

  private _evictLRU(): void {
    const lru = this.tail.prev!;
    if (lru === this.head) return;
    this._remove(lru);
    this.map.delete(lru.key);
  }
}

// ─── Public cache instance ────────────────────────────────────────────────────

const DEFAULT_TTL_MS = 2 * 60 * 1000; // 2 minutes
const MAX_STORE_SIZE = 500;

const store = new LRUTTLCache<unknown>(MAX_STORE_SIZE);

export function getCached(key: string): unknown | null {
  return store.get(key);
}

export function setCached(key: string, value: unknown, ttlMs = DEFAULT_TTL_MS): void {
  store.set(key, value, ttlMs);
}

export function toolCacheKey(tool: string, args: Record<string, unknown>): string {
  return `${tool}:${JSON.stringify(args, Object.keys(args).sort())}`;
}

export function pruneExpired(): void {
  store.pruneExpired();
}

// Prune every 10 minutes
setInterval(pruneExpired, 10 * 60 * 1000).unref();

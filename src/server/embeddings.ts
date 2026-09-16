import { getLLMClient, LLM_MODELS } from "./llm.js";
import { logger } from "./logger.js";

// ─── LRU memoization for embedding API calls ─────────────────────────────────
// Embedding a string is a paid API call (~80–200ms). The same incident goal is
// often embedded twice per request (dedup check → memory retrieval step).
//
// Data structure: doubly-linked list + HashMap for true O(1) LRU eviction.
// Each 1536-float vector ≈ 6 KB; cap at 256 entries ≈ 1.5 MB max.

interface EmbedEntry {
  vector: number[];
  expiresAt: number;
  prev: EmbedEntry | null;
  next: EmbedEntry | null;
  key: string;
}

const EMBED_TTL_MS = 5 * 60 * 1000;
const EMBED_MAX    = 256;

const embedMap  = new Map<string, EmbedEntry>();
const embedHead: EmbedEntry = { vector: [], expiresAt: 0, prev: null, next: null, key: "" };
const embedTail: EmbedEntry = { vector: [], expiresAt: 0, prev: null, next: null, key: "" };
embedHead.next = embedTail;
embedTail.prev = embedHead;

function lruGet(key: string): number[] | null {
  const entry = embedMap.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { lruDelete(entry); return null; }
  lruMoveToFront(entry);
  return entry.vector;
}

function lruSet(key: string, vector: number[]): void {
  const existing = embedMap.get(key);
  if (existing) {
    existing.vector = vector;
    existing.expiresAt = Date.now() + EMBED_TTL_MS;
    lruMoveToFront(existing);
    return;
  }
  const entry: EmbedEntry = { key, vector, expiresAt: Date.now() + EMBED_TTL_MS, prev: null, next: null };
  embedMap.set(key, entry);
  lruAddToFront(entry);
  if (embedMap.size > EMBED_MAX) lruEvict();
}

function lruDelete(entry: EmbedEntry): void {
  entry.prev!.next = entry.next;
  entry.next!.prev = entry.prev;
  embedMap.delete(entry.key);
}

function lruAddToFront(entry: EmbedEntry): void {
  entry.prev = embedHead;
  entry.next = embedHead.next;
  embedHead.next!.prev = entry;
  embedHead.next = entry;
}

function lruMoveToFront(entry: EmbedEntry): void {
  lruDelete(entry);
  lruAddToFront(entry);
  // Re-add to map since lruDelete removes it
  embedMap.set(entry.key, entry);
}

function lruEvict(): void {
  const lru = embedTail.prev!;
  if (lru === embedHead) return;
  lruDelete(lru);
}

// Prune expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  let cur = embedTail.prev;
  while (cur && cur !== embedHead) {
    const prev = cur.prev;
    if (now > cur.expiresAt) lruDelete(cur);
    cur = prev;
  }
}, 5 * 60 * 1000).unref();

// ─── Public API ───────────────────────────────────────────────────────────────

export async function embed(text: string): Promise<number[] | null> {
  const cached = lruGet(text);
  if (cached) return cached;

  const ai = getLLMClient();
  if (!ai) return null;

  try {
    const res = await ai.embeddings.create({ model: LLM_MODELS.EMBEDDING, input: text });
    const vector = res.data[0].embedding;
    lruSet(text, vector);
    return vector;
  } catch (err) {
    logger.error({ err }, "Embedding generation failed");
    return null;
  }
}

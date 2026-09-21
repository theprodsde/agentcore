import { getLLMClient, LLM_MODELS } from "./llm.js";
import { logger } from "./logger.js";
import { LRUTTLCache } from "./cache.js";

// Embedding a string is a paid API call (~80–200ms). The same incident goal is
// often embedded twice per request (dedup check → memory retrieval step).
// Each 1536-float vector ≈ 6 KB; 256 entries ≈ 1.5 MB max.
const EMBED_TTL_MS = 5 * 60 * 1000;
const EMBED_MAX    = 256;

const embedCache = new LRUTTLCache<number[]>(EMBED_MAX);

// Prune expired entries every 5 minutes
setInterval(() => embedCache.pruneExpired(), EMBED_TTL_MS).unref();

export async function embed(text: string): Promise<number[] | null> {
  const cached = embedCache.get(text);
  if (cached) return cached;

  const ai = getLLMClient();
  if (!ai) return null;

  try {
    const res = await ai.embeddings.create({ model: LLM_MODELS.EMBEDDING, input: text });
    const vector = res.data[0].embedding;
    embedCache.set(text, vector, EMBED_TTL_MS);
    return vector;
  } catch (err) {
    logger.error({ err }, "Embedding generation failed");
    return null;
  }
}

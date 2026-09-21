import OpenAI from "openai";

export const LLM_MODELS = {
  PLANNER:    process.env.LLM_MODEL       ?? "gpt-4o-mini",
  SYNTHESIZER: process.env.LLM_MODEL      ?? "gpt-4o-mini",
  EMBEDDING:  process.env.EMBEDDING_MODEL ?? "text-embedding-3-small",
} as const;

// A hung LLM call must not stall a pipeline step for the SDK's long default
// (10 min). One retry keeps transient 5xx/429s survivable without tripling cost.
const LLM_TIMEOUT_MS  = Number(process.env.LLM_TIMEOUT_MS ?? 60_000);
const LLM_MAX_RETRIES = Number(process.env.LLM_MAX_RETRIES ?? 1);

let _client: OpenAI | null = null;

/** Returns a shared OpenAI client configured from env, or null when unconfigured. */
export function getLLMClient(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key?.trim()) return null;
  if (!_client) {
    _client = new OpenAI({
      apiKey: key,
      timeout: LLM_TIMEOUT_MS,
      maxRetries: LLM_MAX_RETRIES,
      ...(process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : {}),
    });
  }
  return _client;
}

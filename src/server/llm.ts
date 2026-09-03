import OpenAI from "openai";

export const LLM_MODELS = {
  PLANNER:    process.env.LLM_MODEL       ?? "gpt-4o-mini",
  SYNTHESIZER: process.env.LLM_MODEL      ?? "gpt-4o-mini",
  EMBEDDING:  process.env.EMBEDDING_MODEL ?? "text-embedding-3-small",
} as const;

let _client: OpenAI | null = null;

/** Returns a shared OpenAI client configured from env, or null when unconfigured. */
export function getLLMClient(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key?.trim()) return null;
  if (!_client) {
    _client = new OpenAI({
      apiKey: key,
      ...(process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : {}),
    });
  }
  return _client;
}

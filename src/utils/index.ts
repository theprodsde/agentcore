/**
 * Parses a JSON string that may be wrapped in LLM markdown fences.
 * Returns null on parse failure instead of throwing.
 */
export function parseLLMJson<T = unknown>(text: string): T | null {
  try {
    const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

/** Generates a collision-resistant trace ID in the format tr-<random>-<ts-suffix>. */
export function generateTraceId(): string {
  return `tr-${Math.random().toString(36).substring(2, 11)}-${Date.now().toString().slice(-4)}`;
}

/** Safely extracts a message string from any thrown value. */
export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

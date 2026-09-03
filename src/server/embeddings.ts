import { getLLMClient, LLM_MODELS } from "./llm.js";
import { logger } from "./logger.js";

export async function embed(text: string): Promise<number[] | null> {
  const ai = getLLMClient();
  if (!ai) return null;
  try {
    const res = await ai.embeddings.create({ model: LLM_MODELS.EMBEDDING, input: text });
    return res.data[0].embedding;
  } catch (err) {
    logger.error({ err }, "Embedding generation failed");
    return null;
  }
}

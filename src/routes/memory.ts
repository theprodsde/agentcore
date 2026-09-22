import { Router } from "express";
import { eq, ne, and, desc, sql } from "drizzle-orm";
import { db, memories, memorySummaryColumns } from "../server/db/index.js";
import { embed } from "../server/embeddings.js";
import { asyncHandler } from "../server/http.js";
import { MemoryQuerySchema, zodMessage } from "../server/validation.js";
import { topK } from "../utils/algorithms.js";

export const memoryRouter = Router();

memoryRouter.get("/tasks/:task_id/memory", asyncHandler(async (req, res) => {
  const { task_id } = req.params;
  // Scope to the caller's team — related memories must not cross tenant boundaries
  const related = await db.select(memorySummaryColumns).from(memories)
    .where(and(
      ne(memories.task_id, task_id),
      sql`${memories.team_id} IS NOT DISTINCT FROM ${req.teamId ?? null}`
    ))
    .orderBy(desc(memories.created_at))
    .limit(5);
  return res.json({ task_id, related_memories: related });
}));

memoryRouter.get("/memory", asyncHandler(async (req, res) => {
  const pageSize = Math.min(Math.max(1, Number(req.query.limit) || 50), 200);
  const offset   = Math.max(0, Number(req.query.offset) || 0);

  const rows = req.teamId
    ? await db.select(memorySummaryColumns).from(memories).where(eq(memories.team_id, req.teamId))
        .orderBy(desc(memories.created_at)).limit(pageSize).offset(offset)
    : await db.select(memorySummaryColumns).from(memories)
        .orderBy(desc(memories.created_at)).limit(pageSize).offset(offset);

  return res.json({ items: rows, limit: pageSize, offset });
}));

memoryRouter.post("/memory/query", asyncHandler(async (req, res) => {
  const parsed = MemoryQuerySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });
  const { query, limit } = parsed.data;

  try {
    const queryEmbedding = await embed(query);

    if (queryEmbedding) {
      const teamFilter = sql`AND ${memories.team_id} IS NOT DISTINCT FROM ${req.teamId ?? null}`;
      const matches = await db.select({
        memory_id:  memories.memory_id,
        task_id:    memories.task_id,
        goal:       memories.goal,
        outcome:    memories.outcome,
        score:      memories.score,
        created_at: memories.created_at,
        similarity: sql<number>`1 - (${memories.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector)`,
      })
        .from(memories)
        .where(sql`${memories.embedding} IS NOT NULL ${teamFilter}`)
        .orderBy(sql`${memories.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector`)
        .limit(limit);
      return res.json({ matches, backend: "pgvector" });
    }

    // Keyword fallback scans the 100 most recent memories (not an arbitrary 100)
    const allRows = await db.select(memorySummaryColumns).from(memories)
      .where(sql`${memories.team_id} IS NOT DISTINCT FROM ${req.teamId ?? null}`)
      .orderBy(desc(memories.created_at)).limit(100);

    const words = query.toLowerCase().split(/\W+/).filter((w: string) => w.length > 2);
    // Pre-build a Set per row so membership is O(1) per word — was O(T) per word with includes()
    const scored = topK(
      allRows.map((m) => {
        const textWords = new Set(`${m.goal} ${m.outcome}`.toLowerCase().split(/\W+/));
        const hits = words.filter((w: string) => textWords.has(w)).length;
        return { ...m, similarity: Math.min(1.0, 0.15 + (hits / Math.max(words.length, 3)) * 0.85) };
      }),
      limit,
      (m) => m.similarity
    );

    return res.json({ matches: scored, backend: "word-frequency" });
  } catch (err) {
    return res.status(500).json({ error: "Memory query failed", details: err instanceof Error ? err.message : String(err) });
  }
}));

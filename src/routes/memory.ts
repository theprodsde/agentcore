import { Router } from "express";
import { eq, ne, desc, sql } from "drizzle-orm";
import { db, memories } from "../server/db/index.js";
import { embed } from "../server/embeddings.js";

export const memoryRouter = Router();

memoryRouter.get("/tasks/:task_id/memory", async (req, res) => {
  const { task_id } = req.params;
  const related = await db.select().from(memories).where(ne(memories.task_id, task_id)).limit(5);
  return res.json({ task_id, related_memories: related });
});

memoryRouter.get("/memory", async (req, res) => {
  const rows = req.teamId
    ? await db.select().from(memories).where(eq(memories.team_id, req.teamId)).orderBy(desc(memories.created_at))
    : await db.select().from(memories).orderBy(desc(memories.created_at));
  return res.json({ items: rows });
});

memoryRouter.post("/memory/query", async (req, res) => {
  const { query, limit = 5 } = req.body;
  if (!query) return res.status(400).json({ error: "query is required" });

  try {
    const queryEmbedding = await embed(query);

    if (queryEmbedding) {
      const teamFilter = req.teamId ? sql`AND ${memories.team_id} = ${req.teamId}` : sql``;
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

    const allRows = req.teamId
      ? await db.select().from(memories).where(eq(memories.team_id, req.teamId)).limit(100)
      : await db.select().from(memories).limit(100);

    const words = query.toLowerCase().split(/\W+/).filter((w: string) => w.length > 2);
    const scored = allRows
      .map((m) => {
        const text = `${m.goal} ${m.outcome}`.toLowerCase();
        const hits = words.filter((w: string) => text.includes(w)).length;
        return { ...m, similarity: Math.min(1.0, 0.15 + (hits / Math.max(words.length, 3)) * 0.85) };
      })
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return res.json({ matches: scored, backend: "word-frequency" });
  } catch (err) {
    return res.status(500).json({ error: "Memory query failed", details: err instanceof Error ? err.message : String(err) });
  }
});

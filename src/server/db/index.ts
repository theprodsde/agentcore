import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is required");
}

const client = postgres(connectionString, {
  max: 20,
  idle_timeout: 30,      // close idle connections after 30 s
  connect_timeout: 10,   // fail fast if Postgres is unreachable
  max_lifetime: 60 * 30, // recycle connections every 30 min
});
export const db = drizzle(client, { schema });

export * from "./schema";

/**
 * Memory columns for reads. Excludes `embedding` — each vector is ~6 KB and is
 * only meaningful to pgvector operators, so selecting it inflates every list
 * response and retrieval query by hundreds of KB for no consumer benefit.
 */
export const memorySummaryColumns = {
  memory_id:  schema.memories.memory_id,
  task_id:    schema.memories.task_id,
  team_id:    schema.memories.team_id,
  goal:       schema.memories.goal,
  outcome:    schema.memories.outcome,
  score:      schema.memories.score,
  created_at: schema.memories.created_at,
} as const;

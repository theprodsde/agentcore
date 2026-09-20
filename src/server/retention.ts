/**
 * Data-retention loop.
 *
 * Checkpoints persist full raw tool output (log lines, alert payloads), so an
 * unbounded table is both a disk problem and a data-retention liability.
 *
 *   RETENTION_DAYS        — purge tasks (and their checkpoints, via FK cascade)
 *                           older than N days. 0/unset = keep forever.
 *   MEMORY_RETENTION_DAYS — separately purge episodic memories. Defaults to
 *                           keep-forever: memories are the learning store and
 *                           already time-decay in retrieval weight.
 *
 * Deletes run in batches of 1000 so a large backlog never holds a long
 * table lock during live traffic.
 */
import { sql } from "drizzle-orm";
import { db } from "./db/index.js";
import { logger } from "./logger.js";

const BATCH_SIZE = 1000;
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

async function purgeBatched(table: "tasks" | "memories", idColumn: string, cutoff: Date): Promise<number> {
  let total = 0;
  for (;;) {
    const result = await db.execute(sql`
      DELETE FROM ${sql.identifier(table)}
      WHERE ${sql.identifier(idColumn)} IN (
        SELECT ${sql.identifier(idColumn)} FROM ${sql.identifier(table)}
        WHERE created_at < ${cutoff}
        LIMIT ${BATCH_SIZE}
      )`);
    const deleted = (result as unknown as { count?: number }).count ?? 0;
    total += deleted;
    if (deleted < BATCH_SIZE) return total;
  }
}

export async function runRetentionSweep(): Promise<void> {
  const taskDays   = Number(process.env.RETENTION_DAYS ?? 0);
  const memoryDays = Number(process.env.MEMORY_RETENTION_DAYS ?? 0);
  const dayMs = 24 * 60 * 60 * 1000;

  if (taskDays > 0) {
    const deleted = await purgeBatched("tasks", "task_id", new Date(Date.now() - taskDays * dayMs));
    if (deleted > 0) logger.info({ deleted, retention_days: taskDays }, "Retention: purged old tasks (+checkpoints via cascade)");
  }
  if (memoryDays > 0) {
    const deleted = await purgeBatched("memories", "memory_id", new Date(Date.now() - memoryDays * dayMs));
    if (deleted > 0) logger.info({ deleted, retention_days: memoryDays }, "Retention: purged old memories");
  }
}

/** Starts the periodic sweep. No-op scheduling cost when retention is disabled. */
export function startRetentionLoop(): void {
  const enabled = Number(process.env.RETENTION_DAYS ?? 0) > 0 || Number(process.env.MEMORY_RETENTION_DAYS ?? 0) > 0;
  if (!enabled) return;

  runRetentionSweep().catch((err) => logger.error({ err }, "Retention sweep failed"));
  setInterval(
    () => runRetentionSweep().catch((err) => logger.error({ err }, "Retention sweep failed")),
    SWEEP_INTERVAL_MS
  ).unref();
}

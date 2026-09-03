import { pgTable, uuid, text, integer, real, boolean, timestamp, jsonb, pgEnum, vector, index } from "drizzle-orm/pg-core";

export const taskStatusEnum = pgEnum("task_status", ["pending", "running", "failed", "completed"]);
export const stepStatusEnum = pgEnum("step_status", ["pending", "running", "success", "failed"]);

// ─── Teams (Phase 5) ──────────────────────────────────────────────────────────

export const teams = pgTable("teams", {
  team_id:    uuid("team_id").primaryKey().defaultRandom(),
  name:       text("name").notNull(),
  slug:       text("slug").notNull().unique(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const apiKeys = pgTable("api_keys", {
  id:           uuid("id").primaryKey().defaultRandom(),
  team_id:      uuid("team_id").notNull().references(() => teams.team_id, { onDelete: "cascade" }),
  key_hash:     text("key_hash").notNull().unique(),
  description:  text("description"),
  last_used_at: timestamp("last_used_at", { withTimezone: true }),
  created_at:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Core tables ──────────────────────────────────────────────────────────────

export const tasks = pgTable("tasks", {
  task_id:        uuid("task_id").primaryKey().defaultRandom(),
  team_id:        uuid("team_id").references(() => teams.team_id, { onDelete: "cascade" }),
  goal:           text("goal").notNull(),
  context:        text("context").notNull().default(""),
  task_type:      text("task_type").notNull().default("incident"),
  user_id:        text("user_id").notNull().default("anon"),
  status:         taskStatusEnum("status").notNull().default("pending"),
  current_step:   jsonb("current_step"),
  resume_count:   integer("resume_count").notNull().default(0),
  final_output:   text("final_output"),
  error:          text("error"),
  trace_id:       text("trace_id").notNull(),
  inject_failure: boolean("inject_failure").notNull().default(false),
  created_at:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const checkpoints = pgTable("checkpoints", {
  id:          uuid("id").primaryKey().defaultRandom(),
  task_id:     uuid("task_id").notNull().references(() => tasks.task_id, { onDelete: "cascade" }),
  step_number: integer("step_number").notNull(),
  step_name:   text("step_name").notNull(),
  step_status: stepStatusEnum("step_status").notNull(),
  duration_ms: integer("duration_ms").notNull().default(0),
  input_data:  jsonb("input_data"),
  output_data: jsonb("output_data"),
  error_info:  text("error_info"),
  created_at:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memories = pgTable("memories", {
  memory_id:  uuid("memory_id").primaryKey().defaultRandom(),
  task_id:    uuid("task_id").notNull(),
  team_id:    uuid("team_id").references(() => teams.team_id, { onDelete: "cascade" }),
  goal:       text("goal").notNull(),
  outcome:    text("outcome").notNull(),
  score:      real("score").notNull().default(0),
  embedding:  vector("embedding", { dimensions: 1536 }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("memories_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
]);

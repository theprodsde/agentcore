ALTER TABLE "tasks" ADD COLUMN "dry_run" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "correlated_task_id" uuid;
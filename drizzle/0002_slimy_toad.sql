CREATE INDEX "idx_checkpoints_task_id_status" ON "checkpoints" USING btree ("task_id","step_status");--> statement-breakpoint
CREATE INDEX "idx_checkpoints_success" ON "checkpoints" USING btree ("step_name","duration_ms") WHERE step_status = 'success';--> statement-breakpoint
CREATE INDEX "idx_memories_team_id_created_at" ON "memories" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_tasks_team_id" ON "tasks" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "idx_tasks_created_at_status" ON "tasks" USING btree ("created_at","status");
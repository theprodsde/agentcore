# Development Plan

This document breaks the path from the current MVP to a production-grade platform into concrete phases. Each phase ships independently and builds directly on the previous one.

---

## Phase 1 — Durable persistence (foundation for everything else)

**Goal:** tasks and checkpoints survive process restarts. Nothing else is production-ready until this is done.

**Work:**
- Add Postgres via Drizzle ORM. Schema: `tasks`, `checkpoints`, `memories` tables map 1:1 to the existing TypeScript interfaces in [src/server/db.ts](src/server/db.ts).
- Replace all `inMemoryDB.tasks.get/set` calls in [server.ts](server.ts) and [src/server/executor.ts](src/server/executor.ts) with `await db.query(...)`.
- On server boot, query `SELECT * FROM tasks WHERE status IN ('running', 'failed')` and re-enqueue each one — this is the crash-recovery path.
- Add Redis (via `ioredis`) as the task queue so tasks survive a Node restart mid-flight. The executor pulls from the queue; the API pushes to it.
- Update `docker-compose.yml` to include Postgres and Redis services.

**Done when:** kill the Node process mid-task, restart it, the task resumes from the last successful checkpoint.

---

## Phase 2 — Real MCP tool layer

**Goal:** replace the hardcoded `tool_search_logs` / `tool_get_metrics` stubs with actual calls to real infrastructure.

**Work:**
- Implement a proper MCP server binary in `tools/` using `@modelcontextprotocol/sdk` server-side. Start with two tools: `search_logs` (queries a log aggregator — Loki, Elasticsearch, or CloudWatch via env config) and `get_metrics` (queries Prometheus/Datadog/CloudWatch metrics).
- Connect [src/server/mcp.ts](src/server/mcp.ts) to the tool server via `stdio` transport (same process, subprocess) or HTTP SSE (remote).
- The planner's `tools_selected` output already drives which tools get called — no orchestrator changes needed.
- Add a `tools/README.md` documenting how to add a new tool.

**Done when:** a real incident goal ("database latency spike on payments-service") calls `search_logs` against a real log backend and returns actual log lines.

---

## Phase 3 — Semantic memory with vector search

**Goal:** memory retrieval that actually finds semantically similar past incidents, not just the two most recent ones.

**Work:**
- Add `pgvector` extension to Postgres. Add an `embedding` column to the `memories` table.
- On memory write (after task completion), generate an embedding for `goal + outcome` using `text-embedding-3-small` and store it.
- On memory retrieval (step 1 of the orchestrator), run a cosine similarity query: `SELECT * FROM memories ORDER BY embedding <=> $1 LIMIT 5`.
- Replace the word-frequency fallback in [server.ts](server.ts) `/api/memory/query` with the same vector query.

**Done when:** submitting "OOM on auth-service" retrieves a past "memory leak in auth pod" incident rather than an unrelated one.

---

## Phase 4 — Observability

**Goal:** every task run produces a structured trace exportable to any OTEL-compatible backend.

**Work:**
- Instrument [src/server/executor.ts](src/server/executor.ts) with OpenTelemetry. Each `executeStep` call becomes a span child of a root `task` span. Attributes: `task_id`, `step_number`, `step_name`, `duration_ms`, `status`.
- Add a `OTEL_EXPORTER_OTLP_ENDPOINT` env var; default to a local Jaeger instance in `docker-compose.yml`.
- Add a `/api/health/detailed` endpoint that reports DB connection status, Redis connection, and LLM reachability.
- Add structured log correlation: tag every Pino log line with `trace_id` and `task_id` so logs and traces are joinable.

**Done when:** opening Jaeger after running a task shows a complete waterfall — memory retrieval, planning, tool execution, synthesis — with per-step timings.

---

## Phase 5 — Auth and multi-tenancy

**Goal:** the API is safe to expose publicly; tasks are isolated per user/team.

**Work:**
- Add JWT middleware (using `jose`) on all `/api/*` routes except `/api/health` and `/api/slack/events`.
- Add a `teams` table. Tasks, checkpoints, and memories are scoped by `team_id`. All DB queries filter by the authenticated team.
- Slack events are mapped to a team via the workspace ID stored in a `slack_workspaces` table.
- Add a minimal `POST /api/auth/token` endpoint (API key → JWT) so tools and scripts can authenticate without a browser.

**Done when:** two separate API keys cannot see each other's tasks.

---

## Phase 6 — Dynamic planning

**Goal:** the planner selects tools from a live tool registry rather than a fixed two-tool list.

**Work:**
- On startup, the MCP client enumerates available tools (`listTools()`). Store the manifest in memory.
- Pass the tool manifest to the LLM planner prompt: "Available tools: [list]. Select the ones relevant to this goal."
- The synthesizer step receives the raw tool outputs and builds its report from them — no more hardcoded `probable_cause` strings.
- Add a `GET /api/tools` endpoint that returns the live tool manifest (useful for debugging and the dashboard).

**Done when:** adding a new MCP tool is reflected in the planner's decisions without any code changes to the orchestrator.

---

## Quick wins (can be done any time, parallel to the above)

- Add a `.github/ISSUE_TEMPLATE/` with bug report and feature request templates
- Add `eslint` + `prettier` to the CI pipeline
- Add Vitest for unit tests on the executor state machine (especially the resume logic)
- Add a `CONTRIBUTING.md` with branch naming, PR process, and how to run the stack locally
- Pin Node version in `.nvmrc` / `.node-version`
- Add `husky` + `lint-staged` for pre-commit type checking

---

## Success criteria for v1.0

- [ ] Tasks survive crashes and resume correctly (Phase 1)
- [ ] At least two real MCP tools connected to real infra (Phase 2)
- [ ] Semantic memory retrieval with vector search (Phase 3)
- [ ] Full OTEL trace per task (Phase 4)
- [ ] JWT auth, team isolation (Phase 5)
- [ ] CI green on every PR (already done)
- [ ] Docker Compose single-command full-stack boot with Postgres + Redis + app

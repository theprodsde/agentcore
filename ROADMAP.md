# Roadmap

## Done

**Platform foundation**
- Environment and config with Zod validation
- Structured logging via Pino with OTel trace correlation
- Postgres via Drizzle ORM (replaced in-memory stores)
- DB connection pool with idle/connect timeouts
- Graceful shutdown (SIGTERM → flush OTel → drain pool → close MCP subprocess)

**Orchestration core**
- 4-step pipeline: memory retrieval → planning → MCP tool execution → synthesis
- Per-step checkpointing with resume from last failed step
- Crash recovery on boot (`recoverStaleTasks` bulk UPDATE)
- OpenAI-compatible LLM client (planner + synthesizer)
- MCP client — spawns local tools server via stdio or connects via SSE
- 0/1 Knapsack DP for optimal tool selection within a time budget
- Parallel tool execution via `Promise.all`

**Task lifecycle**
- Task creation, listing (paginated), detail, and checkpoint APIs
- Incident deduplication (Jaccard + bounded Levenshtein + LCS similarity)
- Dry-run mode (full pipeline, skips side effects)
- Live step-by-step status stream (SSE with 10-min auto-close)
- Manual resume API for failed tasks
- Post-mortem Markdown export (`/api/tasks/:id/export.md`)

**Memory system**
- Episodic memory write with outcome-based scoring
- pgvector cosine similarity retrieval with time-decay re-ranking
- Semantic memory query API (`<=>` operator)
- LRU embed cache (doubly-linked list + HashMap, 256-entry cap)

**MCP tool layer**
- `search_logs` → Loki backend or contextual simulation
- `get_metrics` → Prometheus backend or contextual simulation
- `search_runbook` → runbook API or keyword-based simulation
- `create_ticket` → Linear API or simulation
- `list_services` → simulation with realistic degraded/healthy mix
- Zod validation on all tool args; TOOL_REGISTRY map pattern
- Tool manifest cached for process lifetime

**Auth + multi-tenancy**
- HS256 JWT via `jose` — 24-hour TTL
- Teams and API key table (SHA-256 hashed keys)
- Per-team task, memory, and metric isolation
- Auth no-op when `JWT_SECRET` unset (dev mode)

**Webhook ingestion**
- PagerDuty `incident.trigger` → task (HMAC-SHA256 verified)
- OpsGenie `Create` → task (HMAC verified)
- Prometheus Alertmanager firing alerts → tasks (shared-secret header)

**Integrations**
- Slack `!incident <description>` trigger → full pipeline → thread reply
- Webhook ingestion from PagerDuty, OpsGenie, Alertmanager

**Observability**
- OpenTelemetry — every task is a root span, every step a child span
- Pino `mixin()` injects `trace_id`/`span_id` on every log line
- Jaeger in `docker-compose.yml` (OTLP port 4318)
- Detailed health endpoint (parallel DB + MCP checks)

**Frontend**
- React SPA (React Router, Tailwind CSS)
- Dashboard with smart polling (stops when all tasks terminal)
- Task detail — incident report (structured cards, not raw JSON), checkpoint timeline
- Memory Explorer with functional search (`useMemo` filtering)
- Metrics dashboard — KPI cards, weekly bar chart, step p95 breakdown
- Demo scenarios with error display and `useCallback`
- React Error Boundary on all routes
- SSE stream in TaskDetail (replaces 2s polling)

**CLI**
- `node scripts/run.mjs "<goal>"` — live checkpoint streaming, structured output, 0/1 exit codes

**Testing**
- 127 unit tests (5 files) — algorithms, auth, executor, tools, utils
- CI: typecheck → test → build → Docker (Node 24)

**5 DB indexes**
- `idx_checkpoints_task_id_status` — covers all checkpoint lookups
- `idx_checkpoints_success` — partial index for metrics p95 queries
- `idx_tasks_team_id` — multi-tenant task list
- `idx_tasks_created_at_status` — dedup window query
- `idx_memories_team_id_created_at` — paginated memory retrieval

---

## Up next

- [ ] `eslint` + `prettier` added to CI
- [x] `CONTRIBUTING.md` with dev setup and tool-integration guide
- [ ] Redis for the task queue (multi-instance deployments)
- [ ] Configurable embedding dimensions (unblocks fully-local Ollama embeddings; currently fixed at 1536)
- [ ] More tool backends via community: Elasticsearch logs, GitHub Issues tickets, Grafana annotations, Datadog metrics (see `good first issue` label)
- [ ] Rate limiting on task-creating endpoints (LLM spend protection)
- [ ] Slack app-home tab showing tasks inline
- [ ] Runbook auto-import from Confluence / Notion at startup
- [ ] pgvector-based dedup (replace JS Jaccard+edit with a single DB query)

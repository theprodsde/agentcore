# Development Plan

All six planned phases are **complete**. This document records what was built in each phase and what the next meaningful work would be.

---

## Phase 1 — Durable persistence ✅

Postgres via Drizzle ORM. Schema: `tasks`, `checkpoints`, `memories`, `teams`, `api_keys`. On server boot, `recoverStaleTasks()` bulk-resets any tasks left in `running`/`pending` and re-enqueues them. Tasks survive crashes and resume from the last successful checkpoint.

**Delivered:** `src/server/db/` (schema + connection), Drizzle migrations, `docker-compose.yml` with pgvector image.

---

## Phase 2 — Real MCP tool layer ✅

Standalone MCP server in `tools/server.ts` spawned via stdio. Five tools with real backend support:

| Tool | Real backend |
|---|---|
| `search_logs` | `LOKI_URL` |
| `get_metrics` | `PROMETHEUS_URL` |
| `search_runbook` | `RUNBOOK_URL` |
| `create_ticket` | `LINEAR_API_KEY` + `LINEAR_TEAM_ID` |
| `list_services` | simulation only |

Each tool validates args with Zod and falls back to deterministic simulation when no env var is set. Tool manifest is cached for process lifetime. `GET /api/tools` exposes it.

---

## Phase 3 — Semantic memory with vector search ✅

`memories.embedding` column (`vector(1536)`) with HNSW index. Memory write generates an embedding via `text-embedding-3-small`. Memory retrieval fetches top 20 by cosine similarity, then re-ranks with time-decay weighting (`score × exp(−age/180days)`) using a top-k min-heap. `POST /api/memory/query` uses the `<=>` operator for semantic search.

---

## Phase 4 — Observability ✅

Every task run is a root OTel span. Each `executeStep` is a child span with `task.id`, `step.number`, `step.name`, `step.duration_ms`, `step.status`. Pino's `mixin()` injects `trace_id`/`span_id` from the active span into every log line. `OTEL_EXPORTER_OTLP_ENDPOINT` exports to Jaeger (included in `docker-compose.yml`). `GET /api/health/detailed` runs DB and MCP checks in parallel.

---

## Phase 5 — Auth and multi-tenancy ✅

HS256 JWT via `jose`. `POST /api/teams` creates a team + initial API key. `POST /api/auth/token` exchanges a key for a JWT (24h TTL). All routes downstream of `app.use("/api", authMiddleware)` require a valid token. Tasks, memories, and metrics are filtered by `team_id`. Auth is a no-op when `JWT_SECRET` is unset.

Webhook ingestion adds PagerDuty, OpsGenie, and Alertmanager endpoints — all HMAC-verified via `crypto.timingSafeEqual`.

---

## Phase 6 — Dynamic planning ✅

LLM planner receives the live tool manifest (built once, cached). Outputs `tool_calls` with per-tool args (not a fixed two-tool list). Tools run in parallel via `Promise.all`. 0/1 Knapsack DP prunes the tool set to fit within `TOOL_BUDGET_MS` using historical avg duration from the checkpoints table. Adding a new tool to `TOOL_REGISTRY` in `tools/server.ts` is sufficient — no orchestrator changes needed.

---

## Also shipped (beyond the 6 phases)

- **Incident deduplication** — Jaccard + bounded Levenshtein DP + LCS hybrid similarity; request-scoped pair memo; 10-minute window
- **Dry-run mode** — full pipeline, skips memory write and ticket creation
- **Post-mortem export** — `GET /api/tasks/:id/export.md`
- **Metrics dashboard** — `/metrics` page + `/api/metrics` endpoint (60s TTL cache)
- **CLI** — `node scripts/run.mjs "<goal>"` with live checkpoint streaming
- **LRU caches** — doubly-linked list + HashMap for tool results and embeddings
- **React Error Boundary** — `src/components/ErrorBoundary.tsx` wraps all routes
- **Graceful shutdown** — SIGTERM → flush OTel → drain DB pool → close MCP subprocess
- **5 DB indexes** — checkpoints FK, tasks team_id, tasks created_at/status, memories team_id
- **127 unit tests** — algorithms (Knapsack, LCS, bounded Levenshtein, LRU), auth, executor, tools, utils

---

## Quick wins status

| Item | Status |
|---|---|
| `.github/ISSUE_TEMPLATE/` bug + feature templates | ✅ |
| `.node-version` (pins Node 24) | ✅ |
| Vitest unit tests | ✅ |
| CI pipeline (typecheck → test → build → docker) | ✅ |
| `eslint` + `prettier` | ❌ not yet |
| `husky` + `lint-staged` pre-commit hooks | ❌ not yet |
| `CONTRIBUTING.md` | ❌ not yet |

---

## What would make v1.0

All the below are incremental — the core platform is production-ready today.

- [ ] `eslint` + `prettier` in CI
- [ ] `CONTRIBUTING.md` with branch naming and PR guide
- [ ] Real pgvector-based similarity in the dedup path (currently JS-based Jaccard+edit)
- [ ] Redis for the task queue (currently `setImmediate` — works for single-node; add Redis for multi-instance)
- [ ] Slack app-home tab showing the task dashboard inline
- [ ] Runbook auto-import from Confluence/Notion on startup

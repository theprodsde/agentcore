# Changelog

All notable changes to AgentCore are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-09-20

First tagged release.

### Added
- 4-step checkpointed pipeline: memory retrieval → LLM planner → MCP tool execution → synthesizer, with resume-from-failed-step.
- pgvector episodic memory with time-decay re-ranking; every completed investigation is written back as an embedding.
- Built-in MCP tool server: `search_logs` (Loki), `get_metrics` (Prometheus), `search_runbook`, `create_ticket` (Linear), `list_services` — all with deterministic simulation fallbacks so the stack runs with zero credentials.
- **AgentCore MCP server** (`dist/tools/agentcore-mcp.cjs`): expose a running AgentCore instance to Claude Code, Claude Desktop, Cursor, or any MCP client — `investigate_incident`, `get_investigation`, `search_incident_memory`, `export_postmortem`.
- Slack ingestion (`!incident ...`) with v0 request-signature verification, replay protection, and event-ID dedup.
- Webhook ingestion for PagerDuty, OpsGenie, and Alertmanager with raw-body HMAC verification.
- JWT auth + per-team isolation for tasks, checkpoints, memories, dedup, and SSE streams.
- Incident deduplication (Jaccard + bounded Levenshtein + LCS) within a 10-minute window.
- OpenTelemetry tracing, Pino structured logs with trace correlation, `/api/metrics` 30-day summary.
- Post-mortem Markdown export, dry-run mode, CLI runner, metrics dashboard.
- Docker image with built-in migrations (drizzle-orm migrator, no registry access needed at startup), healthcheck, and graceful shutdown. Migrations self-bootstrap the pgvector extension.
- `docker-compose.demo.yml`: try AgentCore with two commands and no clone/build/.env — pulls the GHCR image, runs pgvector alongside, simulation mode by default, `OPENAI_API_KEY` passthrough for real LLM runs.

- Dashboard login screen: when JWT auth is enabled the UI exchanges a team API key for a session token; live task streaming uses fetch-based SSE so it authenticates correctly.
- API key lifecycle: list and revoke keys (`GET`/`DELETE /api/teams/:id/api-keys`), with last-key lockout protection; `DISABLE_TEAM_SIGNUP` to close open registration.
- Built-in token-bucket rate limiting on all task-creating paths (`RATE_LIMIT_RPM`).
- Data retention sweeps (`RETENTION_DAYS`, `MEMORY_RETENTION_DAYS`) with batched deletes.
- `DEFAULT_TEAM_ID` assigns Slack/webhook-created tasks to a team.
- Integration test suite proving checkpoint/resume against real Postgres (steps already checkpointed are not re-run on resume), wired into CI with a pgvector service container.
- `ARCHITECTURE.md`: system map, extension points (tools, pipeline steps, alert sources, routes, MCP), scaling seams for planned features, and hard invariants.

### Changed
- The orchestrator pipeline is now a declarative step array — adding a step is one `PIPELINE` entry; checkpointing, resume, tracing, and SSE are inherited automatically.
- List endpoints return summary columns only: memory responses no longer ship ~6 KB embedding vectors per row, task lists no longer ship `final_output`/`context` blobs; memory retrieval inside the executor also stops fetching vectors. Checkpoint timelines are now deterministically ordered.

### Security
- Request-body validation with hard size limits on every task-creating entry point (API, Slack, webhooks) — unbounded goal/context was a token-cost vector.
- Atomic incident dedup: similarity check + insert run in one transaction under a Postgres advisory lock, so concurrent identical alerts cannot create twin investigations.
- Per-tool-call hard timeout (`TOOL_CALL_TIMEOUT_MS`) and LLM call timeout (`LLM_TIMEOUT_MS`); side-effect tools are never cached and are skipped on dry runs.
- Timing-safe secret comparison on all webhook verifications.
- Health probes are public; every other API route requires a JWT when `JWT_SECRET` is set.
- Documented prompt-injection surface and its design bounds in SECURITY.md.

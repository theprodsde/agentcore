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
- Docker image with built-in migrations (drizzle-orm migrator, no registry access needed at startup), healthcheck, and graceful shutdown.

### Security
- Per-tool-call hard timeout (`TOOL_CALL_TIMEOUT_MS`); side-effect tools are never cached and are skipped on dry runs.
- Timing-safe secret comparison on all webhook verifications.
- Health probes are public; every other API route requires a JWT when `JWT_SECRET` is set.

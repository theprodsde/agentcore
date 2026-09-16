# Production Deployment Guide

AgentCore is production-ready. This document covers what's wired up, what requires your credentials, and how to operate it in a real environment.

---

## What's already wired up

All of the following work as-is — you only need to provide credentials via environment variables:

| Component | Status | What to provide |
|---|---|---|
| Postgres persistence | ✅ Ready | `DATABASE_URL` |
| pgvector semantic memory | ✅ Ready | `DATABASE_URL` (pgvector extension required) |
| LLM planner + synthesizer | ✅ Ready | `OPENAI_API_KEY` |
| Embeddings | ✅ Ready | `OPENAI_API_KEY` |
| MCP tools | ✅ Ready | Tool-specific env vars (optional — all fall back to simulation) |
| Slack integration | ✅ Ready | `SLACK_BOT_TOKEN` + `SLACK_SIGNING_SECRET` |
| JWT auth | ✅ Ready | `JWT_SECRET` |
| OTel tracing | ✅ Ready | `OTEL_EXPORTER_OTLP_ENDPOINT` |
| Webhook ingestion | ✅ Ready | Signing secrets (optional — skipped if unset) |
| Graceful shutdown | ✅ Ready | Nothing |

---

## Recommended single-command start

```bash
cp .env.example .env   # fill in DATABASE_URL + OPENAI_API_KEY + JWT_SECRET
docker-compose up --build
```

This boots pgvector Postgres, Jaeger, and the app. The app runs `drizzle-kit push` before starting and then calls `recoverStaleTasks()` to resume any in-flight tasks from a previous run.

---

## Connecting real tool backends

### Loki (log search)
```
LOKI_URL=http://loki.your-infra.internal:3100
```
The `search_logs` tool issues `{service="<name>"} |~ "<query>"` LogQL queries.

### Prometheus (metrics)
```
PROMETHEUS_URL=http://prometheus.your-infra.internal:9090
```
The `get_metrics` tool issues `<metric>{service="<name>"}` range queries.

### Runbook search
```
RUNBOOK_URL=https://your-confluence-or-wiki-search-endpoint
```
The `search_runbook` tool calls `GET /search?q=<query>&service=<service>`. Expected response: `{ results: [{ title, url, excerpt }] }`.

### Linear (ticket creation)
```
LINEAR_API_KEY=lin_api_...
LINEAR_TEAM_ID=<your-team-uuid>
```
The `create_ticket` tool calls the Linear GraphQL `issueCreate` mutation.

---

## Webhook ingestion (auto-trigger from alerting)

When signatures are not configured, webhooks are accepted from anyone — configure at minimum one secret in production:

```
PAGERDUTY_WEBHOOK_SECRET=<your-pd-webhook-secret>
OPSGENIE_WEBHOOK_SECRET=<your-opsgenie-secret>
ALERTMANAGER_SECRET=<your-shared-header-value>
```

Point your alert source at:
- PagerDuty: `POST /api/webhooks/pagerduty`
- OpsGenie: `POST /api/webhooks/opsgenie`
- Alertmanager: `POST /api/webhooks/alertmanager`

---

## Scaling considerations

**Single-node (current):** the orchestrator uses `setImmediate` to enqueue tasks in-process. Works correctly for low-to-medium volume.

**Multi-node:** replace `setImmediate(() => runTaskOrchestrator(...))` with a Redis queue (`ioredis` + BullMQ). The orchestrator logic is unchanged — only the dispatch mechanism changes. `DATABASE_URL` is already shared across instances.

**Connection pool:** tuned to `max: 20, idle_timeout: 30s, connect_timeout: 10s`. Adjust `max` to match your Postgres `max_connections`.

---

## Operations

### Migrations
```bash
npm run db:migrate    # apply versioned migrations (safe to run on startup)
npm run db:generate   # generate a new migration after schema changes
```

The Docker `CMD` runs `drizzle-kit push` (for simplicity in single-node setups). For production, switch to `drizzle-kit migrate` for reproducible, auditable migrations.

### Health checks
```
GET /api/health            → {"status":"ok"}            liveness probe
GET /api/health/detailed   → {"status":"ok","checks":…}  readiness probe (DB + MCP + LLM + OTel)
```

### Metrics
```
GET /api/metrics   → 30-day summary, step p95, 8-week weekly trend (cached 60s)
```

### CLI (for scripted runbooks or CI incident drills)
```bash
AGENTCORE_URL=https://your-deployment AGENTCORE_TOKEN=eyJ... \
  node scripts/run.mjs "payments-service p99 at 4s" --context "started after deploy v2.3"
```

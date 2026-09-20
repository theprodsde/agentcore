# Production Deployment Guide

This document covers what's wired up, what requires your credentials, how to operate AgentCore in a real environment — and, just as importantly, the known limits you should design around.

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

This boots pgvector Postgres, Jaeger, and the app. On startup the app applies versioned migrations (`node scripts/migrate.mjs`, using drizzle-orm's bundled migrator — no drizzle-kit or registry access needed in the image) and then calls `recoverStaleTasks()` to resume tasks that were in flight during the previous 24 hours.

---

## Security checklist before going live

| Setting | Why |
|---|---|
| `JWT_SECRET` | Without it, **every API endpoint is open** — anyone can read tasks, memories, and create investigations |
| `SLACK_SIGNING_SECRET` | Without it, anyone who discovers the URL can forge Slack events and trigger LLM-backed investigations (token cost + data exposure) |
| Webhook secrets (`PAGERDUTY_WEBHOOK_SECRET`, `OPSGENIE_WEBHOOK_SECRET`, `ALERTMANAGER_SECRET`) | Webhook endpoints are public by design; unsigned = anyone can create tasks |
| Reverse proxy with TLS + rate limiting | AgentCore does not terminate TLS or rate-limit; put nginx/Caddy/an ALB in front |

Signature verification is performed against the **raw request bytes** (captured before JSON parsing), with timing-safe comparison and, for Slack, a 5-minute replay window.

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

**Tool execution limits:** each MCP tool call is capped by `TOOL_CALL_TIMEOUT_MS` (default 10s) so a hung backend cannot stall a step; the knapsack pruner keeps total estimated tool time under `TOOL_BUDGET_MS`.

---

## Known limitations (design around these)

- **Single-process task queue.** Tasks run in-process via `setImmediate`. If the process dies mid-task, checkpoints preserve progress and `recoverStaleTasks()` resumes on restart — but running two app replicas will double-process recovered tasks. Run one replica, or swap dispatch for BullMQ before scaling out.
- **SSE task streams are per-process.** With multiple replicas behind a load balancer, a client may connect to a replica that isn't executing its task. Use sticky sessions or single-replica until a shared event bus exists.
- **No rate limiting or request quotas.** Every accepted task costs LLM tokens. Front with a rate limiter, and set spend limits on your OpenAI key.
- **Team creation (`POST /api/teams`) is open** so the first team can bootstrap itself. Restrict it at the proxy after initial setup.
- **Tool result cache and embedding cache are in-memory** — they reset on restart and are not shared across replicas.

---

## Operations

### Migrations
```bash
npm run db:migrate    # apply versioned migrations (safe to run on startup)
npm run db:generate   # generate a new migration after schema changes
```

The Docker `CMD` runs `node scripts/migrate.mjs`, which applies the versioned SQL files in `drizzle/` via drizzle-orm's migrator. It is idempotent — already-applied migrations are skipped.

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

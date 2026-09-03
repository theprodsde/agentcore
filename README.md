# AgentCore

[![CI](https://github.com/TheProdSDE/agentcore/actions/workflows/ci.yml/badge.svg)](https://github.com/TheProdSDE/agentcore/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-57%20passing-brightgreen?logo=vitest&logoColor=white)](https://github.com/TheProdSDE/agentcore/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-theprodsde-FFDD00?logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/theprodsde)
[![PayPal](https://img.shields.io/badge/PayPal-Donate-00457C?logo=paypal&logoColor=white)](https://www.paypal.com/paypalme/karangehlod)

An AI-powered incident response orchestrator. AgentCore runs a resilient 4-step pipeline — memory retrieval, LLM planning, MCP tool execution, and synthesis — with per-step checkpointing so tasks survive failures and resume exactly where they left off.

Trigger incidents from Slack or the web dashboard. Every run is traced, checkpointed, and written back into an episodic memory store so the planner learns from past incidents.

## Who is this for, and when should you use it

AgentCore closes the gap between **"alert fires"** and **"engineer understands what's happening and can act."** Today that gap means 15–40 minutes of manually jumping between Grafana dashboards, Kibana log searches, Slack threads, and runbooks — every single time.

### The problem it solves

When something breaks in production, an on-call engineer has to:
1. Find the right logs (which service, which time window, which query?)
2. Pull relevant metrics (what's the p99, what's the error rate, when did it spike?)
3. Cross-reference both to isolate the probable cause
4. Open a ticket, notify stakeholders, draft a post-mortem

This is repetitive investigation work. It follows the same pattern for 80% of incidents. AgentCore automates that first investigation loop so engineers can skip to step 4 — validating the AI's findings and acting.

### When to use it

**You'll get the most value if you have:**
- A production system with Slack as the ops communication channel
- More than one recurring incident type (DB locks, OOM crashes, latency regressions, cache misses)
- Engineers spending >30 min per incident just gathering context before they can act
- A small-to-mid-size team (3–50 engineers) without a dedicated SRE function

**Concrete scenarios where AgentCore helps:**

| Scenario | What AgentCore does |
|---|---|
| 3am on-call page for latency spike | Engineer types `!incident payments-service p99 at 4s`. AgentCore queries Prometheus for metrics, Loki for error logs, creates a Linear ticket, posts a structured analysis back to Slack in ~30 seconds |
| Recurring DB deadlock | Second time it fires, the memory retrieval step surfaces the previous incident's resolution ("terminated idle connections, increased pool size"). The planner incorporates that context — the engineer sees what worked last time immediately |
| Post-deploy regression | `!incident auth-service 401 errors spiking after deploy v2.3`. AgentCore correlates the deploy timestamp with the error rate spike, identifies which service version introduced the issue |
| New engineer on-call | AgentCore's checkpointed memory acts as institutional knowledge. A new engineer sees structured analysis instead of guessing which dashboards to check |
| Compliance audit | Every incident produces a full trace in Jaeger and a checkpoint record in Postgres — who ran what tool, when, what it returned. Exportable for audit logs |
| Multi-team org | Platform and security teams run separate AgentCore instances (or separate teams on one instance). Tasks and memories are isolated per team — no data leakage between teams |

### What AgentCore is NOT

- **Not a monitoring system.** It does not detect incidents — use PagerDuty, OpsGenie, or Alertmanager for that. AgentCore responds once an alert fires.
- **Not a replacement for Datadog or Grafana.** It queries your existing observability stack (Loki, Prometheus) via the MCP tool layer. You keep your dashboards.
- **Not a chatbot.** Every task runs a deterministic 4-step pipeline against real infrastructure data. The LLM plans and synthesizes; it does not answer free-form questions.
- **Not autonomous action.** AgentCore investigates and recommends. It does not restart pods, roll back deployments, or execute remediations on its own (though you can add those as MCP tools).

### What makes it different from a raw LLM query

The core difference is **state and learning**:

1. **Checkpointed** — If your server crashes mid-investigation, the task resumes from the last successful step. A raw LLM query just fails and loses all context.
2. **Memory** — After 50 incidents, AgentCore knows that "DB connection pool exhaustion on orders-service is usually fixed by bumping `max_connections` and restarting the proxy." A raw query starts from zero every time.
3. **Real tools, real data** — The synthesizer derives its conclusions from actual log entries and metric values, not from hallucinated descriptions. The planner selects tool arguments (service name, time range, metric type) based on the goal — not a hardcoded template.
4. **Audit trail** — OTel traces, Postgres checkpoints, Pino logs with `trace_id` correlation. Raw queries leave no trail.

### Organizational impact

| Team size | Expected outcome |
|---|---|
| 3–10 engineers | Eliminates the "everyone stops to help the on-call" pattern for routine incidents. One person + AgentCore handles initial triage |
| 10–50 engineers | Reduces mean time to understand (MTTU) from 20–40 min to 2–5 min for known incident classes. Frees senior engineers from repetitive triage |
| 50+ engineers, multiple teams | Multi-tenant deployment lets each team own their memory and tasks independently. Platform team can build shared tool servers that all teams consume |
| Post-incident compliance | Full checkpoint + trace record per incident satisfies audit requirements in finance, healthcare, and regulated industries |

## How it works

```
[Slack / Dashboard] → Task Created
        ↓
  1. Memory Retrieval   — pgvector cosine similarity against past incidents
  2. LLM Planner        — selects tools from live manifest with per-tool args
  3. MCP Tool Execution — search_logs, get_metrics, create_ticket, list_services
  4. Synthesizer        — derives report from actual tool output, writes to memory
        ↓
[Result posted to Slack thread / visible in Dashboard]
```

If any step fails, the task pauses. On resume, completed checkpoints are skipped — no redundant work, no re-running LLM calls.

## Features

| Feature | Detail |
|---|---|
| Checkpointed orchestration | Every step persists input/output to Postgres; resumes from last failed step |
| pgvector semantic memory | Memories embedded with `text-embedding-3-small` and retrieved by cosine similarity |
| Dynamic MCP tool selection | LLM planner receives live tool manifest and outputs per-tool args |
| Real tool backends | `search_logs` → Loki, `get_metrics` → Prometheus, `create_ticket` → Linear (all fall back gracefully) |
| OpenTelemetry tracing | Every step is a span; `trace_id`/`span_id` injected into every Pino log line |
| JWT auth + multi-tenancy | HS256 tokens, per-team task/memory isolation; auth is a no-op when `JWT_SECRET` unset |
| Slack integration | `!incident <description>` triggers a full pipeline run; result posted back to thread |
| Detailed health endpoint | `/api/health/detailed` checks DB latency, LLM config, MCP tools, OTel status |

## Quickstart

### Docker (recommended)

```bash
cp .env.example .env
# fill in OPENAI_API_KEY and optionally Slack/Linear credentials
docker-compose up --build
```

- App: `http://localhost:3000`
- Jaeger UI: `http://localhost:16686`

### Manual

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL + OPENAI_API_KEY
# Start Postgres with pgvector
docker run -d --name agentcore-pg -e POSTGRES_USER=agentcore \
  -e POSTGRES_PASSWORD=agentcore -e POSTGRES_DB=agentcore \
  -p 5432:5432 pgvector/pgvector:pg16
docker exec agentcore-pg psql -U agentcore -d agentcore -c "CREATE EXTENSION IF NOT EXISTS vector;"
npm run db:push
npm run dev
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string |
| `OPENAI_API_KEY` | For LLM steps | OpenAI-compatible key |
| `OPENAI_BASE_URL` | No | Override API base (local models, etc.) |
| `LLM_MODEL` | No | Model for planner + synthesizer (default: `gpt-4o-mini`) |
| `EMBEDDING_MODEL` | No | Embedding model (default: `text-embedding-3-small`) |
| `JWT_SECRET` | No | Enables JWT auth when set. Unset = auth disabled (dev mode) |
| `SLACK_BOT_TOKEN` | No | Enables real Slack message delivery |
| `SLACK_SIGNING_SECRET` | No | Slack event verification |
| `MCP_SERVER_URL` | No | External MCP server (SSE). Unset = spawns bundled tools server |
| `LOKI_URL` | No | Loki log backend for `search_logs` tool |
| `PROMETHEUS_URL` | No | Prometheus backend for `get_metrics` tool |
| `LINEAR_API_KEY` | No | Linear ticket creation for `create_ticket` tool |
| `LINEAR_TEAM_ID` | No | Linear team ID |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | OTLP endpoint for Jaeger/Grafana Tempo |
| `LOG_LEVEL` | No | Pino log level (default: `warn`) |

## Auth

When `JWT_SECRET` is unset, auth is disabled — all requests proceed. To enable:

```bash
# Create a team and get the first API key
curl -X POST http://localhost:3000/api/teams \
  -H "Content-Type: application/json" \
  -d '{"name":"Platform Engineering"}'

# Exchange key for JWT
curl -X POST http://localhost:3000/api/auth/token \
  -H "Content-Type: application/json" \
  -d '{"api_key":"agentcore_..."}'

# Use token
curl http://localhost:3000/api/tasks \
  -H "Authorization: Bearer eyJ..."
```

Tasks and memories are isolated per team. A token from team A cannot read team B's data.

## Project structure

```
server.ts               Express entry point — mounts routes, handles Slack, starts server
src/
  routes/               Route handlers (one file per domain)
    auth.ts             POST /api/teams, POST /api/auth/token, POST /api/teams/:id/api-keys
    health.ts           GET /api/health, GET /api/health/detailed
    tasks.ts            CRUD + SSE stream + resume
    memory.ts           Memory retrieval + pgvector semantic query
  server/
    executor.ts         Orchestrator + four step handlers (individually exported + testable)
    auth.ts             JWT middleware, token signing, API key hashing
    llm.ts              Shared OpenAI client singleton + model constants
    embeddings.ts       text-embedding-3-small wrapper with null fallback
    mcp.ts              MCP client — spawns tools/server.ts via stdio or connects via SSE
    telemetry.ts        OTel provider + tracer export
    logger.ts           Pino logger with trace_id/span_id mixin
    db/                 Drizzle schema + connection
  utils/
    index.ts            parseLLMJson, generateTraceId, toErrorMessage
tools/
  server.ts             MCP tool server — search_logs, get_metrics, create_ticket, list_services
  README.md             How to add tools and connect real backends
tests/
  unit/
    auth.test.ts        JWT, API key hashing, middleware
    executor.test.ts    deriveSynthesisFromOutput, planner/synthesizer output contracts
    tools.test.ts       parseRange, filter logic, metric simulation, output shapes
    utils.test.ts       parseLLMJson, generateTraceId, toErrorMessage
```

## Development commands

```bash
npm run dev          # Start dev server (tsx + Vite HMR)
npm run build        # Production build (Vite + esbuild)
npm run lint         # TypeScript type check
npm test             # Run test suite (Vitest)
npm run test:watch   # Watch mode
npm run test:coverage  # Coverage report
npm run db:push      # Push schema to DB (creates/alters tables)
npm run db:studio    # Open Drizzle Studio
```

## Adding a new MCP tool

See [tools/README.md](tools/README.md). Add the tool definition to `TOOL_REGISTRY` in `tools/server.ts` — no other files need to change. The LLM planner receives the updated manifest automatically on the next run.

## Production path

See [PRODUCTION.md](PRODUCTION.md) for how to swap each stub for a real integration. See [DEVELOPMENT.md](DEVELOPMENT.md) for the full phase roadmap.

## Contributing

Pull requests are welcome. Please read the [PR template](.github/PULL_REQUEST_TEMPLATE.md) before opening one — it's short. The checklist covers the basics: types clean, tests green, no secrets in the diff.

For bugs, use the [bug report](.github/ISSUE_TEMPLATE/bug_report.yml) template. For new tools or integrations, use the [feature request](.github/ISSUE_TEMPLATE/feature_request.yml) template.

For questions, usage help, or sharing how you've deployed AgentCore — use [Discussions](https://github.com/TheProdSDE/agentcore/discussions) rather than Issues.

## Support the project

AgentCore is open-source and free to use under Apache 2.0. If it's saving your team time on incidents, consider supporting continued development:

| Platform | Link |
|---|---|
| Buy Me a Coffee | [buymeacoffee.com/theprodsde](https://www.buymeacoffee.com/theprodsde) |
| PayPal | [paypal.me/karangehlod](https://www.paypal.com/paypalme/karangehlod) |

You can also click the **Sponsor** button at the top of this repo on GitHub.

## License

Apache 2.0 — see [LICENSE](LICENSE).

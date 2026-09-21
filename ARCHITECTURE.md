# Architecture & Extension Guide

How AgentCore is put together, where new features plug in, and which seams exist
for the changes we know are coming. Read this before adding anything non-trivial.

## System map

```
        Slack events        Webhooks (PagerDuty/OpsGenie/Alertmanager)      REST API / Dashboard / MCP clients
             │                          │                                              │
             └───── signature check ────┴──── clamp + rate limit + validation ─────────┘
                                                    │
                                            tasks table (Postgres)
                                                    │  setImmediate dispatch
                                                    ▼
                                        runTaskOrchestrator (executor.ts)
                                                    │
                              ┌──── PIPELINE: declarative step array ────┐
                              │  1 memory_retrieval  (pgvector + decay)  │
                              │  2 planner           (LLM → tool calls)  │
                              │  3 execution         (MCP tools)         │
                              │  4 synthesizer       (LLM → report)      │
                              └──── each step wrapped by executeStep ────┘
                                                    │
                    checkpoints table ◄── every step persists input/output
                    memories table    ◄── completed non-dry-run tasks
                    SSE events        ◄── taskEventEmitter per step
```

Everything a step does is recorded: `executeStep()` provides checkpointing,
resume-skip, OTel spans, SSE events, and failure capture. Step handlers stay
pure-ish functions; the wrapper owns the operational concerns.

## Extension points (in order of how often you'll want them)

### 1. New tool backend (most common)

One file: [tools/server.ts](tools/server.ts). Zod schema → tool definition →
handler (real backend behind an env var, deterministic simulation fallback) →
`TOOL_REGISTRY` entry. The planner picks it up from the live manifest; no other
code changes. Full walkthrough in [CONTRIBUTING.md](CONTRIBUTING.md).

### 2. New pipeline step

The pipeline is a declarative array in [src/server/executor.ts](src/server/executor.ts)
(`PIPELINE`). Append an entry:

```ts
{
  number: 5,
  name: "notify",
  input: (_task, ctx) => ({ report: ctx.synthesizer }),
  run: (task, ctx) => notifyHandler(ctx.synthesizer as SynthOutput, task),
}
```

Checkpointing, resume-skip, tracing, and SSE come for free. The contract
(documented on `PipelineStep`): output must be JSON-serializable, read earlier
outputs only from `ctx[<step name>]`, and respect `task.dry_run` for anything
with side effects. The integration suite (`npm run test:integration`) is the
safety net — it proves resume never re-runs completed steps.

### 3. New alert source

Copy the pattern in [src/routes/webhooks.ts](src/routes/webhooks.ts):
verify the signature **against `req.rawBody`** (never re-serialized JSON, and
always timing-safe), then normalize into `createTaskFromAlert(goal, context, source)`
— which already applies input clamps, the rate limiter, and `DEFAULT_TEAM_ID`.

### 4. New API route domain

One file per domain in `src/routes/`. Rules that are invariants, not suggestions:

- Wrap every async handler in `asyncHandler` ([src/server/http.ts](src/server/http.ts)) —
  Express 4 silently hangs requests on unhandled promise rejections.
- Anything reading tasks/memories filters by team (`IS NOT DISTINCT FROM ${teamId}`);
  anything loading a single task goes through the ownership check.
- Request bodies get a Zod schema in [src/server/validation.ts](src/server/validation.ts)
  with explicit size caps — unbounded strings that reach an LLM are a cost vector.
- List endpoints select summary columns; never ship `embedding` vectors or
  `final_output`/`context` blobs in lists (`memorySummaryColumns`, `taskSummaryColumns`).

### 5. New capability for MCP clients

[tools/agentcore-mcp.ts](tools/agentcore-mcp.ts) is a thin stdio wrapper over the
REST API. Add a Zod schema + tool definition + handler that calls `api(...)`.
Keep it stateless — auth and tenancy are the server's job.

## Scaling seams (designed-in, not yet needed)

These are the deliberate single points where the known future features land
without touching business logic:

| Future feature | Seam | What changes |
|---|---|---|
| Multi-replica task queue (BullMQ/Redis) | Every dispatch is `setImmediate(() => runTaskOrchestrator(id))` — grep finds all call sites | Replace with `queue.add(id)`; a worker calls the same orchestrator. `recoverStaleTasks` becomes the queue's retry policy |
| Cross-replica live updates | All SSE fan-out goes through `taskEventEmitter` | Swap the EventEmitter for Redis pub/sub behind the same emit/on interface |
| Shared caches | Tool results, embeddings, and rate-limit buckets all use `LRUTTLCache` ([src/server/cache.ts](src/server/cache.ts)) | Implement the same get/set/TTL surface over Redis |
| pgvector-based dedup | `dedupAndCreateTask()` in [src/routes/tasks.ts](src/routes/tasks.ts) is the only dedup entry point | Replace the similarity loop with one `<=>` query; the advisory lock and API contract stay |
| Configurable embedding dimensions | `vector("embedding", { dimensions: 1536 })` in schema + `EMBEDDING_MODEL` | Needs a migration + env for dims; retrieval code is dimension-agnostic |
| API key scopes / RBAC | JWT payload is minted in one place (`signToken`) and read in one place (`authMiddleware`) | Add claims to the payload; enforce per-route |

## Performance notes (why the code looks the way it does)

- **Top-k heap** (O(n log k)) for memory re-ranking; **0/1 knapsack DP** for tool
  selection under a time budget; **bounded Levenshtein + LCS + Jaccard** for dedup —
  all in [src/utils/algorithms.ts](src/utils/algorithms.ts), all pure and unit-tested.
- **O(1) everywhere on hot request paths**: LRU cache ops, token-bucket checks,
  checkpoint lookups via `Map`. Nothing on a request path scans unbounded data.
- Vectors never leave Postgres; similarity happens in pgvector (HNSW index),
  re-ranking happens on 20 summary rows.
- Tool calls run in parallel under a per-call timeout; identical concurrent
  incidents serialize on a Postgres advisory lock keyed by normalized goal.

## Quality gate: the golden-incident eval

Demo data is a **world model** ([tools/simulation.ts](tools/simulation.ts)): service
state determines log/metric output, never the caller's query. On every push CI runs
[evals/golden-incidents.json](evals/golden-incidents.json) through the full pipeline
(deterministic without an LLM key) and fails if a report misses the true cause or
fabricates a finding — including an anti-circularity case (alert claims the wrong
symptom) and false alarms on healthy services. `npm run eval` runs it against any
live instance; with an LLM key it benchmarks real planner/synthesizer quality.

## Invariants (PRs violating these get blocked)

1. Tenant isolation on every task/memory read.
2. Side-effect tools: in `SIDE_EFFECT_TOOLS`, never cached, skipped on dry runs.
3. Nothing executes after synthesis — the LLM's output is a report, not a command.
4. Every task-creating path goes through validation clamps + the rate limiter.
5. Signatures verify raw bytes, timing-safe.
6. A step's output is its checkpoint: JSON-serializable, replayable on resume.

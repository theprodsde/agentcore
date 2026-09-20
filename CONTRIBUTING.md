# Contributing to AgentCore

Thanks for considering a contribution. The fastest way to be useful here is to add
or improve an **MCP tool integration** — that's the layer the community grows through.

For anything bigger (a new pipeline step, alert source, or API domain), read
[ARCHITECTURE.md](ARCHITECTURE.md) first — it maps every extension point and the
invariants PRs must respect.

## Dev setup

```bash
npm install
cp .env.example .env          # DATABASE_URL is the only hard requirement
docker run -d --name agentcore-pg -e POSTGRES_USER=agentcore \
  -e POSTGRES_PASSWORD=agentcore -e POSTGRES_DB=agentcore \
  -p 5432:5432 pgvector/pgvector:pg16
npm run db:migrate            # creates the pgvector extension + applies migrations
npm run dev                   # http://localhost:3000
```

No `OPENAI_API_KEY`? Everything still runs — the planner and all tools fall back to
deterministic simulations, which is exactly what the test suite exercises.

## Before you open a PR

```bash
npm run lint      # tsc --noEmit — must be clean
npm test          # unit tests (vitest) — must be green
npm run build     # production bundles must compile
```

There's also an integration suite covering checkpoint/resume against real Postgres —
CI runs it automatically; locally it needs a pgvector database:

```bash
TEST_DATABASE_URL=postgres://agentcore:agentcore@localhost:5432/agentcore npm run test:integration
```

The [PR template](.github/PULL_REQUEST_TEMPLATE.md) checklist covers the same three
things plus "no secrets in the diff". Small, focused PRs review much faster than
big ones.

## Adding a new tool integration (most wanted!)

Tools live in [tools/server.ts](tools/server.ts). The pattern for every tool:

1. Define a Zod schema for the arguments.
2. Add the tool definition (name, description, JSON schema) to the `ListTools` handler.
3. Write the handler: **check for the real backend's env var first, fall back to a
   deterministic simulation** so the tool works in demo mode. See `searchLogs`
   (Loki) or `createTicket` (Linear) for the shape to copy.
4. Register it in `TOOL_REGISTRY`. No other files need to change — the LLM planner
   picks up the new manifest automatically.
5. Add unit tests for the pure parts (arg parsing, output shape) in
   [tests/unit/tools.test.ts](tests/unit/tools.test.ts).
6. Document the env vars in `README.md` and `PRODUCTION.md`.

Look for issues labeled **`good first issue`** and **`tool-integration`** for
requested backends (Elasticsearch, Grafana annotations, Jira, GitHub Issues,
Datadog, ...).

## Code conventions

- TypeScript, strict-ish; avoid `any`, prefer explicit types at module boundaries.
- Route handlers are wrapped in `asyncHandler` (see [src/server/http.ts](src/server/http.ts)) —
  Express 4 does not catch async rejections on its own.
- Anything that touches tasks or memories must respect `team_id` scoping — tenant
  isolation is a hard invariant, and PRs that leak across teams will be blocked.
- Tools with external side effects belong in `SIDE_EFFECT_TOOLS`
  ([src/server/executor.ts](src/server/executor.ts)) so they're never cached and are
  skipped on dry runs.

## Questions and ideas

Use [Discussions](https://github.com/theprodsde/agentcore/discussions) for questions
and "how are you deploying this"; Issues for bugs and concrete feature requests.

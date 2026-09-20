# Good-first-issue drafts

Ready-to-post issues for the tool-integration contribution surface. Post them after
`gh auth login` with the commands at the bottom, or paste manually. Create the labels
first (one-time):

```bash
gh label create "good first issue" --color 7057ff --description "Good for newcomers" 2>/dev/null
gh label create "tool-integration" --color 0e8a16 --description "New MCP tool backend"
```

---

## Issue 1

**Title:** Tool integration: Elasticsearch/Kibana backend for `search_logs`

**Body:**

`search_logs` currently supports Loki (`LOKI_URL`) with a simulation fallback. A lot of
teams run ELK instead.

**What to build**
- In `tools/server.ts`, extend `searchLogs` to check `ELASTICSEARCH_URL` (and optional
  `ELASTICSEARCH_API_KEY`) before the Loki branch.
- Query the `_search` API filtered by `service` and free-text `query` over the
  `time_range`, and map hits to the existing entry shape:
  `{ timestamp, severity, service, message, trace_id? }`.
- Return `backend: "elasticsearch"` so reports show the data source.

**Definition of done**
- Works against a local Elasticsearch (`docker run -p 9200:9200 elasticsearch:8`).
- Simulation fallback untouched when the env var is unset.
- Env vars documented in `README.md` + `PRODUCTION.md`; output-shape unit test added.

See `CONTRIBUTING.md` → "Adding a new tool integration" for the pattern to copy —
`queryLoki` in `tools/server.ts` is the reference implementation.

---

## Issue 2

**Title:** Tool integration: GitHub Issues backend for `create_ticket`

**Body:**

`create_ticket` supports Linear (`LINEAR_API_KEY` + `LINEAR_TEAM_ID`) with a simulation
fallback. Many small teams track incidents as GitHub issues.

**What to build**
- In `tools/server.ts`, extend `createTicket` to check `GITHUB_TOKEN` + `GITHUB_REPO`
  (`owner/repo`) when Linear isn't configured.
- `POST /repos/{owner}/{repo}/issues` with the incident title/description, and a label
  per severity (e.g. `severity:high`).
- Return the existing shape: `{ backend: "github", ticket_id, url, title, severity, status, created_at }`
  where `ticket_id` is `#<issue number>`.

**Definition of done**
- Precedence documented: Linear → GitHub → simulation.
- Env vars documented in `README.md` + `PRODUCTION.md`; output-shape unit test added.

---

## Issue 3

**Title:** Tool integration: Grafana annotations tool (`annotate_incident`)

**Body:**

A brand-new tool (great way to learn the whole registry pattern): when an investigation
starts or completes, drop an annotation on Grafana dashboards so the incident is visible
on every graph of that time window.

**What to build**
- New tool `annotate_incident(text, tags[], time?)` in `tools/server.ts`: Zod schema,
  tool definition in the `ListTools` handler, handler function, `TOOL_REGISTRY` entry.
- Real backend: `POST {GRAFANA_URL}/api/annotations` with `GRAFANA_API_KEY`.
- Simulation fallback returning a deterministic fake annotation ID.

**Definition of done**
- The LLM planner picks the tool up automatically (verify via `GET /api/tools`).
- Env vars documented; unit test for the arg schema and output shape.

---

## Post commands

```bash
gh issue create --repo theprodsde/agentcore --label "good first issue" --label "tool-integration" \
  --title "Tool integration: Elasticsearch/Kibana backend for search_logs" --body-file <(sed -n '/^## Issue 1$/,/^---$/p' .github/GOOD_FIRST_ISSUES.md | sed '1,4d;$d')

# (or paste each body from this file into the web UI — whichever is easier)
```

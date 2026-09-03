# AgentCore MCP Tool Server

The tool server is a standalone process that implements the [Model Context Protocol](https://modelcontextprotocol.io/) server-side. The orchestrator spawns it automatically via stdio — no manual setup required.

## Available tools

| Tool | Description | Real backend |
|---|---|---|
| `search_logs` | Search structured logs for a service by query, severity, and time range | `LOKI_URL` |
| `get_metrics` | Query time-series metrics (cpu, latency, error rate, memory) for a service | `PROMETHEUS_URL` |
| `create_ticket` | Create an incident ticket, returns ticket ID and URL | `LINEAR_API_KEY` + `LINEAR_TEAM_ID` |
| `list_services` | List all known services and their health status | simulation only |

When a real backend env var is not set, the tool returns deterministic realistic output so the orchestrator works without any external infrastructure.

## Adding a new tool

1. Open [tools/server.ts](server.ts).
2. Add the tool definition to the `ListToolsRequestSchema` handler — name, description, and `inputSchema`.
3. Add a `case "your_tool":` branch to the `CallToolRequestSchema` handler.
4. Implement the handler function below. Check for a real backend env var; fall back to simulation.

That's it. The planner receives the live tool manifest on every run, so the LLM will start selecting your new tool automatically — no changes to the orchestrator needed.

## Connecting a real backend

### Loki (logs)
```
LOKI_URL=http://loki.your-infra.internal:3100
```
The tool sends a LogQL query: `{service="<name>"} |~ "<query>"`.

### Prometheus (metrics)
```
PROMETHEUS_URL=http://prometheus.your-infra.internal:9090
```
The tool sends: `<metric>{service="<name>"}` over the range query API.

### Linear (tickets)
```
LINEAR_API_KEY=lin_api_...
LINEAR_TEAM_ID=<your-team-uuid>
```
The tool calls the Linear GraphQL `issueCreate` mutation.

## Running standalone (for development / testing)

```bash
# Run the MCP server directly and interact over stdio
npx tsx tools/server.ts
```

Send JSON-RPC messages on stdin. The server responds on stdout per the MCP spec.

## Connecting an external MCP server

Set `MCP_SERVER_URL` to point the orchestrator at any SSE-compatible MCP server instead of spawning the local one:

```
MCP_SERVER_URL=https://tools.your-infra.internal/sse
```

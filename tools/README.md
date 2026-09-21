# AgentCore MCP Tool Server

The tool server is a standalone process that implements the [Model Context Protocol](https://modelcontextprotocol.io/) server-side. The orchestrator spawns it automatically via stdio — no manual setup required.

## Available tools

| Tool | Description | Real backend |
|---|---|---|
| `search_logs` | Search structured logs for a service by query, severity, and time range | `LOKI_URL` |
| `get_metrics` | Query time-series metrics (cpu, latency, error rate, memory) for a service | `PROMETHEUS_URL` |
| `search_runbook` | Search internal runbooks for procedures matching this incident type | `RUNBOOK_URL` |
| `create_ticket` | Create an incident ticket, returns ticket ID and URL | `LINEAR_API_KEY` + `LINEAR_TEAM_ID` |
| `list_services` | List all known services and their current health status | simulation only |

When a real backend env var is not set, the tool returns deterministic realistic output so the orchestrator works without any external infrastructure.

## Adding a new tool

1. Open [tools/server.ts](server.ts).

2. Add a Zod schema for the tool's arguments:
   ```typescript
   const MyToolSchema = z.object({
     service: z.string(),
     limit:   z.number().int().positive().default(10),
   });
   ```

3. Add the tool definition to the `ListToolsRequestSchema` handler (inside the `tools` array):
   ```typescript
   {
     name: "my_tool",
     description: "What it does.",
     inputSchema: {
       type: "object",
       properties: {
         service: { type: "string", description: "Service name" },
         limit:   { type: "number", description: "Max results" },
       },
       required: ["service"],
     },
   }
   ```

4. Register it in `TOOL_REGISTRY` — this is a plain map, not a switch statement:
   ```typescript
   const TOOL_REGISTRY = {
     // existing tools...
     my_tool: (args) => myTool(MyToolSchema.parse(args)),
   };
   ```

5. Implement the handler function. Check for a real backend env var; fall back to simulation:
   ```typescript
   async function myTool(args: z.infer<typeof MyToolSchema>) {
     if (process.env.MY_TOOL_URL) {
       // call real backend
     }
     // return deterministic simulation
   }
   ```

That's it. The planner receives the live tool manifest on every run, so the LLM will start selecting your new tool automatically — no changes to the orchestrator needed. Args are Zod-validated before reaching your handler.

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

### Runbook search
```
RUNBOOK_URL=https://your-confluence-or-wiki-search-endpoint
```
The tool calls `GET /search?q=<query>&service=<service>`. Expected response format:
```json
{ "results": [{ "title": "...", "url": "...", "excerpt": "..." }] }
```

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

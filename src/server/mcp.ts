import path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { logger } from "./logger.js";

// ─── Singletons ───────────────────────────────────────────────────────────────

let mcpClient: Client | null = null;

// Tool list is static for the lifetime of the subprocess — cache it.
// Building the planner summary string is also pure/static — memoize alongside.
let _toolList: Awaited<ReturnType<Client["listTools"]>>["tools"] | null = null;
let _toolSummary: string | null = null;

// ─── Client ───────────────────────────────────────────────────────────────────

export async function getMcpClient(): Promise<Client | null> {
  if (mcpClient) return mcpClient;

  const client = new Client({ name: "agentcore-client", version: "1.0.0" }, {});

  const remoteUrl = process.env.MCP_SERVER_URL;
  if (remoteUrl) {
    try {
      const transport = new SSEClientTransport(new URL(remoteUrl));
      await client.connect(transport);
      logger.info({ url: remoteUrl }, "Connected to remote MCP server via SSE");
      mcpClient = client;
      return mcpClient;
    } catch (err) {
      logger.error({ err }, "Failed to connect to remote MCP server");
      return null;
    }
  }

  // Spawn the bundled tools server as a subprocess over stdio.
  // Both dev and prod resolve from process.cwd() (the project root).
  try {
    const isDev = process.env.NODE_ENV !== "production";
    const toolsServerPath = isDev
      ? path.resolve(process.cwd(), "tools/server.ts")
      : path.resolve(process.cwd(), "dist/tools/server.cjs");

    const transport = new StdioClientTransport(
      isDev
        ? { command: "npx", args: ["tsx", toolsServerPath] }
        : { command: "node", args: [toolsServerPath] }
    );

    await client.connect(transport);
    logger.info({ mode: isDev ? "stdio/dev" : "stdio/prod" }, "Connected to local MCP tools server");
    mcpClient = client;
    return mcpClient;
  } catch (err) {
    logger.error({ err }, "Failed to spawn local MCP tools server");
    return null;
  }
}

// ─── Tool list + summary (cached for process lifetime) ───────────────────────

/** Returns the tool list, fetched once and cached for the process lifetime. */
export async function listMcpTools(): Promise<typeof _toolList extends null ? never[] : NonNullable<typeof _toolList>> {
  const client = await getMcpClient();
  if (!client) return [] as never[];

  if (!_toolList) {
    const { tools } = await client.listTools();
    _toolList = tools;
    // Pre-build the summary string used in planner prompts — pure function of the static tool list
    _toolSummary = tools.map((t) => {
      const schema = t.inputSchema as { properties?: Record<string, { type: string }> } | undefined;
      const params = Object.entries(schema?.properties ?? {})
        .map(([k, v]) => `${k}(${v.type})`).join(", ");
      return `- ${t.name}(${params}): ${t.description}`;
    }).join("\n");
    logger.info({ count: tools.length }, "MCP tool list cached");
  }

  return _toolList as never[];
}

/** Returns the pre-built planner tool summary string, or null if tools unavailable. */
export async function getMcpToolSummary(): Promise<string | null> {
  await listMcpTools(); // ensures _toolSummary is populated
  return _toolSummary;
}

/** Closes the MCP subprocess cleanly — call from graceful shutdown handler. */
export async function closeMcpClient(): Promise<void> {
  if (mcpClient) {
    await mcpClient.close().catch(() => {/* ignore errors on shutdown */});
    mcpClient = null;
    _toolList = null;
    _toolSummary = null;
  }
}

// ─── Tool execution ───────────────────────────────────────────────────────────

export async function executeMcpTool(toolName: string, args: Record<string, unknown>) {
  const client = await getMcpClient();
  if (!client) throw new Error(`MCP client not connected. Cannot execute tool: ${toolName}`);

  logger.info({ toolName, args }, "Executing MCP tool");
  return client.callTool({ name: toolName, arguments: args });
}

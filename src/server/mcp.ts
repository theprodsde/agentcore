import path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { logger } from "./logger.js";

let mcpClient: Client | null = null;

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

export async function executeMcpTool(toolName: string, args: Record<string, unknown>) {
  const client = await getMcpClient();
  if (!client) throw new Error(`MCP client not connected. Cannot execute tool: ${toolName}`);

  logger.info({ toolName, args }, "Executing MCP tool");
  const result = await client.callTool({ name: toolName, arguments: args });
  return result;
}

export async function listMcpTools() {
  const client = await getMcpClient();
  if (!client) return [];
  const { tools } = await client.listTools();
  return tools;
}

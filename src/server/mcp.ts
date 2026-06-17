import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { logger } from "./logger.js";

let mcpClient: Client | null = null;

export async function getMcpClient() {
  if (mcpClient) return mcpClient;

  const serverUrl = process.env.MCP_SERVER_URL;
  if (!serverUrl) {
    logger.warn("No MCP_SERVER_URL provided in environment. Real MCP execution is disabled.");
    return null;
  }

  try {
    const transport = new SSEClientTransport(new URL(serverUrl));
    mcpClient = new Client(
      {
        name: "agentcore-client",
        version: "1.0.0",
      },
      {}
    );
    await mcpClient.connect(transport);
    logger.info({ url: serverUrl }, "Connected to real MCP Server via SSE");
    return mcpClient;
  } catch (error) {
    logger.error({ err: error }, "Failed to connect to MCP server");
    return null;
  }
}

export async function executeMcpTool(toolName: string, args: Record<string, any>) {
  const client = await getMcpClient();
  if (!client) {
    throw new Error(`Real MCP Client not connected. Cannot execute tool ${toolName}`);
  }
  
  logger.info({ toolName, args }, "Executing real MCP tool");
  const result = await client.callTool({ name: toolName, arguments: args });
  return result;
}

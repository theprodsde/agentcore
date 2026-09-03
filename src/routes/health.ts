import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "../server/db/index.js";
import { getLLMClient } from "../server/llm.js";
import { listMcpTools } from "../server/mcp.js";
import { toErrorMessage } from "../utils/index.js";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

healthRouter.get("/health/detailed", async (_req, res) => {
  const checks: Record<string, unknown> = {};

  try {
    const start = Date.now();
    await db.execute(sql`SELECT 1`);
    checks.database = { status: "ok", latency_ms: Date.now() - start };
  } catch (err) {
    checks.database = { status: "error", error: toErrorMessage(err) };
  }

  checks.llm = getLLMClient()
    ? { status: "configured", base_url: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1" }
    : { status: "not_configured" };

  try {
    const tools = await listMcpTools();
    checks.mcp_tools = { status: "ok", tool_count: tools.length, tools: tools.map((t) => t.name) };
  } catch {
    checks.mcp_tools = { status: "error" };
  }

  checks.otel = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    ? { status: "exporting", endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT }
    : { status: "disabled" };

  const allOk = Object.values(checks).every((c) => (c as { status: string }).status !== "error");
  return res.status(allOk ? 200 : 503).json({ status: allOk ? "ok" : "degraded", timestamp: new Date().toISOString(), checks });
});

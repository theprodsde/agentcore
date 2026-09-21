import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "../server/db/index.js";
import { getLLMClient } from "../server/llm.js";
import { listMcpTools } from "../server/mcp.js";
import { asyncHandler } from "../server/http.js";
import { toErrorMessage } from "../utils/index.js";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

healthRouter.get("/health/detailed", asyncHandler(async (_req, res) => {
  // Run independent subsystem checks in parallel — O(max latency) vs O(sum of latencies)
  const [dbCheck, mcpCheck] = await Promise.allSettled([
    (async () => {
      const start = Date.now();
      await db.execute(sql`SELECT 1`);
      return { status: "ok", latency_ms: Date.now() - start };
    })(),
    (async () => {
      const tools = await listMcpTools();
      return { status: "ok", tool_count: tools.length, tools: tools.map((t) => t.name) };
    })(),
  ]);

  const checks: Record<string, unknown> = {
    database:  dbCheck.status  === "fulfilled" ? dbCheck.value  : { status: "error", error: toErrorMessage((dbCheck as PromiseRejectedResult).reason) },
    mcp_tools: mcpCheck.status === "fulfilled" ? mcpCheck.value : { status: "error" },
    llm: getLLMClient()
      ? { status: "configured", base_url: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1" }
      : { status: "not_configured" },
    otel: process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      ? { status: "exporting", endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT }
      : { status: "disabled" },
  };

  const allOk = Object.values(checks).every((c) => (c as { status: string }).status !== "error");
  return res.status(allOk ? 200 : 503).json({ status: allOk ? "ok" : "degraded", timestamp: new Date().toISOString(), checks });
}));

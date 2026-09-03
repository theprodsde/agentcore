import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, apiKeys } from "../server/db/index.js";
import { authMiddleware, isAuthEnabled, createTeam, exchangeApiKey, generateApiKey, hashApiKey } from "../server/auth.js";
import { logger } from "../server/logger.js";

export const authRouter = Router();

authRouter.post("/teams", async (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== "string") return res.status(400).json({ error: "name is required" });
  try {
    const team = await createTeam(name);
    return res.status(201).json({
      team_id: team.team_id,
      name: team.name,
      slug: team.slug,
      api_key: team.api_key,
      note: "Save this API key — it will not be shown again.",
    });
  } catch (err) {
    logger.error({ err }, "Failed to create team");
    return res.status(500).json({ error: "Failed to create team" });
  }
});

authRouter.post("/auth/token", async (req, res) => {
  if (!isAuthEnabled()) return res.json({ token: null, note: "Auth is disabled (JWT_SECRET not set)" });
  const { api_key } = req.body;
  if (!api_key) return res.status(400).json({ error: "api_key is required" });
  try {
    const token = await exchangeApiKey(api_key);
    return res.json({ token, expires_in: 86400 });
  } catch {
    return res.status(401).json({ error: "Invalid API key" });
  }
});

authRouter.post("/teams/:team_id/api-keys", authMiddleware, async (req, res) => {
  const { team_id } = req.params;
  if (req.teamId && req.teamId !== team_id) return res.status(403).json({ error: "Forbidden" });
  const { description } = req.body;
  const raw = generateApiKey();
  await db.insert(apiKeys).values({ team_id, key_hash: hashApiKey(raw), description: description || null });
  return res.status(201).json({ api_key: raw, note: "Save this API key — it will not be shown again." });
});

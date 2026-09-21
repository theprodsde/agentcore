import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, apiKeys } from "../server/db/index.js";
import { authMiddleware, isAuthEnabled, createTeam, exchangeApiKey, generateApiKey, hashApiKey } from "../server/auth.js";
import { asyncHandler } from "../server/http.js";
import { CreateTeamSchema, zodMessage } from "../server/validation.js";
import { logger } from "../server/logger.js";

export const authRouter = Router();

/** Public: lets the frontend decide whether to show the login screen. */
authRouter.get("/auth/status", (_req, res) => {
  res.json({ auth_enabled: isAuthEnabled() });
});

authRouter.post("/teams", asyncHandler(async (req, res) => {
  // Open by default so the first team can bootstrap itself; lock down after setup.
  if (process.env.DISABLE_TEAM_SIGNUP === "true") {
    return res.status(403).json({ error: "Team signup is disabled on this instance" });
  }
  const parsed = CreateTeamSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });
  try {
    const team = await createTeam(parsed.data.name);
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
}));

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

authRouter.post("/teams/:team_id/api-keys", authMiddleware, asyncHandler(async (req, res) => {
  const { team_id } = req.params;
  if (req.teamId && req.teamId !== team_id) return res.status(403).json({ error: "Forbidden" });
  const { description } = req.body;
  const raw = generateApiKey();
  await db.insert(apiKeys).values({ team_id, key_hash: hashApiKey(raw), description: description || null });
  return res.status(201).json({ api_key: raw, note: "Save this API key — it will not be shown again." });
}));

// List a team's keys — metadata only, never the hash or the raw key
authRouter.get("/teams/:team_id/api-keys", authMiddleware, asyncHandler(async (req, res) => {
  const { team_id } = req.params;
  if (req.teamId && req.teamId !== team_id) return res.status(403).json({ error: "Forbidden" });
  const keys = await db.select({
    id:           apiKeys.id,
    description:  apiKeys.description,
    created_at:   apiKeys.created_at,
    last_used_at: apiKeys.last_used_at,
  }).from(apiKeys).where(eq(apiKeys.team_id, team_id));
  return res.json({ items: keys });
}));

// Revoke a key. Refuses to revoke the last remaining key — that would lock the
// team out permanently (keys are the only way to mint new tokens).
authRouter.delete("/teams/:team_id/api-keys/:key_id", authMiddleware, asyncHandler(async (req, res) => {
  const { team_id, key_id } = req.params;
  if (req.teamId && req.teamId !== team_id) return res.status(403).json({ error: "Forbidden" });

  const keys = await db.select({ id: apiKeys.id }).from(apiKeys).where(eq(apiKeys.team_id, team_id));
  if (!keys.some((k) => k.id === key_id)) return res.status(404).json({ error: "API key not found" });
  if (keys.length === 1) {
    return res.status(400).json({ error: "Cannot revoke the last API key — create a replacement first" });
  }

  await db.delete(apiKeys).where(and(eq(apiKeys.id, key_id), eq(apiKeys.team_id, team_id)));
  return res.json({ revoked: key_id });
}));

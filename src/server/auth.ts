import crypto from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";
import { db, teams, apiKeys } from "./db/index.js";
import { logger } from "./logger.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const TOKEN_TTL_SECONDS = 24 * 60 * 60;

// Read from process.env at call time so tests can set JWT_SECRET per-test
function getSecret(): Uint8Array | null {
  const raw = process.env.JWT_SECRET;
  if (!raw) return null;
  return new TextEncoder().encode(raw);
}

/** True when JWT_SECRET is set — re-evaluated on every call so tests can toggle it. */
export function isAuthEnabled(): boolean { return !!process.env.JWT_SECRET; }

/** @deprecated use isAuthEnabled() — kept for existing callers that need a boolean */
export const AUTH_ENABLED = false; // actual enforcement uses isAuthEnabled() at runtime

// ─── Token management ─────────────────────────────────────────────────────────

export async function signToken(teamId: string): Promise<string> {
  const secret = getSecret();
  if (!secret) throw new Error("JWT_SECRET is not configured");
  return new SignJWT({ sub: teamId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}

export async function verifyToken(token: string): Promise<string> {
  const secret = getSecret();
  if (!secret) throw new Error("JWT_SECRET is not configured");
  const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
  if (!payload.sub) throw new Error("Token missing sub claim");
  return payload.sub;
}

// ─── API key helpers ──────────────────────────────────────────────────────────

export function hashApiKey(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function generateApiKey(): string {
  return `agentcore_${crypto.randomBytes(24).toString("hex")}`;
}

// ─── Express middleware ───────────────────────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      teamId?: string;
    }
  }
}

/**
 * Extracts and verifies the Bearer JWT.
 * When JWT_SECRET is not set the middleware is a no-op (dev mode).
 * Routes that need a teamId should check req.teamId themselves.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!isAuthEnabled()) return next();

  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  verifyToken(header.slice(7))
    .then((teamId) => {
      req.teamId = teamId;
      next();
    })
    .catch((err) => {
      logger.warn({ err }, "JWT verification failed");
      return res.status(401).json({ error: "Invalid or expired token" });
    });
}

// ─── Team and key management helpers used by routes ──────────────────────────

export async function createTeam(name: string): Promise<typeof teams.$inferSelect & { api_key: string }> {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const [team] = await db.insert(teams).values({ name, slug }).returning();

  const raw = generateApiKey();
  await db.insert(apiKeys).values({
    team_id: team.team_id,
    key_hash: hashApiKey(raw),
    description: "Initial API key",
  });

  return { ...team, api_key: raw };
}

export async function exchangeApiKey(rawKey: string): Promise<string> {
  const hash = hashApiKey(rawKey);
  const [key] = await db.select().from(apiKeys).where(eq(apiKeys.key_hash, hash));
  if (!key) throw new Error("Invalid API key");

  // touch last_used_at
  await db.update(apiKeys).set({ last_used_at: new Date() }).where(eq(apiKeys.id, key.id));

  return signToken(key.team_id);
}

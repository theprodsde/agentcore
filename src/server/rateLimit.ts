/**
 * In-process token-bucket rate limiter for task-creating endpoints.
 *
 * Every accepted task costs LLM tokens, so creation paths need a cap even
 * behind a proxy. Token bucket gives O(1) per check with lazy refill — no
 * timers, no per-request allocation beyond the bucket itself. Buckets live
 * in an LRU+TTL cache so idle keys evict themselves (bounded memory even
 * under key-spraying).
 *
 * RATE_LIMIT_RPM=0 disables limiting entirely.
 */
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { LRUTTLCache } from "./cache.js";

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

export class TokenBucketLimiter {
  private buckets: LRUTTLCache<Bucket>;
  private readonly refillPerMs: number;

  constructor(
    private readonly capacity: number,
    ratePerMinute: number,
    maxKeys = 10_000,
    private readonly bucketTtlMs = 10 * 60 * 1000
  ) {
    this.refillPerMs = ratePerMinute / 60_000;
    this.buckets = new LRUTTLCache<Bucket>(maxKeys);
  }

  /** Consumes one token for `key` if available. O(1). */
  tryConsume(key: string): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, lastRefillMs: now };

    bucket.tokens = Math.min(this.capacity, bucket.tokens + (now - bucket.lastRefillMs) * this.refillPerMs);
    bucket.lastRefillMs = now;

    const allowed = bucket.tokens >= 1;
    if (allowed) bucket.tokens -= 1;

    this.buckets.set(key, bucket, this.bucketTtlMs);
    return allowed;
  }
}

// ─── Shared limiter for task creation ─────────────────────────────────────────

function configuredRpm(): number {
  return Number(process.env.RATE_LIMIT_RPM ?? 30);
}

let _limiter: TokenBucketLimiter | null = null;
let _limiterRpm = -1;

function getLimiter(): TokenBucketLimiter | null {
  const rpm = configuredRpm();
  if (rpm <= 0) return null;
  if (!_limiter || _limiterRpm !== rpm) {
    // Burst capacity = one minute's worth of requests
    _limiter = new TokenBucketLimiter(rpm, rpm);
    _limiterRpm = rpm;
  }
  return _limiter;
}

/** Non-middleware check for handlers that respond before processing (Slack, webhooks). */
export function allowTaskCreation(key: string): boolean {
  const limiter = getLimiter();
  return limiter ? limiter.tryConsume(key) : true;
}

/** Express middleware — 429 when the caller exceeds RATE_LIMIT_RPM task creations. */
export const taskCreationRateLimit: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const key = req.teamId ?? req.ip ?? "anon";
  if (!allowTaskCreation(`api:${key}`)) {
    res.status(429).json({ error: "Rate limit exceeded — too many task creations. Try again shortly." });
    return;
  }
  next();
};

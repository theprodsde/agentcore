import { describe, it, expect, vi, afterEach } from "vitest";
import { TokenBucketLimiter } from "../../src/server/rateLimit";

afterEach(() => vi.useRealTimers());

describe("TokenBucketLimiter", () => {
  it("allows up to capacity requests in a burst", () => {
    const limiter = new TokenBucketLimiter(5, 60);
    const results = Array.from({ length: 6 }, () => limiter.tryConsume("k"));
    expect(results).toEqual([true, true, true, true, true, false]);
  });

  it("tracks keys independently", () => {
    const limiter = new TokenBucketLimiter(1, 60);
    expect(limiter.tryConsume("a")).toBe(true);
    expect(limiter.tryConsume("a")).toBe(false);
    expect(limiter.tryConsume("b")).toBe(true);
  });

  it("refills tokens over time at the configured rate", () => {
    vi.useFakeTimers();
    const limiter = new TokenBucketLimiter(2, 60); // 1 token per second
    expect(limiter.tryConsume("k")).toBe(true);
    expect(limiter.tryConsume("k")).toBe(true);
    expect(limiter.tryConsume("k")).toBe(false);

    vi.advanceTimersByTime(1_000); // exactly one token refilled
    expect(limiter.tryConsume("k")).toBe(true);
    expect(limiter.tryConsume("k")).toBe(false);
  });

  it("never exceeds capacity after a long idle period", () => {
    vi.useFakeTimers();
    const limiter = new TokenBucketLimiter(3, 60);
    limiter.tryConsume("k");
    vi.advanceTimersByTime(60 * 60 * 1000); // 1 hour idle
    const results = Array.from({ length: 4 }, () => limiter.tryConsume("k"));
    expect(results).toEqual([true, true, true, false]);
  });

  it("evicts oldest keys once maxKeys is exceeded (bounded memory)", () => {
    const limiter = new TokenBucketLimiter(1, 60, 2);
    expect(limiter.tryConsume("a")).toBe(true); // a exhausted
    expect(limiter.tryConsume("b")).toBe(true);
    expect(limiter.tryConsume("c")).toBe(true); // evicts "a" (LRU)
    // "a" was evicted, so it gets a fresh bucket — allowed again
    expect(limiter.tryConsume("a")).toBe(true);
  });
});

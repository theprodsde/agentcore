import crypto from "crypto";
import { describe, it, expect } from "vitest";
import { verifySlackSignature } from "../../src/server/slack";

const SECRET = "test-signing-secret";

function sign(secret: string, timestamp: string, body: string): string {
  return `v0=${crypto.createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
}

describe("verifySlackSignature", () => {
  const body = JSON.stringify({ type: "event_callback", event: { type: "message", text: "!incident test" } });

  it("accepts a valid signature with a fresh timestamp", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    expect(verifySlackSignature(SECRET, ts, body, sign(SECRET, ts, body))).toBe(true);
  });

  it("accepts a raw Buffer body", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    expect(verifySlackSignature(SECRET, ts, Buffer.from(body), sign(SECRET, ts, body))).toBe(true);
  });

  it("rejects a signature computed with a different secret", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    expect(verifySlackSignature(SECRET, ts, body, sign("wrong-secret", ts, body))).toBe(false);
  });

  it("rejects a tampered body", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = sign(SECRET, ts, body);
    expect(verifySlackSignature(SECRET, ts, body + "x", sig)).toBe(false);
  });

  it("rejects replayed requests older than 5 minutes", () => {
    const staleTs = String(Math.floor(Date.now() / 1000) - 6 * 60);
    expect(verifySlackSignature(SECRET, staleTs, body, sign(SECRET, staleTs, body))).toBe(false);
  });

  it("rejects missing timestamp or signature", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    expect(verifySlackSignature(SECRET, undefined, body, sign(SECRET, ts, body))).toBe(false);
    expect(verifySlackSignature(SECRET, ts, body, undefined)).toBe(false);
  });

  it("rejects a non-numeric timestamp", () => {
    expect(verifySlackSignature(SECRET, "not-a-number", body, "v0=abc")).toBe(false);
  });

  it("rejects malformed signatures without throwing", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    expect(verifySlackSignature(SECRET, ts, body, "garbage")).toBe(false);
    expect(verifySlackSignature(SECRET, ts, body, "")).toBe(false);
  });
});

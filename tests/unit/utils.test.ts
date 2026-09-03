import { describe, it, expect } from "vitest";
import { parseLLMJson, generateTraceId, toErrorMessage } from "../../src/utils/index";

describe("parseLLMJson", () => {
  it("parses plain valid JSON", () => {
    expect(parseLLMJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it("strips markdown fences before parsing", () => {
    const input = "```json\n{\"key\": \"value\"}\n```";
    expect(parseLLMJson<{ key: string }>(input)).toEqual({ key: "value" });
  });

  it("strips fences without language tag", () => {
    expect(parseLLMJson<{ x: boolean }>("```\n{\"x\":true}\n```")).toEqual({ x: true });
  });

  it("returns null for invalid JSON", () => {
    expect(parseLLMJson("not json at all")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseLLMJson("")).toBeNull();
  });

  it("returns null for markdown fence with no JSON inside", () => {
    expect(parseLLMJson("```\n```")).toBeNull();
  });
});

describe("generateTraceId", () => {
  it("has the expected tr-<random>-<suffix> format", () => {
    expect(generateTraceId()).toMatch(/^tr-[a-z0-9]+-\d{4}$/);
  });

  it("generates unique IDs on each call", () => {
    const ids = Array.from({ length: 100 }, generateTraceId);
    expect(new Set(ids).size).toBe(100);
  });
});

describe("toErrorMessage", () => {
  it("extracts message from Error instances", () => {
    expect(toErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("converts string thrown values", () => {
    expect(toErrorMessage("plain string error")).toBe("plain string error");
  });

  it("converts number thrown values", () => {
    expect(toErrorMessage(42)).toBe("42");
  });

  it("converts null", () => {
    expect(toErrorMessage(null)).toBe("null");
  });
});

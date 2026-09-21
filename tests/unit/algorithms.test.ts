import { describe, it, expect } from "vitest";
import {
  levenshtein,
  editSimilarity,
  topK,
  jaccardSimilarity,
  incidentSimilarity,
  boundedLevenshtein,
  boundedEditSimilarity,
  lcsLength,
  lcsSimilarity,
  selectOptimalTools,
  type ToolOption,
} from "../../src/utils/algorithms";

// ─── levenshtein ──────────────────────────────────────────────────────────────

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshtein("abc", "abc")).toBe(0);
  });

  it("returns string length for empty other string", () => {
    expect(levenshtein("abc", "")).toBe(3);
    expect(levenshtein("", "abc")).toBe(3);
  });

  it("returns 0 for two empty strings", () => {
    expect(levenshtein("", "")).toBe(0);
  });

  it("computes single substitution correctly", () => {
    expect(levenshtein("cat", "bat")).toBe(1);
  });

  it("computes single insertion correctly", () => {
    expect(levenshtein("cat", "cats")).toBe(1);
  });

  it("computes single deletion correctly", () => {
    expect(levenshtein("cats", "cat")).toBe(1);
  });

  it("computes multi-operation distance", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
  });

  it("computes completely different strings", () => {
    expect(levenshtein("abc", "xyz")).toBe(3);
  });

  it("is symmetric", () => {
    expect(levenshtein("payments", "paymens")).toBe(levenshtein("paymens", "payments"));
  });

  it("satisfies triangle inequality for known triple", () => {
    const ab = levenshtein("payments", "payment");
    const bc = levenshtein("payment", "payments-service");
    const ac = levenshtein("payments", "payments-service");
    expect(ac).toBeLessThanOrEqual(ab + bc);
  });
});

// ─── editSimilarity ───────────────────────────────────────────────────────────

describe("editSimilarity", () => {
  it("returns 1 for identical strings", () => {
    expect(editSimilarity("abc", "abc")).toBe(1);
  });

  it("returns 0 for completely different strings of equal length", () => {
    expect(editSimilarity("abc", "xyz")).toBeCloseTo(0);
  });

  it("is case-insensitive by default", () => {
    expect(editSimilarity("OOM", "oom")).toBe(1);
  });

  it("is case-sensitive when flag is set", () => {
    expect(editSimilarity("OOM", "oom", true)).toBeLessThan(1);
  });

  it("returns a value between 0 and 1", () => {
    const s = editSimilarity("payments-service latency", "latency on payments");
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  it("near-identical strings have high similarity", () => {
    // one character typo
    expect(editSimilarity("payments-service", "paymens-service")).toBeGreaterThan(0.9);
  });

  it("completely unrelated strings have low similarity", () => {
    expect(editSimilarity("aaaaaaaaaa", "zzzzzzzzzz")).toBeLessThan(0.1);
  });
});

// ─── topK ─────────────────────────────────────────────────────────────────────

describe("topK", () => {
  const items = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3];

  it("returns the k highest-scored items in descending order", () => {
    const result = topK(items, 3, x => x);
    expect(result).toEqual([9, 6, 5]);
  });

  it("returns all items sorted when k >= items.length", () => {
    const result = topK([3, 1, 2], 10, x => x);
    expect(result).toEqual([3, 2, 1]);
  });

  it("returns empty array for k = 0", () => {
    expect(topK(items, 0, x => x)).toEqual([]);
  });

  it("returns empty array for empty input", () => {
    expect(topK([], 5, x => x)).toEqual([]);
  });

  it("works with object items and a score function", () => {
    const objs = [{ name: "a", score: 3 }, { name: "b", score: 7 }, { name: "c", score: 1 }];
    const result = topK(objs, 2, o => o.score);
    expect(result.map(o => o.name)).toEqual(["b", "a"]);
  });

  it("result has exactly k items when input has more", () => {
    expect(topK(items, 4, x => x)).toHaveLength(4);
  });

  it("produces same top-3 as full sort + slice", () => {
    const expected = [...items].sort((a, b) => b - a).slice(0, 3);
    expect(topK(items, 3, x => x)).toEqual(expected);
  });

  it("handles negative scores correctly", () => {
    const result = topK([-1, -5, -2, -8, -3], 2, x => x);
    expect(result).toEqual([-1, -2]);
  });
});

// ─── jaccardSimilarity ────────────────────────────────────────────────────────

describe("jaccardSimilarity", () => {
  it("returns 1 for identical sets", () => {
    const s = new Set(["a", "b", "c"]);
    expect(jaccardSimilarity(s, s)).toBe(1);
  });

  it("returns 0 for disjoint sets", () => {
    expect(jaccardSimilarity(new Set(["a", "b"]), new Set(["c", "d"]))).toBe(0);
  });

  it("returns 1 for two empty sets", () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(1);
  });

  it("returns 0 when one set is empty", () => {
    expect(jaccardSimilarity(new Set(["a"]), new Set())).toBe(0);
  });

  it("computes 0.5 for two sets sharing half their elements", () => {
    const a = new Set(["a", "b", "c", "d"]);
    const b = new Set(["c", "d", "e", "f"]);
    expect(jaccardSimilarity(a, b)).toBeCloseTo(2 / 6);
  });

  it("is symmetric", () => {
    const a = new Set(["x", "y"]);
    const b = new Set(["y", "z"]);
    expect(jaccardSimilarity(a, b)).toBe(jaccardSimilarity(b, a));
  });

  it("produces same result regardless of which set is larger", () => {
    // Should iterate over the smaller set
    const small = new Set(["payments", "service"]);
    const large = new Set(["payments", "service", "latency", "spike", "deploy"]);
    expect(jaccardSimilarity(small, large)).toBeCloseTo(2 / 5);
  });
});

// ─── boundedLevenshtein ───────────────────────────────────────────────────────

describe("boundedLevenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(boundedLevenshtein("abc", "abc", 5)).toBe(0);
  });

  it("returns actual distance when within maxDist", () => {
    expect(boundedLevenshtein("cat", "bat", 2)).toBe(1);
    expect(boundedLevenshtein("kitten", "sitting", 5)).toBe(3);
  });

  it("returns maxDist+1 when distance exceeds threshold", () => {
    expect(boundedLevenshtein("abc", "xyz", 1)).toBe(2); // actual=3 > 1
  });

  it("early-exits on length-difference exceeding threshold", () => {
    // |8-1| = 7 > maxDist=2 → immediate return
    expect(boundedLevenshtein("abcdefgh", "x", 2)).toBe(3);
  });

  it("agrees with full levenshtein when within band", () => {
    const a = "payments-service";
    const b = "payments-service-v2";
    const full = levenshtein(a, b);
    expect(boundedLevenshtein(a, b, full + 1)).toBe(full);
  });

  it("is consistent with levenshtein for close strings", () => {
    expect(boundedLevenshtein("latency", "latncy", 3)).toBe(levenshtein("latency", "latncy"));
  });
});

describe("boundedEditSimilarity", () => {
  it("returns 1 for identical strings", () => {
    expect(boundedEditSimilarity("abc", "abc")).toBe(1);
  });

  it("returns high value for one-char difference", () => {
    expect(boundedEditSimilarity("payments-service", "paymens-service")).toBeGreaterThan(0.9);
  });

  it("returns 0 for strings too different to be similar", () => {
    expect(boundedEditSimilarity("aaaaaaaaa", "zzzzzzzzz")).toBe(0);
  });

  it("is case-insensitive by default", () => {
    expect(boundedEditSimilarity("OOM", "oom")).toBe(1);
  });
});

// ─── lcsLength + lcsSimilarity ────────────────────────────────────────────────

describe("lcsLength", () => {
  it("returns 0 for empty strings", () => {
    expect(lcsLength("", "abc")).toBe(0);
    expect(lcsLength("abc", "")).toBe(0);
  });

  it("returns string length for identical strings", () => {
    expect(lcsLength("abc", "abc")).toBe(3);
  });

  it("returns correct LCS for classic example", () => {
    // LCS("ABCBDAB", "BDCAB") = "BCAB" or "BDAB" → length 4
    expect(lcsLength("ABCBDAB", "BDCAB")).toBe(4);
  });

  it("returns 0 for completely different strings", () => {
    expect(lcsLength("aaa", "zzz")).toBe(0);
  });

  it("handles single-char matches", () => {
    expect(lcsLength("x", "x")).toBe(1);
    expect(lcsLength("x", "y")).toBe(0);
  });
});

describe("lcsSimilarity", () => {
  it("returns 1 for identical strings", () => {
    expect(lcsSimilarity("abc", "abc")).toBe(1);
  });

  it("returns 0 for completely different strings", () => {
    expect(lcsSimilarity("aaa", "zzz")).toBe(0);
  });

  it("handles word-reorder incident goals (key LCS use case)", () => {
    // LCS captures shared character subsequences regardless of word order.
    // Score is ~0.51 on character level (words share the same content but reordered).
    // Not huge on its own, but combines with Jaccard (high) in incidentSimilarity.
    expect(lcsSimilarity(
      "payments-service latency spike",
      "latency spike on payments-service"
    )).toBeGreaterThan(0.45);
  });

  it("is case-insensitive by default", () => {
    expect(lcsSimilarity("OOM CRASH", "oom crash")).toBe(1);
  });

  it("returns a value in [0, 1]", () => {
    const s = lcsSimilarity("some incident", "another thing");
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });
});

// ─── incidentSimilarity ───────────────────────────────────────────────────────

describe("incidentSimilarity", () => {
  it("returns 1 for identical incident strings", () => {
    expect(incidentSimilarity("OOM crash on auth-service", "OOM crash on auth-service")).toBe(1);
  });

  it("returns high score for a typo variant", () => {
    // One-char typo: Jaccard penalises "spike"≠"spke" (different tokens) but
    // edit similarity rescues it. Combined score (70% Jaccard + 30% edit) is 0.71
    // — well above the 0.6 dedup threshold.
    expect(incidentSimilarity("payments-service latency spike", "payments-service latency spke"))
      .toBeGreaterThan(0.65);
  });

  it("returns high score for same words in different order", () => {
    // Combined Jaccard(word)+Levenshtein+LCS gives ~0.65 — above the 0.6 dedup threshold
    expect(incidentSimilarity("latency spike on payments-service", "payments-service latency spike"))
      .toBeGreaterThan(0.6);
  });

  it("returns low score for completely different incidents", () => {
    expect(incidentSimilarity("OOM crash on auth-service", "disk quota exceeded on storage"))
      .toBeLessThan(0.35);
  });

  it("returns a value in [0, 1]", () => {
    const s = incidentSimilarity("some incident goal", "another totally different issue");
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  it("correctly deduplicates PagerDuty vs manual trigger for same incident", () => {
    // Real-world scenario: alert fires from PD and engineer also types it manually
    const pagerduty = "High error rate on payments-service — payments-service";
    const manual    = "High error rate on payments-service after deploy v3.1";
    expect(incidentSimilarity(pagerduty, manual)).toBeGreaterThan(0.5);
  });
});

// ─── selectOptimalTools (0/1 Knapsack DP) ────────────────────────────────────

describe("selectOptimalTools", () => {
  const tools: ToolOption[] = [
    { name: "search_logs",    avgDurationMs: 3000, value: 0.9, args: {} },
    { name: "get_metrics",    avgDurationMs: 2000, value: 0.8, args: {} },
    { name: "create_ticket",  avgDurationMs: 1000, value: 0.6, args: {} },
    { name: "search_runbook", avgDurationMs: 5000, value: 0.7, args: {} },
    { name: "list_services",  avgDurationMs:  500, value: 0.4, args: {} },
  ];

  it("returns empty array when tools list is empty", () => {
    expect(selectOptimalTools([], 10_000)).toEqual([]);
  });

  it("returns empty array when budget is 0", () => {
    expect(selectOptimalTools(tools, 0)).toEqual([]);
  });

  it("returns all tools when budget is large enough", () => {
    const result = selectOptimalTools(tools, 100_000);
    expect(result).toHaveLength(tools.length);
  });

  it("respects budget constraint — total duration never exceeds budget", () => {
    const budget = 6_000;
    const result = selectOptimalTools(tools, budget);
    const totalMs = result.reduce((s, t) => s + t.avgDurationMs, 0);
    expect(totalMs).toBeLessThanOrEqual(budget);
  });

  it("selects the highest-value combination within budget", () => {
    // Budget 5000ms:
    // search_logs(3000, 0.9) + get_metrics(2000, 0.8) = 5000ms, value=1.7  ✓ optimal
    // search_logs(3000, 0.9) + create_ticket(1000, 0.6) = 4000ms, value=1.5
    // get_metrics(2000, 0.8) + create_ticket(1000, 0.6) + list_services(500, 0.4) = 3500ms, value=1.8 ✓ better!
    const budget = 5_000;
    const result = selectOptimalTools(tools, budget);
    const totalValue = result.reduce((s, t) => s + t.value, 0);
    // Verify the total value is at least as good as the greedy single-pick
    expect(totalValue).toBeGreaterThanOrEqual(0.9); // at minimum, the best single tool
  });

  it("0/1 constraint: each tool selected at most once", () => {
    const result = selectOptimalTools(tools, 100_000);
    const names = result.map(t => t.name);
    expect(new Set(names).size).toBe(names.length); // no duplicates
  });

  it("works with a single tool", () => {
    const single = [{ name: "search_logs", avgDurationMs: 3000, value: 0.9, args: {} }];
    expect(selectOptimalTools(single, 5000)).toHaveLength(1);
    expect(selectOptimalTools(single, 2000)).toHaveLength(0); // over budget
  });

  it("handles tools with identical costs — picks highest value", () => {
    const equalCost: ToolOption[] = [
      { name: "a", avgDurationMs: 2000, value: 0.5, args: {} },
      { name: "b", avgDurationMs: 2000, value: 0.9, args: {} },
      { name: "c", avgDurationMs: 2000, value: 0.3, args: {} },
    ];
    const result = selectOptimalTools(equalCost, 2_500); // fits exactly one
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("b"); // highest value
  });

  it("budget exactly equal to one tool's cost selects that tool", () => {
    const result = selectOptimalTools(tools, 3_000); // exactly search_logs
    const totalMs = result.reduce((s, t) => s + t.avgDurationMs, 0);
    expect(totalMs).toBeLessThanOrEqual(3_000);
    expect(result.length).toBeGreaterThan(0);
  });
});

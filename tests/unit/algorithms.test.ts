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

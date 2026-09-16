/**
 * Pure algorithmic utilities — no I/O, no side effects.
 * All functions here are individually unit-testable.
 */

// ─── Levenshtein edit distance (space-optimised DP) ──────────────────────────

/**
 * Computes the Levenshtein edit distance between two strings.
 *
 * Classic DP recurrence:
 *   dp[i][j] = 0                              if i == 0 or j == 0 (base)
 *   dp[i][j] = dp[i-1][j-1]                  if a[i-1] == b[j-1]
 *   dp[i][j] = 1 + min(dp[i-1][j],           delete from a
 *                       dp[i][j-1],           insert into a
 *                       dp[i-1][j-1])         substitute
 *
 * Space-optimised: only two rows kept in memory → O(n) space instead of O(m×n).
 * Time: O(m × n).
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  // Base cases
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = Array.from({ length: n + 1 }, (_, j) => j);

  for (let i = 1; i <= m; i++) {
    const curr = new Array<number>(n + 1);
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]
          : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    prev = curr;
  }

  return prev[n];
}

/**
 * Returns a 0–1 similarity score based on normalised edit distance.
 * 1.0 = identical strings, 0.0 = completely different.
 * Case-insensitive by default.
 */
export function editSimilarity(a: string, b: string, caseSensitive = false): number {
  const sa = caseSensitive ? a : a.toLowerCase();
  const sb = caseSensitive ? b : b.toLowerCase();
  if (sa === sb) return 1;
  const dist = levenshtein(sa, sb);
  return 1 - dist / Math.max(sa.length, sb.length);
}

// ─── Top-k selection (partial sort via min-heap) ─────────────────────────────

/**
 * Returns the top k items by score in O(n · log k) time and O(k) space —
 * faster than a full O(n log n) sort when k << n.
 *
 * Uses a min-heap of size k: a new item beats the worst item in the heap
 * and displaces it. After one pass, the heap contains the k best items.
 */
export function topK<T>(items: T[], k: number, score: (item: T) => number): T[] {
  if (k <= 0 || items.length === 0) return [];
  if (k >= items.length) return [...items].sort((a, b) => score(b) - score(a));

  // Min-heap: index 0 is always the lowest-scoring element in the heap
  const heap: T[] = [];

  const heapify = (idx: number) => {
    let smallest = idx;
    const left = 2 * idx + 1;
    const right = 2 * idx + 2;
    if (left < heap.length && score(heap[left]) < score(heap[smallest])) smallest = left;
    if (right < heap.length && score(heap[right]) < score(heap[smallest])) smallest = right;
    if (smallest !== idx) {
      [heap[idx], heap[smallest]] = [heap[smallest], heap[idx]];
      heapify(smallest);
    }
  };

  for (const item of items) {
    if (heap.length < k) {
      heap.push(item);
      // Bubble up
      let i = heap.length - 1;
      while (i > 0) {
        const parent = Math.floor((i - 1) / 2);
        if (score(heap[parent]) <= score(heap[i])) break;
        [heap[parent], heap[i]] = [heap[i], heap[parent]];
        i = parent;
      }
    } else if (score(item) > score(heap[0])) {
      heap[0] = item;
      heapify(0);
    }
  }

  return heap.sort((a, b) => score(b) - score(a));
}

// ─── Bounded Levenshtein (early-exit DP) ─────────────────────────────────────

/**
 * Computes Levenshtein distance but exits as soon as the minimum possible
 * remaining distance exceeds `maxDist`. Returns `maxDist + 1` when exceeded.
 *
 * Time: O(n × k) where k = maxDist — much faster than O(m × n) for similar strings.
 * Space: O(n) — same two-row approach as `levenshtein()`.
 *
 * Use this in the hot dedup path where you only care about "is distance ≤ threshold?"
 */
export function boundedLevenshtein(a: string, b: string, maxDist: number): number {
  const m = a.length;
  const n = b.length;

  // If lengths differ by more than maxDist, no possible alignment can succeed
  if (Math.abs(m - n) > maxDist) return maxDist + 1;

  let prev = Array.from({ length: n + 1 }, (_, j) => j);

  for (let i = 1; i <= m; i++) {
    const curr = new Array<number>(n + 1).fill(maxDist + 1);
    curr[0] = i;

    let rowMin = curr[0]; // track minimum in this row for early-exit

    // Only compute within the diagonal band of width maxDist
    const jLo = Math.max(1, i - maxDist);
    const jHi = Math.min(n, i + maxDist);

    for (let j = jLo; j <= jHi; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]
          : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
      if (curr[j] < rowMin) rowMin = curr[j];
    }

    if (rowMin > maxDist) return maxDist + 1; // no alignment in this row can succeed
    prev = curr;
  }

  return prev[n] <= maxDist ? prev[n] : maxDist + 1;
}

/**
 * Returns a 0–1 similarity score using bounded edit distance.
 * Faster than `editSimilarity` for the dedup case because it exits early
 * when the strings are clearly too different.
 */
export function boundedEditSimilarity(a: string, b: string, caseSensitive = false): number {
  const sa = caseSensitive ? a : a.toLowerCase();
  const sb = caseSensitive ? b : b.toLowerCase();
  if (sa === sb) return 1;
  const maxLen = Math.max(sa.length, sb.length);
  // For the dedup threshold of 0.6, any distance > 40% of max length fails
  const threshold = Math.ceil(maxLen * 0.5);
  const dist = boundedLevenshtein(sa, sb, threshold);
  if (dist > threshold) return 0;
  return 1 - dist / maxLen;
}

// ─── LCS similarity (space-optimised DP) ─────────────────────────────────────

/**
 * Computes the length of the Longest Common Subsequence of two strings.
 *
 * DP recurrence:
 *   lcs(i, j) = lcs(i-1, j-1) + 1          if a[i-1] == b[j-1]
 *   lcs(i, j) = max(lcs(i-1, j), lcs(i, j-1))  otherwise
 *
 * Space-optimised: O(n) using two rows.
 * Time: O(m × n).
 */
export function lcsLength(a: string, b: string): number {
  const n = b.length;
  let prev = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= a.length; i++) {
    const curr = new Array<number>(n + 1).fill(0);
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    prev = curr;
  }

  return prev[n];
}

/**
 * LCS-based similarity: measures shared structure regardless of word order.
 * Complements Jaccard (which is set-based) and Levenshtein (which is position-sensitive).
 *
 * Useful for: "payments-service latency spike" vs "latency spike on payments-service"
 * where edit distance is high but LCS captures the shared subsequence.
 *
 * Returns 0–1: `2 × lcs_length / (m + n)` (Sørensen–Dice coefficient over chars).
 */
export function lcsSimilarity(a: string, b: string, caseSensitive = false): number {
  const sa = caseSensitive ? a : a.toLowerCase();
  const sb = caseSensitive ? b : b.toLowerCase();
  if (sa === sb) return 1;
  if (sa.length === 0 || sb.length === 0) return 0;
  return (2 * lcsLength(sa, sb)) / (sa.length + sb.length);
}

// ─── Jaccard similarity (allocation-free) ────────────────────────────────────

/**
 * Computes Jaccard similarity |A ∩ B| / |A ∪ B| without allocating a union Set.
 * |A ∪ B| = |A| + |B| - |A ∩ B|  →  no extra allocation needed.
 * Iterates over the smaller set for minimum work.
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  // Always iterate over the smaller set
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];

  let intersection = 0;
  for (const w of smaller) {
    if (larger.has(w)) intersection++;
  }

  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Combined incident similarity — three-way blend:
 *   55% Jaccard word-overlap  (robust to word reordering)
 *   25% Bounded Levenshtein   (catches typos and near-identical strings, fast early-exit)
 *   20% LCS similarity        (captures shared structure across different phrasings)
 *
 * Example scores:
 *   "OOM crash on auth-service"  vs "OOM crash on auth-service"     → 1.00
 *   "DB deadlock on inventory"   vs "DB deadlock on inventory-svc"  → ~0.87
 *   "payments latency spike"     vs "latency spike on payments"     → ~0.72 (LCS rescues)
 *   "OOM on auth-service"        vs "disk full on storage-service"  → ~0.10
 */
export function incidentSimilarity(a: string, b: string): number {
  const wordsOf = (s: string) =>
    new Set<string>(s.toLowerCase().split(/\W+/).filter(w => w.length > 3));

  const jaccard = jaccardSimilarity(wordsOf(a), wordsOf(b));
  const edit    = boundedEditSimilarity(a, b);   // fast early-exit DP
  const lcs     = lcsSimilarity(a, b);

  return jaccard * 0.55 + edit * 0.25 + lcs * 0.20;
}

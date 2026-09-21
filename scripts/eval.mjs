/**
 * Triage-quality eval harness.
 *
 * Runs the golden incidents (evals/golden-incidents.json) through a live
 * AgentCore instance as dry-run tasks and scores each final report:
 *   - affected:   report's affected_systems names the expected service
 *   - cause_any:  summary+probable_cause matches at least one expected pattern
 *   - forbidden:  summary+probable_cause matches NO forbidden pattern
 *                 (catches fabricated findings and query-echo circularity)
 *
 * Without an LLM key the pipeline is deterministic (fallback planner +
 * derived synthesis), so this doubles as a CI regression gate (--strict).
 * With a key, it measures real planner/synthesizer quality against the
 * same ground truth — scores may vary run to run.
 *
 * Usage:
 *   AGENTCORE_URL=http://localhost:3000 [AGENTCORE_TOKEN=eyJ...] node scripts/eval.mjs [--strict]
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const BASE   = (process.env.AGENTCORE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const TOKEN  = process.env.AGENTCORE_TOKEN ?? "";
const STRICT = process.argv.includes("--strict");
const POLL_MS = 1500;
const TIMEOUT_MS = 90_000;

const goldenPath = join(dirname(fileURLToPath(import.meta.url)), "../evals/golden-incidents.json");
const { scenarios } = JSON.parse(readFileSync(goldenPath, "utf-8"));

const headers = {
  "Content-Type": "application/json",
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function runScenario(scenario) {
  // dry_run: no memory writes, no tickets, no dedup — evals leave no residue
  const created = await api("/api/tasks", {
    method: "POST",
    body: JSON.stringify({ goal: scenario.goal, dry_run: true, user_id: "eval-harness" }),
  });

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const task = await api(`/api/tasks/${created.task_id}`);
    if (task.status === "completed") return JSON.parse(task.final_output);
    if (task.status === "failed") throw new Error(`task failed: ${task.error}`);
  }
  throw new Error("timed out waiting for task completion");
}

function score(scenario, report) {
  const text = `${report.summary ?? ""} ${report.probable_cause ?? ""}`;
  const affected = (report.affected_systems ?? []).map((s) => String(s).toLowerCase());
  const failures = [];

  if (!scenario.expect.affected.some((svc) => affected.includes(svc.toLowerCase()))) {
    failures.push(`affected_systems ${JSON.stringify(report.affected_systems)} missing expected ${scenario.expect.affected.join("|")}`);
  }
  if (!scenario.expect.cause_any.some((p) => new RegExp(p, "i").test(text))) {
    failures.push(`cause text matched none of [${scenario.expect.cause_any.join(", ")}]`);
  }
  for (const p of scenario.expect.forbidden ?? []) {
    if (new RegExp(p, "i").test(text)) failures.push(`FABRICATION: matched forbidden pattern "${p}"`);
  }
  return failures;
}

let passed = 0;
const results = [];

for (const scenario of scenarios) {
  try {
    const report = await runScenario(scenario);
    const failures = score(scenario, report);
    const ok = failures.length === 0;
    if (ok) passed++;
    results.push({ id: scenario.id, ok, failures });
    console.log(`${ok ? "✅ PASS" : "❌ FAIL"}  ${scenario.id}`);
    for (const f of failures) console.log(`         └ ${f}`);
  } catch (err) {
    results.push({ id: scenario.id, ok: false, failures: [String(err.message)] });
    console.log(`❌ ERROR ${scenario.id}: ${err.message}`);
  }
}

console.log(`\nTriage eval: ${passed}/${scenarios.length} scenarios passed`);
if (STRICT && passed < scenarios.length) process.exit(1);

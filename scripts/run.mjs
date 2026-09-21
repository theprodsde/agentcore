#!/usr/bin/env node
/**
 * AgentCore CLI
 *
 * Usage:
 *   node scripts/run.mjs "<incident goal>"
 *   node scripts/run.mjs "<goal>" --context "paste logs here" --dry-run
 *
 * Env:
 *   AGENTCORE_URL   Base URL of the running server (default: http://localhost:3000)
 *   AGENTCORE_TOKEN Bearer JWT token (required when JWT_SECRET is set on the server)
 */

import { parseArgs } from "node:util";

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    context:   { type: "string",  short: "c", default: "" },
    "dry-run": { type: "boolean", short: "d", default: false },
    task_type: { type: "string",  short: "t", default: "incident" },
    help:      { type: "boolean", short: "h", default: false },
  },
});

if (flags.help || positionals.length === 0) {
  console.log(`
AgentCore CLI — run an incident investigation from the terminal

Usage:
  node scripts/run.mjs "<goal>" [options]

Options:
  -c, --context <text>   Additional context (paste logs, alerts, etc.)
  -d, --dry-run          Skip memory write and ticket creation
  -t, --task_type        Task type (default: incident)
  -h, --help             Show this help

Environment:
  AGENTCORE_URL    Server base URL  (default: http://localhost:3000)
  AGENTCORE_TOKEN  Bearer JWT token (required when server auth is enabled)

Examples:
  node scripts/run.mjs "p99 latency spike on payments-service"
  node scripts/run.mjs "OOM crash on auth-service" --context "heap at 98%" --dry-run
`);
  process.exit(0);
}

const goal    = positionals.join(" ");
const BASE    = process.env.AGENTCORE_URL ?? "http://localhost:3000";
const TOKEN   = process.env.AGENTCORE_TOKEN ?? "";

const headers = {
  "Content-Type": "application/json",
  ...(TOKEN ? { "Authorization": `Bearer ${TOKEN}` } : {}),
};

// ─── Colours ──────────────────────────────────────────────────────────────────

const c = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  green:  "\x1b[32m",
  red:    "\x1b[31m",
  yellow: "\x1b[33m",
  blue:   "\x1b[34m",
  cyan:   "\x1b[36m",
};

function ok(msg)   { console.log(`${c.green}✓${c.reset} ${msg}`); }
function fail(msg) { console.error(`${c.red}✗${c.reset} ${msg}`); }
function info(msg) { console.log(`${c.dim}${msg}${c.reset}`); }
function step(n, name, dur) {
  const ms = dur < 1000 ? `${dur}ms` : `${(dur / 1000).toFixed(1)}s`;
  console.log(`  ${c.cyan}step ${n}${c.reset}  ${name.replace(/_/g, " ")}  ${c.dim}${ms}${c.reset}`);
}

// ─── Create task ─────────────────────────────────────────────────────────────

console.log(`\n${c.bold}AgentCore${c.reset}  ${c.dim}${BASE}${c.reset}`);
console.log(`${c.bold}Goal:${c.reset} ${goal}\n`);

let taskId, traceId, correlated;

try {
  const res = await fetch(`${BASE}/api/tasks`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      goal,
      context: flags.context,
      task_type: flags.task_type,
      dry_run: flags["dry-run"],
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    fail(`Failed to create task: ${res.status} — ${body.error ?? res.statusText}`);
    process.exit(1);
  }

  const body = await res.json();
  taskId    = body.task_id;
  traceId   = body.trace_id;
  correlated = body.correlated;

  if (correlated) {
    console.log(`${c.yellow}⚡ Correlated${c.reset} — similar investigation already running`);
    console.log(`   Task: ${taskId}  Trace: ${traceId}`);
    console.log(`   ${c.dim}${body.message}${c.reset}\n`);
  } else {
    info(`Task ${taskId}  Trace: ${traceId}${flags["dry-run"] ? "  [dry-run]" : ""}\n`);
  }
} catch (e) {
  fail(`Network error: ${e.message}`);
  process.exit(1);
}

// ─── Stream live updates ──────────────────────────────────────────────────────

info("Waiting for pipeline to complete…\n");

const seenSteps = new Set();

await new Promise((resolve, reject) => {
  const url = `${BASE}/api/tasks/${taskId}/stream`;
  // Node 18+ has built-in fetch with ReadableStream
  fetch(url, { headers }).then(async (res) => {
    if (!res.ok) { reject(new Error(`Stream ${res.status}`)); return; }
    const reader = res.body.getReader();
    const dec    = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) { resolve(); break; }

      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        try {
          const event = JSON.parse(line.slice(5).trim());

          if (event.connected) continue;

          // Checkpoint event
          if (event.step_number && event.step_status === "success" && !seenSteps.has(event.step_number)) {
            seenSteps.add(event.step_number);
            step(event.step_number, event.step_name, event.duration_ms ?? 0);
          }

          if (event.step_status === "failed" && event.error_info) {
            fail(`Step ${event.step_number} failed: ${event.error_info}`);
          }

          // Task terminal events
          if (event.status === "completed") { resolve(); break; }
          if (event.status === "failed")    { reject(new Error(event.error ?? "Task failed")); break; }
        } catch { /* malformed line */ }
      }
    }
  }).catch(reject);
});

// ─── Fetch and print final output ─────────────────────────────────────────────

console.log();
const taskRes  = await fetch(`${BASE}/api/tasks/${taskId}`, { headers });
const taskData = await taskRes.json();

if (taskData.status === "completed" && taskData.final_output) {
  let report;
  try { report = JSON.parse(taskData.final_output); } catch { report = null; }

  if (report) {
    ok(`Incident report\n`);
    console.log(`${c.bold}Summary${c.reset}`);
    console.log(`  ${report.summary}\n`);
    console.log(`${c.bold}Probable cause${c.reset}`);
    console.log(`  ${report.probable_cause}\n`);
    console.log(`${c.bold}Affected systems${c.reset}`);
    for (const s of report.affected_systems ?? []) console.log(`  • ${s}`);
    console.log(`\n${c.bold}Next actions${c.reset}`);
    for (const [i, a] of (report.next_actions ?? []).entries()) console.log(`  ${i + 1}. ${a}`);
    if (report.ticket_id) console.log(`\n${c.bold}Ticket${c.reset}  ${c.cyan}${report.ticket_id}${c.reset}`);
  } else {
    ok("Completed");
    console.log(taskData.final_output);
  }

  if (flags["dry-run"]) console.log(`\n${c.dim}Dry run — no memory written, no ticket created.${c.reset}`);
  console.log(`\n${c.dim}Export: ${BASE}/api/tasks/${taskId}/export.md${c.reset}\n`);
  process.exit(0);
}

if (taskData.status === "failed") {
  fail(taskData.error ?? "Task failed");
  console.log(`\n${c.dim}Resume: node scripts/run.mjs — then hit resume on ${BASE}/tasks/${taskId}${c.reset}\n`);
  process.exit(1);
}

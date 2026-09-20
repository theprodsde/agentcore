# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x (latest release) | ✅ |
| `main` branch | ✅ (best effort) |
| Older tags | ❌ |

## Reporting a vulnerability

Please **do not open a public issue** for security vulnerabilities.

Use [GitHub private vulnerability reporting](https://github.com/theprodsde/agentcore/security/advisories/new)
("Report a vulnerability" under the Security tab). You'll get an acknowledgement
within 72 hours and a fix or mitigation plan within 14 days for confirmed issues.

Include, where possible: affected endpoint or module, reproduction steps, and impact
(what an attacker gains). Proof-of-concept payloads are welcome.

## Scope notes for self-hosters

AgentCore is designed to run **inside your network, behind a reverse proxy**. Before
exposing it anywhere, work through the security checklist in
[PRODUCTION.md](PRODUCTION.md) — in particular:

- `JWT_SECRET` unset means **auth is disabled** (deliberate for local development, dangerous anywhere else).
- `SLACK_SIGNING_SECRET` and the webhook secrets gate the public ingestion endpoints; leave them unset only in development.
- AgentCore does not terminate TLS and does not rate-limit — your proxy should do both.

Reports about deployments that ignore that checklist (e.g. "auth is off when JWT_SECRET
is unset") are working as documented, not vulnerabilities — but if the documentation
misled you, that's a bug worth filing.

## Prompt injection — known surface, bounded by design

Log lines, alert payloads, and runbook text flow into the planner and synthesizer
LLM prompts, and an attacker who can write to your logs can influence that text.
The blast radius is deliberately bounded:

- **Nothing executes after synthesis.** The LLM's output is a report; AgentCore never
  runs remediation commands, so injected instructions cannot trigger actions.
- **Tool arguments are Zod-validated** in the tool server, and side-effect tools
  (`create_ticket`) are skipped on dry runs and never cached.
- Worst realistic outcome: a misleading report, ticket, or memory entry. Treat AI
  findings as triage input, not ground truth — that's also why the checkpoint record
  preserves the raw tool output for human verification.

Reports that *escalate* beyond this boundary (e.g. injected content causing tool
execution outside the validated plan) are very much in scope — please report them.

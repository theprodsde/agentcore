# Launch checklist

Track external publishing steps. Items marked [AUTO] have a script below.

## GitHub setup [AUTO]

```bash
# 1. Authenticate (one-time)
gh auth login

# 2. Enable Discussions
gh api repos/TheProdSDE/agentcore --method PATCH -f has_discussions=true

# 3. Create labels
gh label create "good first issue" --color 7057ff --description "Good for newcomers" --repo TheProdSDE/agentcore 2>/dev/null || true
gh label create "tool-integration" --color 0e8a16 --description "New MCP tool backend" --repo TheProdSDE/agentcore 2>/dev/null || true
gh label create "bug" --color d73a4a --description "Something isn't working" --repo TheProdSDE/agentcore 2>/dev/null || true

# 4. Create good first issues
gh issue create --repo TheProdSDE/agentcore \
  --label "good first issue" --label "tool-integration" \
  --title "Tool integration: Elasticsearch/Kibana backend for search_logs" \
  --body "$(sed -n '/^## Issue 1$/,/^---/p' .github/GOOD_FIRST_ISSUES.md | tail -n +5 | head -n -2)"

gh issue create --repo TheProdSDE/agentcore \
  --label "good first issue" --label "tool-integration" \
  --title "Tool integration: GitHub Issues backend for create_ticket" \
  --body "$(sed -n '/^## Issue 2$/,/^---/p' .github/GOOD_FIRST_ISSUES.md | tail -n +5 | head -n -2)"

gh issue create --repo TheProdSDE/agentcore \
  --label "good first issue" --label "tool-integration" \
  --title "Tool integration: Grafana annotations tool (annotate_incident)" \
  --body "$(sed -n '/^## Issue 3$/,/^$/p' .github/GOOD_FIRST_ISSUES.md | tail -n +5)"

# 5. Tag release (triggers GHCR publish via release.yml)
git tag v0.1.0
git push origin v0.1.0
```

## GIF recording [SEMI-AUTO]

```bash
# Start demo stack (detached)
docker compose -f docker-compose.demo.yml up -d

# Wait ~15s for Postgres to be ready, then record
sleep 15
vhs demo.tape
# → outputs .github/assets/mcp-demo.gif

docker compose -f docker-compose.demo.yml down
```

After recording, add to README.md under the "Try it in 90 seconds" section:
```markdown
![MCP Demo](.github/assets/mcp-demo.gif)
```

## Directory submissions [MANUAL]

### 1. awesome-mcp-servers
- Repo: https://github.com/punkpeye/awesome-mcp-servers
- PR: add one line under a suitable category (e.g. "Productivity / DevOps"):
  ```markdown
  - [agentcore](https://github.com/TheProdSDE/agentcore) — Self-hosted AI incident triage with checkpointed resume and episodic memory. Exposes investigate/memory/export tools via MCP.
  ```

### 2. mcp.so
- URL: https://mcp.so (submit form)
- Name: AgentCore
- Description: Self-hosted AI incident triage. Runs a 4-step pipeline (memory → plan → MCP tools → synthesize) on your alerts and posts the analysis back to Slack in ~30 seconds. Checkpointed resume, pgvector episodic memory, Apache-2.0.
- Repo: https://github.com/TheProdSDE/agentcore
- Tools: investigate_incident, get_investigation, search_incident_memory, export_postmortem

### 3. pulsemcp.com
- URL: https://www.pulsemcp.com/submit
- Same info as mcp.so above.

### 4. glama.ai
- URL: https://glama.ai/mcp/servers/submit
- Same info.

## Blog post [MANUAL]

File: theprodsde.github.io/content/blog/agentcore-checkpointed-incident-triage.mdx
Action: commit + push to deploy. Verify at https://theprodsde.github.io/blog/agentcore-checkpointed-incident-triage

## Hacker News / Reddit [MANUAL — do after v0.1.0 is tagged]

### HN "Show HN" draft
```
Show HN: AgentCore – self-hosted AI incident triage with checkpointed resume

When an alert fires, AgentCore runs a 4-step pipeline: recall similar past 
incidents from pgvector memory, plan tool calls with an LLM, query your 
Loki/Prometheus/runbooks via MCP, synthesize a post-mortem — and posts the 
analysis back to Slack in ~30 seconds.

The two things that differentiate it: checkpointed resume (crash mid-investigation 
→ resumes from the failed step, not from scratch) and episodic memory (after 50 
incidents, the planner knows what fixed that DB deadlock last time). 
No incident data leaves your network — works with Ollama.

Zero credentials needed to try the full stack: two docker compose commands and 
a curl. Apache-2.0.

https://github.com/TheProdSDE/agentcore
```

### r/selfhosted and r/devops
Use the same summary, shorter: "Self-hosted AI incident triage — no SaaS, no data leaving your network, checkpointed so a crash doesn't lose your investigation context."

## GitHub Discussions seed posts [MANUAL — after Discussions is enabled]

Create a "General" category, then post:

**Post 1 — Deployment stories**
Title: "Share how you've deployed AgentCore"
Body: "What stack are you running it against? Loki/Prometheus, ELK, Datadog? Local Ollama model or OpenAI? Any gotchas with the Docker setup? Happy to help troubleshoot here."

**Post 2 — Roadmap feedback**
Title: "What would make you switch from PagerDuty AIOps / incident.io?"
Body: "Genuinely curious what the blockers are. Configurable embedding dims for Ollama? A richer webhook schema? Auto-remediation actions? Helps prioritize the roadmap."

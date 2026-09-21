# AgentCore demo — recorded with VHS
# Prereq: server already running at localhost:3000
# Run: vhs demo.tape  →  .github/assets/mcp-demo.gif

Output .github/assets/mcp-demo.gif

Set Shell "bash"
Set FontSize 13
Set Width 1000
Set Height 580
Set Theme "Catppuccin Mocha"
Set Padding 24
Set TypingSpeed 50ms
Set WaitTimeout 45s

# ── Trigger an investigation ──────────────────────────────────────────────────
Type "# Trigger incident investigation"
Enter
Sleep 0.4s
Type `curl -s -X POST http://localhost:3000/api/tasks \`
Enter
Type `  -H 'Content-Type: application/json' \`
Enter
Type `  -d '{"goal":"payments-service p99 latency at 4s after deploy"}' | jq '{id,status,goal}'`
Sleep 0.8s
Enter
Sleep 5s

# ── Grab task id and poll status ──────────────────────────────────────────────
Type `TASK=$(curl -s http://localhost:3000/api/tasks | jq -r '.[0].id')`
Enter
Sleep 1s
Type `curl -s http://localhost:3000/api/tasks/$TASK | jq '{status,steps: (.checkpoints|length)}'`
Enter
Sleep 5s

# ── Export post-mortem ────────────────────────────────────────────────────────
Type "# Export post-mortem"
Enter
Sleep 0.3s
Type `curl -s http://localhost:3000/api/tasks/$TASK/export.md`
Enter
Sleep 5s

# ── Semantic memory search ───────────────────────────────────────────────────
Type "# Memory: next time this fires, the planner already knows the fix"
Enter
Sleep 0.3s
Type `curl -s 'http://localhost:3000/api/memory?q=payments+latency' | jq '.[0] | {score,summary}'`
Enter
Sleep 4s

Sleep 2s

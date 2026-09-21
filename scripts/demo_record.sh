#!/usr/bin/env bash
# Demo script for asciinema recording — prereq: server at localhost:3000

sleep 0.5
echo "# AgentCore — AI incident triage in ~30 seconds"
echo ""
sleep 1

echo "# 1. Trigger an investigation"
sleep 0.4
echo '$ curl -s -X POST localhost:3000/api/tasks \'
echo '    -d '"'"'{"goal":"payments-service p99 latency at 4s after deploy"}'"'"' | jq '"'"'{task_id,status}'"'"
sleep 0.3
RESULT=$(curl -s -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"goal":"payments-service p99 latency at 4s after deploy"}')
echo "$RESULT" | jq '{task_id,status}'
TASK=$(echo "$RESULT" | jq -r '.task_id')
sleep 5

echo ""
echo "# 2. Check checkpoint progress (4 steps: recall → plan → tools → synthesize)"
sleep 0.4
echo "$ curl -s localhost:3000/api/tasks/\$TASK_ID | jq '{status, steps: (.checkpoints|length)}'"
sleep 0.3
curl -s "http://localhost:3000/api/tasks/$TASK" | jq '{status, steps: (.checkpoints|length)}'
sleep 3

echo ""
echo "# 3. Export the AI-synthesized post-mortem"
sleep 0.4
echo "$ curl -s localhost:3000/api/tasks/\$TASK_ID/export.md | head -22"
sleep 0.3
curl -s "http://localhost:3000/api/tasks/$TASK/export.md" | head -22
sleep 4

echo ""
echo "# 4. Episodic memory — next alert will retrieve this as context"
sleep 0.4
echo "$ curl -s 'localhost:3000/api/memory?q=payments+latency' | jq '.items[0] | {score,outcome}'"
sleep 0.3
curl -s "http://localhost:3000/api/memory?q=payments+latency" | jq '.items[0] | {score,outcome}'
sleep 3

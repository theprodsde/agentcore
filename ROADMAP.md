# Roadmap

## Done

**Platform foundation**
- Environment and config with Zod validation
- In-memory task, checkpoint, and memory stores
- Structured logging via Pino

**Orchestration core**
- 4-step pipeline: memory retrieval → planning → MCP tool execution → synthesis
- Per-step checkpointing with resume from last failed step
- OpenAI-compatible LLM client (planner + synthesizer)
- MCP client integration via `@modelcontextprotocol/sdk`

**Task lifecycle**
- Task creation, listing, and detail APIs
- Live step-by-step status stream (SSE)
- Manual resume API for failed tasks

**Memory system**
- Episodic memory write on task completion
- Memory retrieval API
- Memory-enriched planning (loaded into planner context)

**Integrations**
- Slack event ingestion (`!incident <description>` trigger)
- Slack Block Kit response formatting
- Slack working memory per channel

**Frontend**
- React SPA with React Router
- Dashboard, Task Detail with checkpoint timeline, Memory Explorer
- Demo scenario page (pre-built one-click flows)

---

## Up next

- [ ] **Persistent storage** — swap `inMemoryDB` for Postgres (Drizzle ORM) + Redis for the task queue; tasks survive restarts
- [ ] **Observability** — OpenTelemetry traces per task; exportable to Jaeger / Grafana Tempo
- [ ] **Real MCP tools** — connect to actual log-search, metrics, and alerting tool servers
- [ ] **Semantic memory retrieval** — replace word-frequency similarity with vector embeddings (pgvector)
- [ ] **Auth** — JWT-based API auth; per-user task isolation
- [ ] **Webhook replay** — Slack signing secret verification and retry deduplication
- [ ] **Multi-step planner** — allow the planner to emit dynamic tool lists rather than a fixed 4-step pipeline
- [ ] **CLI** — `agentcore run "<incident description>"` for scripted/CI use

# AgentCore Incident Commander

**AgentCore** is an automation platform built natively for real-time recovery. It leverages episodic memory, parallel tool execution, and deterministic failure resilience to triage service interruptions directly from Slack or a Dashboard.

## Architecture Highlights
- **Task Resilience & Checkpointing**: Every workflow step is persisted dynamically. If a pod crashes midway, AgentCore's orchestrator resumes exactly where it failed, without redundantly querying data.
- **Episodic Memory Retrieval**: Each successful incident automatically seeds the contextual memory log so the LLM planner doesn't repeat identical queries on similar recurring incidents.
- **Dual Flow Output**: Designed to interoperate elegantly via both Slack (Incident Commands / Webhooks) and a rich Web Dashboard (Trace Views).
- **Docker-Ready**: Works out of the box using Node environment. Easily mounts a full production build on ARM64 or AMD64.

## Getting Started

### Local Setup with CometAPI (No Gemini Key Required)

Because AgentCore supports standard OpenAI-compatible endpoints (such as `COMET_API_BASE_URL`), you do **not** need a Gemini API key or external cloud LLM to run the application locally or in a sandbox. It fully supports CometAPI for inference, making the backend completely self-contained.

### Quickstart with Docker Compose

1. Add your API credentials inside `docker-compose.yml` (replace `YOUR_API_KEY_HERE` with the true key).
2. Start the integrated environment via Docker:
   ```bash
   docker-compose up --build
   ```
3. AgentCore will now be accessible at `http://localhost:3000`.

### Manual Local Setup (Node JS)

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Configure Environment variables**
   Create a `.env` file based on `.env.example`:
   ```bash
   cp .env.example .env
   # Set OPENAI_API_KEY and COMET_API_BASE_URL. No need for GEMINI_API_KEY.
   # Set up Slack Tokens if testing Slack integrations natively.
   ```

3. **Start Dev Server**
   ```bash
   npm run dev
   ```
   Or explicitly build and run the production compiled server:
   ```bash
   npm run build
   npm run start
   ```

## Demo Script (Judging Outline)

The `DemoScenarios.tsx` Playground tab provides one-click workflows for judging demonstrations.
*   **Run 1 - Resilient Recovery**: Click *Run Recovery Flow*. Mid-execution, the agent will throw an artificial exception. Wait for the `Failure/Paused` state, then press the `Resume` button to demonstrate checkpointed state-preservation.
*   **Run 2 - Slack Action Mocking**: Trigger the second scenario to demonstrate standard tool interaction and view the resulting action plan.
*   **Run 3 - Episodic Verification**: Visit the Memory Explorer to review the embedded semantic records of previous incident outputs.

> Note: To demonstrate Slack end-to-end functionality, point the Slack `Request URL`/`Event Subscriptions` directly to `/api/slack/events` behind an Ngrok tunnel if developing locally.

## File Breakdown

- `/src/server/executor.ts` – The backbone procedural loop that drives simulated MCP capabilities and tracks latency.
- `/src/server/db.ts` – Mocked DB storing Checkpoint execution logs, Tasks, and Memories.
- `/src/pages` – Clean layered React SPA displaying the UI logic.
- `/server.ts` - Node/Express proxy mapping to Vite + API Routes. No direct API keys are touched by the front-end JS.

import React, { useState, useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { store, RootState } from "./store";
import {
  addIncident,
  updateIncident,
  appendLogs,
  setActiveIncidentId,
  setMemoryPool,
  addMemory,
  setSimulationRunning,
  setServerStatus,
} from "./store/agentSlice";
import {
  Activity,
  Terminal,
  ArrowRight,
  Lock,
  Database,
  Cpu,
  Layers,
  Search,
  Plus,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  FileCode,
  Code,
  Clock,
  Send,
  Play,
  HelpCircle,
  Check,
  Trash,
  Zap,
  Network,
  ShieldAlert,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { CODE_SNIPPETS } from "./data/code_snippets";
import { PRESET_INCIDENTS, DEFAULT_MEMORIES } from "./data/mock_data";
import {
  SimulatedIncident,
  CheckpointRecord,
  EpisodicMemory,
  CodeSnippet,
} from "./types";

export default function App() {
  const dispatch = useDispatch();
  // Navigation tabs
  const [activeTab, setActiveTab] = useState<
    "simulator" | "architecture" | "memories" | "recovery"
  >("simulator");

  // Connection and API Key states
  const serverStatus = useSelector(
    (state: RootState) => state.agent.serverStatus,
  );

  // Simulator States
  const incidents = useSelector((state: RootState) => state.agent.incidents);
  const [selectedPreset, setSelectedPreset] = useState<number>(0);
  const [customTitle, setCustomTitle] = useState("");
  const [customDesc, setCustomDesc] = useState("");
  const [customSeverity, setCustomSeverity] = useState<
    "low" | "medium" | "high" | "critical"
  >("high");
  const [customChannel, setCustomChannel] = useState("#ops-incident-room");

  const activeIncidentId = useSelector(
    (state: RootState) => state.agent.activeIncidentId,
  );
  const simulationRunning = useSelector(
    (state: RootState) => state.agent.simulationRunning,
  );
  const [simulationTime, setSimulationTime] = useState(0);
  const simulationTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Memories Panel States
  const memoryPool = useSelector((state: RootState) => state.agent.memoryPool);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchedMemories, setSearchedMemories] =
    useState<EpisodicMemory[]>(DEFAULT_MEMORIES);
  const [isSearchingMemory, setIsSearchingMemory] = useState(false);

  // Custom Memory Creator State
  const [newMemoryGoal, setNewMemoryGoal] = useState("");
  const [newMemoryOutcome, setNewMemoryOutcome] = useState("");
  const [newMemorySuccess, setNewMemorySuccess] = useState(false);

  // Code Inspector state
  const [selectedCodePath, setSelectedCodePath] = useState<string>(
    "shared/agent_core/orchestrator.py",
  );
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  // Terminal scroll helper
  const terminalEndRef = useRef<HTMLDivElement | null>(null);

  // Check backend server status
  const checkServer = async () => {
    dispatch(setServerStatus({ ...serverStatus, checking: true }));
    try {
      const res = await fetch("/api/health");
      const data = await res.json();
      dispatch(
        setServerStatus({
          ok: data.status === "ok",
          hasKey: data.llmConfigured,
          checking: false,
        }),
      );
    } catch (e) {
      dispatch(setServerStatus({ ok: false, hasKey: false, checking: false }));
    }
  };

  useEffect(() => {
    checkServer();
  }, []);

  // Update searched memories on local memory pool change
  useEffect(() => {
    setSearchedMemories(memoryPool);
  }, [memoryPool]);

  // Terminal scroll to bottom helper
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [simulationRunning, activeIncidentId, incidents]);

  // Handle preset selector change
  const handlePresetSelect = (idx: number) => {
    setSelectedPreset(idx);
    setCustomTitle("");
    setCustomDesc("");
  };

  // Launch simulated incident commander run
  const triggerIncidentSim = async () => {
    if (simulationRunning) return;

    let title = PRESET_INCIDENTS[selectedPreset].title;
    let description = PRESET_INCIDENTS[selectedPreset].description;
    let severity = PRESET_INCIDENTS[selectedPreset].severity;
    let channel = PRESET_INCIDENTS[selectedPreset].channel;

    if (customTitle.trim()) {
      title = customTitle;
      description =
        customDesc ||
        "Manual diagnostic command context provided via administrator dashboard.";
      severity = customSeverity;
      channel = customChannel;
    }

    const newIncidentId = `inc-${Date.now().toString().slice(-6)}`;
    const traceId = `tr-${Math.random().toString(36).substring(2, 11)}`;

    const freshIncident: SimulatedIncident = {
      id: newIncidentId,
      title,
      description,
      severity,
      status: "running",
      channel,
      logs: [
        `[${new Date().toLocaleTimeString()}] [EVENT_BROKER] Webhook event received from Slack Channel: ${channel}`,
        `[${new Date().toLocaleTimeString()}] [SYSTEM] Captured incident context. Instantiating unique Trace Context: ${traceId}`,
        `[${new Date().toLocaleTimeString()}] [DISTRIBUTED_LOCK] Acquiring idempotency mutex step_lock:${newIncidentId}:1 in Redis cluster...`,
        `[${new Date().toLocaleTimeString()}] [DISTRIBUTED_LOCK] Mutex secured. Preventing duplicated Slack API request retries.`,
        `[${new Date().toLocaleTimeString()}] [CHECKPOINTER] Initializing database transaction for Step 1 Checklist...`,
      ],
      createdAt: new Date().toISOString(),
      traceId,
      checkpoints: [
        {
          stepNumber: 1,
          stepName: "Cognitive Planning & Memory Retrieval",
          stepStatus: "running",
        },
        {
          stepNumber: 2,
          stepName: "MCP Tool Diagnostics (Postgres Stat & K8s)",
          stepStatus: "pending",
        },
        {
          stepNumber: 3,
          stepName: "Synthesis & Remediation Automation",
          stepStatus: "pending",
        },
      ],
      memoryHits: [],
    };

    dispatch(addIncident(freshIncident));
    dispatch(setActiveIncidentId(newIncidentId));
    dispatch(setSimulationRunning(true));
    setSimulationTime(0);

    // Start UI Millisecond Timer
    if (simulationTimerRef.current) clearInterval(simulationTimerRef.current);
    simulationTimerRef.current = setInterval(() => {
      setSimulationTime((prev) => prev + 10);
    }, 10);

    try {
      // Step 1 semantic search simulation on local server
      const searchRes = await fetch("/api/memory/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: description, memories: memoryPool }),
      });
      const searchData = await searchRes.json();
      // Filter out high matching memories (> 0.6 similarity) as matched episodic records
      const simulatedHits = (searchData.matches || []).filter(
        (m: any) => (m.similarity || 0) >= 0.6,
      );

      // Trigger server-side Gemini simulation endpoint
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, severity, channel }),
      });

      if (!res.ok) throw new Error("Server model execution pipeline failed.");

      const data = await res.json();

      // Gracefully advance checkpoints on UI timeline
      await new Promise((r) => setTimeout(r, 1200)); // wait brief cinematic delay

      dispatch(
        updateIncident({
          id: newIncidentId,
          changes: {
            checkpoints: [
              {
                stepNumber: 1,
                stepName: "Cognitive Planning & Memory Retrieval",
                stepStatus: "success",
                outputData: data.plannerOutput.plan,
                durationMs: Math.floor(Math.random() * 800) + 700,
              },
              {
                stepNumber: 2,
                stepName: "MCP Tool Diagnostics (Postgres Stat & K8s)",
                stepStatus: "running",
              },
              {
                stepNumber: 3,
                stepName: "Synthesis & Remediation Automation",
                stepStatus: "pending",
              },
            ],
            memoryHits: simulatedHits,
          },
        }),
      );

      dispatch(
        appendLogs({
          id: newIncidentId,
          logs: [
            `[${new Date().toLocaleTimeString()}] [COGNITIVE_PLAN] AI Planner completed. Semantic check queried vector embeddings.`,
            ...simulatedHits.map(
              (h: any) =>
                `[pgvector ENG] Historic hit [${h.id}] similarity: ${(h.similarity * 100).toFixed(1)}% | ${h.goal}`,
            ),
            `[${new Date().toLocaleTimeString()}] [COGNITIVE_PLAN] Memory retrieved past solution: ${data.suggestedMemory?.outcome || "No dense memory matched above threshold."}`,
            `[${new Date().toLocaleTimeString()}] [ORCHESTRATOR] Advancing to Step 2. Locking transaction step_lock:${newIncidentId}:2...`,
            `[${new Date().toLocaleTimeString()}] [MCP_ENGINE] Invoking secure tools: kubectl logs -n default, database diagnostics...`,
            `[${new Date().toLocaleTimeString()}] [MCP_ENGINE] Tool outcome received: ${data.plannerOutput.steps[1]?.outputData || "Process executed successfully."}`,
          ],
        }),
      );

      await new Promise((r) => setTimeout(r, 1500)); // wait step 3

      const incBeforeStep3 = store
        .getState()
        .agent.incidents.find((i) => i.id === newIncidentId);
      if (!incBeforeStep3) return;

      const step1Duration = 1150;
      const step2Duration = Math.floor(Math.random() * 1000) + 900;
      const step3Duration = Math.floor(Math.random() * 800) + 500;
      const totalElapsedTime = step1Duration + step2Duration + step3Duration;

      dispatch(
        updateIncident({
          id: newIncidentId,
          changes: {
            status: "completed",
            durationMs: totalElapsedTime,
            finalOutput: data.remediation.report,
            summary: data.remediation.actionTaken,
            checkpoints: [
              incBeforeStep3.checkpoints[0],
              {
                stepNumber: 2,
                stepName: "MCP Tool Diagnostics (Postgres Stat & K8s)",
                stepStatus: "success",
                outputData: data.plannerOutput.steps[1]?.outputData,
                durationMs: step2Duration,
              },
              {
                stepNumber: 3,
                stepName: "Synthesis & Remediation Automation",
                stepStatus: "success",
                outputData: data.remediation.actionTaken,
                durationMs: step3Duration,
              },
            ],
          },
        }),
      );

      dispatch(
        appendLogs({
          id: newIncidentId,
          logs: [
            `[${new Date().toLocaleTimeString()}] [MCP_ENGINE] Step 2 finished in ${step2Duration}ms.`,
            `[${new Date().toLocaleTimeString()}] [ORCHESTRATOR] Advancing to Step 3. Dynamic synthesis loading...`,
            `[${new Date().toLocaleTimeString()}] [SYNTHESIS] Acting post-mortem generation. Mitigating network state or connections...`,
            `[${new Date().toLocaleTimeString()}] [SYNTHESIS] Action taken: ${data.remediation.actionTaken}`,
            `[${new Date().toLocaleTimeString()}] [SYSTEM] Telemetry trace data successfully shipped to OpenTelemetry collector (Jaeger) on localhost:4317`,
            `[${new Date().toLocaleTimeString()}] [SLACK_API] Dispatching rich incident summary to channel ${incBeforeStep3.channel}...`,
            `[${new Date().toLocaleTimeString()}] [SYSTEM] Mutex lock released on Redis. Incident Commander gracefully completed in ${totalElapsedTime}ms.`,
          ],
        }),
      );

      // Add auto episodic memory matching current incident
      const newlyFormedMemory: EpisodicMemory = {
        id: `mem-${Math.round(Math.random() * 1000)}`,
        userId: "slack-incident-commander",
        taskId: newIncidentId,
        goal: `Resolve incident: ${title}`,
        outcome: data.remediation.actionTaken,
        createdAt: new Date().toISOString(),
      };

      // Store new memory in user transient list so they can search it immediately!
      setTimeout(() => {
        dispatch(addMemory(newlyFormedMemory));
      }, 100);
    } catch (err: any) {
      console.error(err);
      dispatch(
        updateIncident({
          id: newIncidentId,
          changes: { status: "failed" },
        }),
      );
      dispatch(
        appendLogs({
          id: newIncidentId,
          logs: [
            `[ERROR] Simulation crashed: ${err.message}`,
            `[CHECKPOINTER] Transaction rolled back. Checkpoint marked as FAILED.`,
          ],
        }),
      );
    } finally {
      if (simulationTimerRef.current) clearInterval(simulationTimerRef.current);
      dispatch(setSimulationRunning(false));
    }
  };

  // Memory Vector Search Command Panel
  const runMemoryVectorSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) {
      setSearchedMemories(memoryPool);
      return;
    }

    setIsSearchingMemory(true);
    try {
      const res = await fetch("/api/memory/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery, memories: memoryPool }),
      });
      if (res.ok) {
        const data = await res.json();
        setSearchedMemories(data.matches || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSearchingMemory(false);
    }
  };

  // Add custom manual Memory
  const createManualMemory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemoryGoal.trim() || !newMemoryOutcome.trim()) return;

    const added: EpisodicMemory = {
      id: `mem-manual-${Math.round(Math.random() * 1000)}`,
      userId: "administrator-manual",
      goal: newMemoryGoal,
      outcome: newMemoryOutcome,
      createdAt: new Date().toISOString(),
    };

    dispatch(addMemory(added));
    setNewMemoryGoal("");
    setNewMemoryOutcome("");
    setNewMemorySuccess(true);
    setTimeout(() => setNewMemorySuccess(false), 3000);
  };

  // Delete Memory from DB simulator
  const removeMemory = (id: string) => {
    dispatch(setMemoryPool(memoryPool.filter((m) => m.id !== id)));
  };

  // Copy code to clipboard helper
  const handleCopyCode = (text: string, path: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPath(path);
    setTimeout(() => setCopiedPath(null), 2000);
  };

  const activeIncident =
    incidents.find((i) => i.id === activeIncidentId) || incidents[0];

  return (
    <div
      className="min-h-screen bg-[#0b0f19] text-[#f1f5f9] flex flex-col font-sans"
      id="commander-app"
    >
      {/* 1. Header & System Node Status */}
      <header className="border-b border-[#1e293b] bg-[#0d1527] px-6 py-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-emerald-500/10 rounded border border-emerald-500/20 text-emerald-400">
              <Zap className="w-5 h-5 animate-pulse" />
            </span>
            <h1 className="text-xl font-bold font-display tracking-tight text-white flex items-center gap-2">
              Slack Incident Commander
            </h1>
          </div>
          <p className="text-xs text-[#94a3b8] mt-1">
            Dual Submission Playground | GPT-4o-Mini Memory Runtime | E2E Target
            &lt; 10s
          </p>
        </div>

        {/* Server Connections Dashboard */}
        <div className="flex flex-wrap items-center gap-3 bg-[#131f37] px-3.5 py-2 rounded-lg border border-[#1e2e4f] text-xs">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[#94a3b8]">Express Core:</span>
            {serverStatus.checking ? (
              <RefreshCw className="w-3 h-3 animate-spin text-amber-400" />
            ) : serverStatus.ok ? (
              <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5" /> Ready
              </span>
            ) : (
              <span className="flex items-center gap-1 text-rose-400 font-semibold">
                <XCircle className="w-3.5 h-3.5" /> Disconnected
              </span>
            )}
          </div>

          <div className="h-4 w-px bg-[#1e2e4f]" />

          <div className="flex items-center gap-2">
            <span className="font-mono text-[#94a3b8]">
              OpenAI / Comet Proxy:
            </span>
            {serverStatus.checking ? (
              <span className="text-amber-400">checking...</span>
            ) : serverStatus.hasKey ? (
              <span className="text-emerald-400 font-semibold flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> Cloud Keys Attached
              </span>
            ) : (
              <span
                className="text-amber-400 font-semibold flex items-center gap-1"
                title="Falling back to advanced procedural AI planner simulator. Check Settings > Secrets."
              >
                <AlertCircle className="w-3.5 h-3.5" /> Local Simulation Mode
              </span>
            )}
          </div>
        </div>
      </header>

      {/* 2. Primary Sub-Navigation Row */}
      <nav className="bg-[#0e1628] border-b border-[#1e293b] px-6 py-2.5 flex flex-wrap gap-2 text-sm justify-between items-center">
        <div className="flex gap-1.5 overflow-x-auto">
          <button
            id="nav-tab-simulator"
            onClick={() => setActiveTab("simulator")}
            className={`px-4 py-2 rounded-md font-medium tracking-wide transition-all duration-200 flex items-center gap-2 ${
              activeTab === "simulator"
                ? "bg-[#1d4ed8] text-white border border-[#3b82f6] shadow-md shadow-blue-900/30"
                : "text-slate-400 hover:text-white hover:bg-slate-800"
            }`}
          >
            <Activity className="w-4 h-4" /> Incident Simulator Console
          </button>

          <button
            id="nav-tab-memories"
            onClick={() => setActiveTab("memories")}
            className={`px-4 py-2 rounded-md font-medium tracking-wide transition-all duration-200 flex items-center gap-2 ${
              activeTab === "memories"
                ? "bg-[#1d4ed8] text-white border border-[#3b82f6] shadow-md shadow-blue-900/30"
                : "text-slate-400 hover:text-white hover:bg-slate-800"
            }`}
          >
            <Database className="w-4 h-4" /> Episodic Memory (pgvector RDMS)
          </button>
        </div>

        {/* Global Latency target marker */}
        <div className="hidden md:flex items-center gap-2.5 font-mono text-xs text-[#94a3b8] bg-slate-900/60 px-3 py-1.5 rounded border border-slate-800">
          <span>Latency Metric Target:</span>
          <span className="text-emerald-400 font-bold flex items-center gap-1">
            <Clock className="w-3 h-3 text-emerald-400" /> &lt; 10,000ms SLA
          </span>
        </div>
      </nav>

      {/* 3. Primary Content Stage */}
      <main className="flex-1 p-6 max-w-[1700px] w-full mx-auto flex flex-col gap-6">
        {/* TAB 1: INCIDENT SIMULATOR CONSOLE */}
        {activeTab === "simulator" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Side: Incident Controller Panel */}
            <div
              className="lg:col-span-4 flex flex-col gap-6"
              id="panel-incident-controller"
            >
              {/* Presets Grid */}
              <div className="bg-[#111827] rounded-xl border border-[#1e293b] p-5 shadow-lg">
                <h3 className="text-sm font-semibold text-white uppercase tracking-wider font-display mb-3">
                  Preset Production Alerts
                </h3>
                <div className="grid grid-cols-1 gap-2.5">
                  {PRESET_INCIDENTS.map((preset, idx) => (
                    <button
                      key={idx}
                      onClick={() => handlePresetSelect(idx)}
                      className={`text-left p-3.5 rounded-lg border transition-all text-xs flex flex-col gap-1.5 ${
                        selectedPreset === idx && !customTitle
                          ? "bg-[#1d4ed8]/10 border-blue-500/80 text-white"
                          : "bg-slate-900/60 border-slate-800/80 hover:border-slate-700 text-slate-300"
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <span className="font-semibold font-sans">
                          {preset.title}
                        </span>
                        <span
                          className={`text-[9px] uppercase px-1.5 py-0.5 rounded font-mono font-bold ${
                            preset.severity === "critical"
                              ? "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                              : "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                          }`}
                        >
                          {preset.severity}
                        </span>
                      </div>
                      <p
                        className="text-slate-400 font-mono leading-relaxed truncate"
                        style={{ maxWidth: "340px" }}
                      >
                        {preset.description}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom Incident Creator */}
              <div className="bg-[#111827] rounded-xl border border-[#1e293b] p-5 shadow-lg">
                <div className="flex items-center justify-between mb-3.5">
                  <h3 className="text-sm font-semibold text-white uppercase tracking-wider font-display">
                    Custom Incident Webhook Trigger
                  </h3>
                  {(customTitle || customDesc) && (
                    <button
                      onClick={() => {
                        setCustomTitle("");
                        setCustomDesc("");
                      }}
                      className="text-xs text-blue-400 hover:underline font-mono"
                    >
                      Clear override
                    </button>
                  )}
                </div>

                <div className="flex flex-col gap-3 text-xs font-mono">
                  <div>
                    <label className="text-slate-400 block mb-1">
                      Slack Title (Simulated Incident):
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Memory leak in cache pods"
                      value={customTitle}
                      onChange={(e) => setCustomTitle(e.target.value)}
                      className="w-full bg-[#0d131f] border border-slate-800 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1">
                      Diagnostic Log Description:
                    </label>
                    <textarea
                      placeholder="e.g. AWS Alerts report continuous node pressure on production nodes..."
                      value={customDesc}
                      row-span="2"
                      onChange={(e) => setCustomDesc(e.target.value)}
                      className="w-full bg-[#0d131f] border border-slate-800 rounded px-3 py-2 text-white h-20 focus:outline-none focus:border-blue-500 resize-none font-mono"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-slate-400 block mb-1">
                        Severity:
                      </label>
                      <select
                        value={customSeverity}
                        onChange={(e: any) => setCustomSeverity(e.target.value)}
                        className="w-full bg-[#0d131f] border border-slate-800 rounded px-2.5 py-1.5 text-white focus:outline-none focus:border-blue-500"
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="critical">Critical</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-slate-400 block mb-1">
                        Slack Channel Target:
                      </label>
                      <input
                        type="text"
                        value={customChannel}
                        onChange={(e) => setCustomChannel(e.target.value)}
                        className="w-full bg-[#0d131f] border border-slate-800 rounded px-2.5 py-1.5 text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                </div>

                <button
                  onClick={triggerIncidentSim}
                  disabled={simulationRunning}
                  className="w-full mt-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-850 disabled:text-slate-400 text-white font-semibold py-2.5 rounded-lg border border-emerald-500 flex items-center justify-center gap-2 transition-all cursor-pointer font-display text-xs"
                >
                  {simulationRunning ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />{" "}
                      Orchestrating Clean Recovery...
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-white" /> Engage Incident
                      Commander
                    </>
                  )}
                </button>
              </div>

              {/* SLA Metrics Panel */}
              <div className="bg-[#111827] rounded-xl border border-[#1e293b] p-5 shadow-lg relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-2xl pointer-events-none" />
                <h3 className="text-sm font-semibold text-white uppercase tracking-wider font-display mb-3">
                  SLA & Run-Time Telemetry Metrics
                </h3>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-slate-400 block uppercase font-mono">
                      Total Runs:
                    </span>
                    <span className="text-xl font-bold text-white font-mono">
                      {incidents.length || 0}
                    </span>
                  </div>
                  <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-slate-400 block uppercase font-mono">
                      Memories Stored:
                    </span>
                    <span className="text-xl font-bold text-teal-400 font-mono">
                      {memoryPool.length}
                    </span>
                  </div>
                  <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-slate-400 block uppercase font-mono">
                      Sim CPU SLA:
                    </span>
                    <span className="text-xs font-bold text-emerald-400 font-mono flex items-center gap-1 mt-1">
                      <Clock className="w-3.5 h-3.5" /> &lt; 4000ms/step
                    </span>
                  </div>
                  <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-slate-400 block uppercase font-mono">
                      Resolution SLA Rate:
                    </span>
                    <span className="text-xs font-bold text-blue-400 font-mono flex items-center gap-1 mt-1">
                      <Zap className="w-3.5 h-3.5" /> 100% Mitigated
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Side: Log Console and Terminal Live Process Monitor */}
            <div
              className="lg:col-span-8 flex flex-col gap-6"
              id="panel-trace-agent"
            >
              {/* Telemetry Process Monitor */}
              <div className="bg-[#111827] rounded-xl border border-[#1e293b] p-5 shadow-lg">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4 border-b border-[#1e293b] pb-4">
                  <div>
                    <h3 className="text-sm font-semibold text-white uppercase tracking-wider font-display">
                      GPT-4o-Mini Episodic MemoryAgent Execution Tracker
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Trace ID:{" "}
                      <span className="font-mono text-[#38bdf8] font-bold">
                        {activeIncident?.traceId || "tr-idle-system-ready"}
                      </span>
                    </p>
                  </div>

                  {/* Real-time duration clock */}
                  <div className="flex items-center gap-3">
                    <div className="bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg flex items-center gap-2 font-mono text-xs">
                      <span className="text-slate-400">Time Elapsing:</span>
                      <span
                        className={`font-bold ${simulationRunning ? "text-amber-400 animate-pulse" : "text-emerald-400"}`}
                      >
                        {simulationRunning
                          ? `${(simulationTime / 1000).toFixed(2)}s`
                          : activeIncident?.durationMs
                            ? `${(activeIncident.durationMs / 1000).toFixed(2)}s`
                            : "0.00s"}
                      </span>
                    </div>

                    <span
                      className={`h-2.5 w-2.5 rounded-full ${
                        simulationRunning
                          ? "bg-amber-500 animate-ping"
                          : activeIncident?.status === "completed"
                            ? "bg-emerald-500"
                            : "bg-slate-600"
                      }`}
                    />
                  </div>
                </div>

                {/* Vertical Step Timeline Checklist */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
                  {(
                    activeIncident?.checkpoints ||
                    PRESET_INCIDENTS[selectedPreset].checkpoints
                  ).map((step, idx) => {
                    const statusText = step.stepStatus;
                    const durationText = step.durationMs
                      ? `${step.durationMs}ms`
                      : "";

                    return (
                      <div
                        key={idx}
                        className={`p-3.5 rounded-xl border flex flex-col gap-1.5 transition-all relative overflow-hidden ${
                          statusText === "success"
                            ? "bg-emerald-950/25 border-emerald-500/20 text-slate-300"
                            : statusText === "running"
                              ? "bg-amber-950/25 border-amber-500/30 text-slate-200"
                              : "bg-slate-900/50 border-slate-800/80 text-slate-500"
                        }`}
                      >
                        {statusText === "running" && (
                          <div className="absolute top-0 right-0 left-0 h-0.5 bg-gradient-to-r from-transparent via-amber-400 to-transparent animate-pulse" />
                        )}

                        <div className="flex justify-between items-start gap-2">
                          <span className="font-mono text-[9px] uppercase tracking-wider font-bold text-slate-400">
                            Checkpoint Step {step.stepNumber}
                          </span>
                          <span className="font-mono text-[10px] text-slate-400">
                            {durationText}
                          </span>
                        </div>

                        <div className="font-sans font-medium text-xs text-white">
                          {step.stepName}
                        </div>

                        <div className="flex items-center gap-1.5 mt-1">
                          {statusText === "success" ? (
                            <span className="text-[10px] bg-emerald-500/10 text-emerald-400 font-mono font-bold px-1.5 py-0.5 rounded flex items-center gap-1 border border-emerald-500/20">
                              <CheckCircle2 className="w-3 h-3" /> SUCCESS
                            </span>
                          ) : statusText === "running" ? (
                            <span className="text-[10px] bg-amber-500/10 text-amber-400 font-mono font-bold px-1.5 py-0.5 rounded flex items-center gap-1 border border-amber-500/20 animate-pulse">
                              <RefreshCw className="w-3 h-3 animate-spin" />{" "}
                              EXECUTING
                            </span>
                          ) : (
                            <span className="text-[10px] bg-slate-800 text-slate-400 font-mono font-bold px-1.5 py-0.5 rounded border border-slate-700">
                              WAITING
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* pgvector episodic memory link display */}
                {activeIncident?.memoryHits &&
                  activeIncident.memoryHits.length > 0 && (
                    <div className="bg-[#0f172a] border border-[#1e2e4f]/80 p-4 rounded-lg mb-5 flex flex-col gap-2.5 text-xs">
                      <span className="font-semibold text-[#38bdf8] font-mono flex items-center gap-1.5">
                        <Database className="w-4 h-4 text-[#38bdf8]" /> Vector
                        Episodic Memories Recalled (Similarity &gt; 60%):
                      </span>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-1">
                        {activeIncident.memoryHits.map((memory, index) => (
                          <div
                            key={index}
                            className="bg-[#121b2e] border border-slate-800 p-3 rounded flex flex-col gap-1.5 font-mono"
                          >
                            <div className="flex justify-between items-center text-[10px]">
                              <span className="text-teal-400 font-bold">
                                MATCH EMBEDDING #{memory.id}
                              </span>
                              <span className="bg-emerald-500/15 text-emerald-400 font-bold px-1.5 py-0.5 rounded border border-emerald-500/10">
                                {(memory.similarity
                                  ? memory.similarity * 100
                                  : 0
                                ).toFixed(1)}
                                % similarity
                              </span>
                            </div>
                            <div className="text-white text-xs leading-relaxed line-clamp-2">
                              {memory.goal}
                            </div>
                            <div className="text-[#94a3b8] text-[11px] border-t border-slate-800/80 pt-1.5 mt-0.5 leading-relaxed italic line-clamp-2">
                              Outcome: {memory.outcome}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                {/* Simulation Logs Console (Code Terminal style) */}
                <div className="bg-[#090d16] border border-[#1e293b] rounded-xl p-4 shadow-inner relative">
                  <div className="flex justify-between items-center text-slate-400 border-b border-slate-800 pb-2.5 mb-3 text-xs font-mono">
                    <span className="flex items-center gap-1.5 font-semibold text-slate-300">
                      <Terminal className="w-4 h-4 text-slate-400" /> Active
                      Orchestrator Stream Logs
                    </span>
                    <span className="text-[10px]">RECOVERY_SCHEDULER_LIVE</span>
                  </div>

                  <div className="h-64 overflow-y-auto font-mono text-[11px] leading-relaxed flex flex-col gap-2.5 select-text pr-2">
                    {activeIncident?.logs ? (
                      activeIncident.logs.map((log, lidx) => {
                        let colorClass = "text-slate-400";
                        if (log.includes("[SYSTEM]"))
                          colorClass = "text-blue-400";
                        if (log.includes("[ORCHESTRATOR]"))
                          colorClass = "text-purple-400";
                        if (log.includes("[COGNITIVE_PLAN]"))
                          colorClass = "text-amber-400";
                        if (log.includes("[pgvector"))
                          colorClass = "text-teal-400";
                        if (log.includes("[MCP_ENGINE]"))
                          colorClass = "text-indigo-400 font-bold";
                        if (log.includes("[SLACK_API]"))
                          colorClass = "text-pink-400";
                        if (log.includes("[ERROR]"))
                          colorClass =
                            "text-rose-400 font-bold bg-rose-500/10 p-1 rounded-sm";

                        return (
                          <div
                            key={lidx}
                            className={`${colorClass} flex items-start gap-1`}
                          >
                            <span className="text-slate-600 select-none mr-1.5">
                              {(lidx + 1).toString().padStart(3, "0")}
                            </span>
                            <span>{log}</span>
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-slate-500 italic text-center my-auto">
                        Ready to trigger Slack Event. Select or input a custom
                        incident webhook alert, then click 'Engage Incident
                        Commander' to run the procedural state machines.
                      </div>
                    )}
                    <div ref={terminalEndRef} />
                  </div>
                </div>

                {/* Synthesized Post-Mortem Report PDF/Slack Panel */}
                <AnimatePresence>
                  {activeIncident?.status === "completed" &&
                    activeIncident.finalOutput && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="mt-5 border border-emerald-500/20 bg-emerald-950/10 p-4 rounded-xl flex flex-col gap-3 text-xs"
                      >
                        <div className="flex justify-between items-center pb-2 border-b border-emerald-500/10 font-mono">
                          <span className="font-semibold text-emerald-400 flex items-center gap-1.5">
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />{" "}
                            Auto-Synthesized Action Post-Mortem Remediation:
                          </span>
                          <span className="text-slate-400 font-bold">
                            100% SUCCESS SLA RECORDED
                          </span>
                        </div>

                        <div className="font-mono bg-[#0c1220]/80 p-3.5 border border-slate-800 rounded-lg text-[#f1f5f9] leading-relaxed whitespace-pre-wrap select-text selection:bg-emerald-800">
                          {activeIncident.finalOutput}
                        </div>

                        <div className="text-[#94a3b8] font-mono leading-relaxed bg-[#0c1220]/40 p-2.5 rounded border border-slate-850 flex items-start sm:items-center gap-2">
                          <span className="text-emerald-400 font-bold">
                            AUTOMATED REMEDIATION OUTCOME:
                          </span>
                          <span>{activeIncident.summary}</span>
                        </div>
                      </motion.div>
                    )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: COGNITIVE EPISODIC MEMORIES */}
        {activeTab === "memories" && (
          <div
            className="grid grid-cols-1 lg:grid-cols-12 gap-6"
            id="panel-vector-memories"
          >
            {/* Left Block: Dense Vector Heuristics Tester */}
            <div className="lg:col-span-8 bg-[#111827] rounded-xl border border-[#1e293b] p-5 shadow-lg flex flex-col gap-4">
              <div>
                <h3 className="text-sm font-semibold text-white uppercase tracking-wider font-display">
                  Cognitive Memory Explorer (pgvector Sandbox)
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Query the pgvector database to test vector cosine similarity
                  metrics using the server-side semantic matches.
                </p>
              </div>

              {/* Similarity Query form */}
              <form
                onSubmit={runMemoryVectorSearch}
                className="flex flex-col sm:flex-row gap-2"
              >
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="e.g. terming active database idle transactionlocks"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-[#090d16] border border-slate-800 rounded-lg pl-10 pr-4 py-2 text-white placeholder-slate-500 text-xs focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSearchingMemory}
                  className="bg-blue-600 hover:bg-blue-500 border border-blue-500 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-all flex items-center gap-1.5 shrink-0 justify-center cursor-pointer font-display"
                >
                  {isSearchingMemory ? (
                    <>
                      <RefreshCw className="w-4.5 h-4.5 animate-spin" />{" "}
                      Searching Dense Vector...
                    </>
                  ) : (
                    <>
                      <Search className="w-4.5 h-4.5" /> Execute Cognitive
                      Lookup
                    </>
                  )}
                </button>
              </form>

              {/* Memory Cards stage */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                {searchedMemories.map((m) => (
                  <div
                    key={m.id}
                    className="bg-[#090d16] border border-slate-850 p-4 rounded-xl flex flex-col gap-3 transition-all relative overflow-hidden"
                  >
                    <div className="flex justify-between items-start gap-2">
                      <span className="font-mono text-[10px] text-teal-400 font-bold bg-teal-500/10 px-2 py-0.5 rounded border border-teal-500/25">
                        EPISODIC ID: {m.id}
                      </span>

                      {m.similarity !== undefined && (
                        <span
                          className={`font-mono text-xs font-bold px-2 py-0.5 rounded ${
                            m.similarity >= 0.8
                              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/15"
                              : m.similarity >= 0.5
                                ? "bg-amber-500/20 text-amber-400 border border-amber-500/15"
                                : "bg-slate-800/80 text-slate-400 border border-slate-700"
                          }`}
                        >
                          {(m.similarity * 100).toFixed(1)}% similarity
                        </span>
                      )}
                    </div>

                    <div className="flex flex-col gap-1.5 font-mono">
                      <span className="text-[10px] uppercase font-bold text-slate-400">
                        Trigger Goal Context:
                      </span>
                      <p className="text-white text-xs leading-relaxed font-sans font-medium">
                        {m.goal}
                      </p>
                    </div>

                    <div className="flex flex-col gap-1.5 font-mono pt-3 border-t border-slate-850 leading-relaxed">
                      <span className="text-[10px] uppercase font-bold text-teal-400">
                        Recorded Incident Outcome:
                      </span>
                      <p className="text-slate-300 text-xs italic">
                        {m.outcome}
                      </p>
                    </div>

                    <div className="flex justify-between items-center text-[10px] text-slate-400 font-mono mt-2 pt-2 border-t border-slate-850">
                      <span>
                        Shipped: {new Date(m.createdAt).toLocaleDateString()}
                      </span>
                      <button
                        onClick={() => removeMemory(m.id)}
                        className="text-rose-400 hover:text-rose-300 flex items-center gap-0.5"
                      >
                        <Trash className="w-3.5 h-3.5" /> delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Block: Add manual memories to DB simulation */}
            <div className="lg:col-span-4 bg-[#111827] rounded-xl border border-[#1e293b] p-5 shadow-lg flex flex-col gap-4">
              <div>
                <h3 className="text-sm font-semibold text-white uppercase tracking-wider font-display">
                  Inject Simulated Memory Node
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Manually feed incident outcomes to expand our pgvector
                  knowledge graphs instantly.
                </p>
              </div>

              <form
                onSubmit={createManualMemory}
                className="flex flex-col gap-4 text-xs font-mono"
              >
                <div>
                  <label className="text-slate-400 block mb-1">
                    Incident Goal Context:
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. resolve runaway web server memory cache overflow"
                    value={newMemoryGoal}
                    onChange={(e) => setNewMemoryGoal(e.target.value)}
                    className="w-full bg-[#090d16] border border-slate-800 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">
                    Mitigated System Outcome (Incident resolution):
                  </label>
                  <textarea
                    required
                    placeholder="e.g. adjusted eviction threshold inside LRU pools; dispatched clear backend hooks."
                    value={newMemoryOutcome}
                    onChange={(e) => setNewMemoryOutcome(e.target.value)}
                    className="w-full bg-[#090d16] border border-slate-800 rounded px-3 py-2 text-white h-24 focus:outline-none focus:border-blue-500 resize-none"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full bg-teal-600 hover:bg-teal-500 border border-teal-500 text-white font-semibold py-2.5 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer font-display"
                >
                  <Plus className="w-4 h-4" /> Seed Episodic Node
                </button>

                <AnimatePresence>
                  {newMemorySuccess && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      className="border border-emerald-500/20 bg-emerald-950/20 text-emerald-400 p-3 rounded-lg text-xs leading-relaxed text-center"
                    >
                      EPISODIC NODE SEEDED SUCCESS: Index rebuilt cleanly with
                      custom hnsw cosine bounds. Try querying it!
                    </motion.div>
                  )}
                </AnimatePresence>
              </form>
            </div>
          </div>
        )}
      </main>

      {/* FOOTER */}
      <footer className="border-t border-[#1e293b] bg-[#0d1527] px-6 py-4 flex flex-col sm:flex-row justify-between items-center gap-4 text-xs font-mono text-slate-400">
        <span>
          © 2026 CometAPI Deep Dive Tools. All execution simulations validated.
        </span>
        <div className="flex gap-4">
          <span className="text-emerald-400 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> Core VM Online
          </span>
          <span>Port 3000 Ingress</span>
        </div>
      </footer>
    </div>
  );
}

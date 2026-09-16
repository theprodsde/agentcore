import React, { useState, useCallback } from "react";
import { createTask } from "../lib/api";
import { useNavigate } from "react-router-dom";
import { Play, ShieldAlert, Network, AlertCircle, Info } from "lucide-react";

type Scenario = "recovery" | "incident" | "research";

const SCENARIOS: Record<Scenario, { goal: string; context: string; task_type: string; inject_failure: boolean }> = {
  recovery: {
    goal:           "Diagnose CPU Spike on Checkout Service",
    context:        "Alert firing: container CPU > 95% on checkout-worker-1",
    task_type:      "incident",
    inject_failure: true,
  },
  incident: {
    goal:           "Investigate database connection pool exhaustion",
    context:        "DB metrics show active connections capped at 100/100 for 5 minutes.",
    task_type:      "incident",
    inject_failure: false,
  },
  research: {
    goal:           "Generate post-mortem for recent S3 outage",
    context:        "S3 API 500 errors caused image upload failure across all pods.",
    task_type:      "report",
    inject_failure: false,
  },
};

export default function DemoScenarios() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [info,    setInfo]    = useState<string | null>(null);

  const runScenario = useCallback(async (scenario: Scenario) => {
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const res = await createTask(SCENARIOS[scenario]);
      if (res.correlated) {
        setInfo(res.message ?? "Similar investigation already running — navigating to it.");
      }
      navigate(`/tasks/${res.task_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start scenario");
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  return (
    <div className="max-w-5xl mx-auto p-8">
      <div className="mb-8 border-b border-slate-200 pb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Guided Demo Scenarios</h1>
        <p className="text-slate-500 mt-1">One-click scenarios that exercise each core capability end-to-end.</p>
      </div>

      {error && (
        <div className="mb-6 flex items-start gap-3 p-4 bg-rose-50 border border-rose-200 rounded-lg">
          <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
          <p className="text-sm text-rose-700">{error}</p>
        </div>
      )}

      {info && (
        <div className="mb-6 flex items-start gap-3 p-4 bg-sky-50 border border-sky-200 rounded-lg">
          <Info className="w-5 h-5 text-sky-500 shrink-0 mt-0.5" />
          <p className="text-sm text-sky-700">{info}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="w-10 h-10 rounded-lg bg-rose-50 flex items-center justify-center mb-4 border border-rose-100">
              <ShieldAlert className="w-5 h-5 text-rose-600" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">1. Failure &amp; Recovery</h3>
            <p className="text-sm text-slate-500 mt-2 mb-4 leading-relaxed">
              Injects a deterministic network failure at step 3. Shows how the orchestrator
              preserves state and resumes from the exact checkpoint — no duplicate work.
            </p>
          </div>
          <button
            onClick={() => runScenario("recovery")}
            disabled={loading}
            className="w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white px-4 py-2.5 rounded-md font-medium text-sm transition-colors flex items-center justify-center gap-2"
          >
            <Play size={16} /> Run Recovery Flow
          </button>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center mb-4 border border-indigo-100">
              <Network className="w-5 h-5 text-indigo-600" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">2. Episodic Memory Match</h3>
            <p className="text-sm text-slate-500 mt-2 mb-4 leading-relaxed">
              Runs a full incident pipeline and writes the synthesized outcome to the
              memory store — used for context retrieval on the next similar incident.
            </p>
          </div>
          <button
            onClick={() => runScenario("incident")}
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-md font-medium text-sm transition-colors flex items-center justify-center gap-2"
          >
            <Play size={16} /> Run Standard Incident
          </button>
        </div>

      </div>

      <div className="mt-10 bg-slate-50 rounded-xl border border-slate-200 p-6">
        <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-3">Slack Integration</h3>
        <p className="text-sm text-slate-600 leading-relaxed mb-3">
          Trigger an investigation directly from Slack with{" "}
          <code className="bg-slate-200 px-1.5 py-0.5 rounded text-xs">!incident &lt;description&gt;</code>.
          The backend ingests the event, acknowledges immediately to prevent timeouts,
          and posts the final report back to the thread when complete.
        </p>
        <ul className="list-disc pl-5 text-sm text-slate-600 space-y-1">
          <li>Set <code className="bg-slate-200 px-1 rounded text-xs">SLACK_SIGNING_SECRET</code> and <code className="bg-slate-200 px-1 rounded text-xs">SLACK_BOT_TOKEN</code> in your <code className="bg-slate-200 px-1 rounded text-xs">.env</code>.</li>
          <li>Point the Slack app's Event Subscriptions URL at <code className="bg-slate-200 px-1 rounded text-xs">/api/slack/events</code> (use ngrok locally).</li>
        </ul>
      </div>
    </div>
  );
}

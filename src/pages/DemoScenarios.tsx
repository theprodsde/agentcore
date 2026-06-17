import React, { useState } from "react";
import { createTask } from "../lib/api";
import { useNavigate } from "react-router-dom";
import { Play, ShieldAlert, Cpu, Network } from "lucide-react";

export default function DemoScenarios() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const runScenario = async (scenario: 'recovery' | 'incident' | 'research') => {
    setLoading(true);
    try {
      let taskPayload = { goal: "", context: "", task_type: "incident", inject_failure: false };
      
      switch (scenario) {
        case 'recovery':
          taskPayload = {
            goal: "Diagnose CPU Spike on Checkout Service",
            context: "Alert firing: container CPU > 95% on checkout-worker-1",
            task_type: "incident",
            inject_failure: true
          };
          break;
        case 'incident':
          taskPayload = {
            goal: "Investigate database connection pool exhaustion",
            context: "DB metrics show active connections capped at 100/100 for 5 minutes.",
            task_type: "incident",
            inject_failure: false
          };
          break;
        case 'research':
           taskPayload = {
            goal: "Generate post-mortem for recent S3 outage",
            context: "S3 API 500 errors caused image upload failure across all pods.",
            task_type: "report",
            inject_failure: false
          };
          break;
      }
      
      const res = await createTask(taskPayload);
      navigate(`/tasks/${res.task_id}`);
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-8">
      <div className="mb-8 border-b border-slate-200 pb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Guided Demo Scenarios</h1>
        <p className="text-slate-500 mt-1">
          Use these one-click scenarios to demonstrate core architectural differentiators to judging teams.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Scenario 1: Recovery */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="w-10 h-10 rounded-lg bg-rose-50 flex items-center justify-center mb-4 border border-rose-100">
              <ShieldAlert className="w-5 h-5 text-rose-600" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">1. Failure & Recovery</h3>
            <p className="text-sm text-slate-500 mt-2 mb-4 leading-relaxed">
              Demonstrates the Agent Orchestrator's checkpointing resilience. 
              Injects a deterministic network failure mid-execution, showing how the runner 
              preserves state and resumes safely without duplicate work.
            </p>
          </div>
          <button 
            onClick={() => runScenario('recovery')}
            disabled={loading}
            className="w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white px-4 py-2.5 rounded-md font-medium text-sm transition-colors flex items-center justify-center gap-2"
          >
            <Play size={16} /> Run Recovery Flow
          </button>
        </div>

        {/* Scenario 2: Standard Incident */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center mb-4 border border-indigo-100">
              <Network className="w-5 h-5 text-indigo-600" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">2. Episodic Memory Match</h3>
            <p className="text-sm text-slate-500 mt-2 mb-4 leading-relaxed">
              Demonstrates the system generating an incident analysis, executing tools, 
              and successfully pushing semantic outcomes to the memory pool for future contextual mapping.
            </p>
          </div>
          <button 
            onClick={() => runScenario('incident')}
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-md font-medium text-sm transition-colors flex items-center justify-center gap-2"
          >
            <Play size={16} /> Run Standard Incident
          </button>
        </div>

      </div>

      <div className="mt-12 bg-slate-50 rounded-xl border border-slate-200 p-6">
        <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-2">Instructions for Slack Integration</h3>
        <p className="text-sm text-slate-600 leading-relaxed mb-4">
          To demonstrate the Slack functionality, ensure you have configured your environment variables and webhook URL.
          When sending an incident trigger from Slack using `<code className="bg-slate-200 px-1 rounded">/incident</code>`, the backend will instantly ingest the event, 
          acknowledge to prevent timeout, and enqueue an agent. Once complete, it will push a Block Kit message back.
        </p>
        <ul className="list-disc pl-5 text-sm text-slate-600 space-y-1">
           <li>Verify `SLACK_SIGNING_SECRET` and `SLACK_BOT_TOKEN` are set.</li>
           <li>Configure the applet's public URL in the Slack API Dashboard as the Event Subs/Interactivity Request URL.</li>
        </ul>
      </div>

    </div>
  );
}

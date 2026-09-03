import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchTask, fetchCheckpoints, resumeTask } from "../lib/api";
import { Task, Checkpoint } from "../types";
import {
  CheckCircle2, Circle, AlertCircle, RefreshCw, Terminal,
  PlayCircle, Ticket, AlertTriangle, Cpu, ListChecks, FileSearch
} from "lucide-react";

interface SynthOutput {
  summary?: string;
  probable_cause?: string;
  affected_systems?: string[];
  next_actions?: string[];
  ticket_id?: string;
}

export default function TaskDetail() {
  const { taskId } = useParams();
  const [task, setTask]             = useState<Task | null>(null);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [resuming, setResuming]     = useState(false);

  const loadData = async () => {
    if (!taskId) return;
    try {
      const [tData, cData] = await Promise.all([fetchTask(taskId), fetchCheckpoints(taskId)]);
      setTask(tData);
      setCheckpoints(cData);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 2000);
    return () => clearInterval(interval);
  }, [taskId]);

  const handleResume = async () => {
    if (!taskId) return;
    setResuming(true);
    try {
      await resumeTask(taskId);
      await loadData();
    } finally {
      setResuming(false);
    }
  };

  if (!task) {
    return <div className="p-8 text-slate-500">Loading task data...</div>;
  }

  const totalDuration = checkpoints
    .filter(c => c.step_status === "success" || c.step_status === "failed")
    .reduce((acc, c) => acc + c.duration_ms, 0);

  return (
    <div className="max-w-5xl mx-auto p-8 flex flex-col gap-6">

      {/* Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <div className="flex justify-between items-start gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold tracking-tight text-slate-900 truncate">{task.goal}</h1>
              <span className="shrink-0 px-2 py-0.5 text-xs font-mono bg-slate-100 text-slate-500 rounded">
                {task.task_id.split("-")[0]}
              </span>
            </div>
            <p className="text-sm text-slate-500 mt-1 capitalize">
              {task.task_type}&ensp;·&ensp;Trace: <span className="font-mono">{task.trace_id}</span>
              {task.resume_count > 0 && (
                <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">
                  Resumed ×{task.resume_count}
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <TaskStatusBadge status={task.status} />
            {task.status === "failed" && (
              <button
                onClick={handleResume}
                disabled={resuming}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-1.5 rounded text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                {resuming ? <RefreshCw size={13} className="animate-spin" /> : <PlayCircle size={13} />}
                Resume from Checkpoint
              </button>
            )}
          </div>
        </div>

        {task.error && (
          <div className="mt-4 p-4 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-rose-800">Execution blocked at step {task.current_step?.step_number}</p>
              <p className="text-xs font-mono text-rose-700 mt-0.5">{task.error}</p>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Checkpoint Timeline */}
        <div className="lg:col-span-1 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <Terminal size={13} /> Checkpoint Timeline
            </h3>
            {totalDuration > 0 && (
              <span className="text-xs text-slate-400 font-mono">{(totalDuration / 1000).toFixed(1)}s total</span>
            )}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {checkpoints.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-400">Awaiting first step…</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {checkpoints.map(cp => (
                  <div key={cp.id} className="flex items-start gap-3 p-4">
                    <div className="pt-0.5 shrink-0">
                      <CheckpointIcon status={cp.step_status} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center mb-0.5">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                          Step {cp.step_number}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono tabular-nums">
                          {cp.duration_ms < 1000
                            ? `${cp.duration_ms}ms`
                            : `${(cp.duration_ms / 1000).toFixed(1)}s`}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-slate-800 capitalize">
                        {cp.step_name.replace(/_/g, " ")}
                      </p>
                      {cp.error_info && (
                        <p className="text-[11px] font-mono text-rose-500 mt-1 line-clamp-2 break-all">
                          {cp.error_info}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Incident Report */}
        <div className="lg:col-span-2 flex flex-col gap-3">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            <FileSearch size={13} /> Incident Report
          </h3>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm min-h-[300px]">
            {!task.final_output ? (
              <div className="h-full min-h-[300px] flex flex-col items-center justify-center text-slate-400 gap-3">
                {task.status === "running" ? (
                  <>
                    <RefreshCw className="w-8 h-8 animate-spin text-indigo-400" />
                    <p className="text-sm">Synthesizing incident report…</p>
                  </>
                ) : (
                  <p className="text-sm">Report will appear here once the task completes.</p>
                )}
              </div>
            ) : (
              <IncidentReport raw={task.final_output} />
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

// ─── Incident Report ──────────────────────────────────────────────────────────

function IncidentReport({ raw }: { raw: string }) {
  let data: SynthOutput = {};
  let parseError = false;

  try {
    data = JSON.parse(raw) as SynthOutput;
  } catch {
    parseError = true;
  }

  if (parseError || !data.summary) {
    return (
      <pre className="p-6 text-xs font-mono text-slate-600 whitespace-pre-wrap break-words overflow-auto">
        {raw}
      </pre>
    );
  }

  return (
    <div className="divide-y divide-slate-100">

      {/* Summary */}
      <div className="p-5">
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Summary</p>
        <p className="text-sm text-slate-800 leading-relaxed">{data.summary}</p>
      </div>

      {/* Probable cause */}
      {data.probable_cause && (
        <div className="p-5 flex gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Probable Cause</p>
            <p className="text-sm text-slate-700">{data.probable_cause}</p>
          </div>
        </div>
      )}

      {/* Affected systems */}
      {data.affected_systems && data.affected_systems.length > 0 && (
        <div className="p-5 flex gap-3">
          <Cpu className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Affected Systems</p>
            <div className="flex flex-wrap gap-1.5">
              {data.affected_systems.map(s => (
                <span
                  key={s}
                  className="px-2.5 py-1 bg-indigo-50 text-indigo-700 text-xs font-mono rounded-md border border-indigo-100"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Next actions */}
      {data.next_actions && data.next_actions.length > 0 && (
        <div className="p-5 flex gap-3">
          <ListChecks className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Next Actions</p>
            <ol className="flex flex-col gap-2">
              {data.next_actions.map((action, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <span className="text-sm text-slate-700">{action}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}

      {/* Ticket */}
      {data.ticket_id && (
        <div className="p-5 flex items-center gap-3">
          <Ticket className="w-4 h-4 text-slate-400 shrink-0" />
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mr-2">Ticket</p>
          <span className="px-2.5 py-1 bg-slate-100 text-slate-700 text-xs font-mono rounded-md">
            {data.ticket_id}
          </span>
        </div>
      )}

    </div>
  );
}

// ─── Small components ─────────────────────────────────────────────────────────

function TaskStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "completed": return (
      <span className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide">
        <CheckCircle2 size={13} /> Completed
      </span>
    );
    case "failed": return (
      <span className="inline-flex items-center gap-1.5 bg-rose-50 text-rose-700 border border-rose-200 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide">
        <AlertCircle size={13} /> Failed
      </span>
    );
    case "running": return (
      <span className="inline-flex items-center gap-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide">
        <RefreshCw size={13} className="animate-spin" /> In Progress
      </span>
    );
    default: return (
      <span className="inline-flex items-center gap-1.5 bg-slate-100 text-slate-600 border border-slate-200 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide">
        <Circle size={13} /> Pending
      </span>
    );
  }
}

function CheckpointIcon({ status }: { status: string }) {
  switch (status) {
    case "success": return <CheckCircle2 className="w-4.5 h-4.5 text-emerald-500" size={18} />;
    case "failed":  return <AlertCircle  className="w-4.5 h-4.5 text-rose-500"    size={18} />;
    case "running": return <RefreshCw    className="w-4.5 h-4.5 text-indigo-500 animate-spin" size={18} />;
    default:        return <Circle       className="w-4.5 h-4.5 text-slate-300"   size={18} />;
  }
}

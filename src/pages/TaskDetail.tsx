import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchTask, fetchCheckpoints, resumeTask } from "../lib/api";
import { Task, Checkpoint } from "../types";
import { formatDistanceToNow } from "date-fns";
import { CheckCircle2, Circle, AlertCircle, RefreshCw, Terminal, PlayCircle } from "lucide-react";
import Markdown from "react-markdown";

export default function TaskDetail() {
  const { taskId } = useParams();
  const [task, setTask] = useState<Task | null>(null);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [resuming, setResuming] = useState(false);

  const loadData = async () => {
    if (!taskId) return;
    try {
      const [tData, cData] = await Promise.all([
        fetchTask(taskId),
        fetchCheckpoints(taskId)
      ]);
      setTask(tData);
      setCheckpoints(cData);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadData();
    // Use polling for simplicity as fallback (SSE stream is supported on server but polling is safer in sandboxed UI)
    const interval = setInterval(loadData, 2000);
    return () => clearInterval(interval);
  }, [taskId]);

  const handleResume = async () => {
    if (!taskId) return;
    setResuming(true);
    try {
      await resumeTask(taskId);
      await loadData();
    } catch (e) {
      console.error(e);
    } finally {
      setResuming(false);
    }
  };

  if (!task) {
    return <div className="p-8 text-slate-500">Loading task data...</div>;
  }

  return (
    <div className="max-w-5xl mx-auto p-8 flex flex-col gap-8">
      {/* Header Panel */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <div className="flex justify-between items-start mb-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold tracking-tight text-slate-900">{task.goal}</h1>
              <span className="px-2.5 py-1 text-xs font-mono font-medium bg-slate-100 text-slate-600 rounded">
                {task.task_id.split("-")[0]}
              </span>
            </div>
            <p className="text-sm text-slate-500 mt-1 capitalize">{task.task_type} • Trace: {task.trace_id}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
             <TaskStatusBadge status={task.status} />
             {task.status === "failed" && (
                <button 
                  onClick={handleResume} 
                  disabled={resuming}
                  className="mt-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-1.5 rounded text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  {resuming ? <RefreshCw size={14} className="animate-spin" /> : <PlayCircle size={14} />}
                  Resume from Checkpoint
                </button>
             )}
          </div>
        </div>
        
        {task.error && (
          <div className="mt-4 p-4 bg-rose-50 border border-rose-200 rounded-md flex items-start gap-3">
             <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
             <div>
               <h4 className="text-sm font-semibold text-rose-800">Execution Blocked</h4>
               <p className="text-sm text-rose-700 mt-1 font-mono">{task.error}</p>
             </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Timeline Panel */}
        <div className="lg:col-span-1 flex flex-col gap-4">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <Terminal size={16} /> Checkpoint Timeline
          </h3>
          <div className="bg-white rounded-xl border border-slate-200 p-1 shadow-sm overflow-hidden">
            <div className="flex flex-col divide-y divide-slate-100">
              {checkpoints.length === 0 ? (
                <div className="p-6 text-center text-sm text-slate-500">Awaiting initial steps...</div>
              ) : (
                checkpoints.map(cp => (
                  <div key={cp.id} className="p-4 flex gap-4">
                    <div className="pt-1 flex-shrink-0">
                      <CheckpointIcon status={cp.step_status} />
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between items-start mb-1">
                        <span className="text-xs font-bold text-slate-500 uppercase">Step {cp.step_number}</span>
                        <span className="text-[10px] text-slate-400 font-mono">{cp.duration_ms}ms</span>
                      </div>
                      <h4 className="text-sm font-medium text-slate-900 capitalize">{cp.step_name.replace('_', ' ')}</h4>
                      {cp.error_info && (
                        <p className="text-xs font-mono text-rose-600 mt-1 line-clamp-2">{cp.error_info}</p>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Final Output Panel */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
             Execution Result
          </h3>
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm min-h-[300px] flex flex-col">
            {!task.final_output ? (
               <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-2">
                 {task.status === "running" ? (
                   <>
                     <RefreshCw className="w-8 h-8 animate-spin text-indigo-400" />
                     <p className="text-sm">Synthesizing output artifacts...</p>
                   </>
                 ) : (
                   <p className="text-sm">Output will appear here once the task completes.</p>
                 )}
               </div>
            ) : (
               <div className="prose prose-sm max-w-none text-slate-800">
                  <Markdown>{task.final_output}</Markdown>
               </div>
            )}
          </div>
        </div>
        
      </div>
    </div>
  );
}

function TaskStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'completed': return <span className="bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 border border-emerald-200"><CheckCircle2 size={14} /> Completed</span>;
    case 'failed': return <span className="bg-rose-100 text-rose-800 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 border border-rose-200"><AlertCircle size={14} /> Failed</span>;
    case 'running': return <span className="bg-indigo-100 text-indigo-800 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 border border-indigo-200"><RefreshCw size={14} className="animate-spin" /> In Progress</span>;
    default: return <span className="bg-slate-100 text-slate-800 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border border-slate-200">Pending</span>;
  }
}

function CheckpointIcon({ status }: { status: string }) {
  switch(status) {
    case 'success': return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
    case 'failed': return <AlertCircle className="w-5 h-5 text-rose-500" />;
    case 'running': return <RefreshCw className="w-5 h-5 text-indigo-500 animate-spin" />;
    default: return <Circle className="w-5 h-5 text-slate-300" />;
  }
}

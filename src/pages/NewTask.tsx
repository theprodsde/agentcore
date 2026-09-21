import React, { useState } from "react";
import { createTask } from "../lib/api";
import { useNavigate } from "react-router-dom";
import { Play, AlertCircle } from "lucide-react";

export default function NewTask() {
  const navigate  = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [formData, setFormData] = useState({
    goal:           "",
    context:        "",
    task_type:      "incident",
    inject_failure: false,
    dry_run:        false,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.goal.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await createTask(formData);
      if (res.correlated) {
        // Dedup: an existing task covers this goal — navigate directly to it
        navigate(`/tasks/${res.task_id}`);
        return;
      }
      navigate(`/tasks/${res.task_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Create Task</h1>
        <p className="text-slate-500 mt-1">Initialize a new execution run under the agent.</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm flex flex-col gap-6">

        {error && (
          <div className="flex items-start gap-3 p-4 bg-rose-50 border border-rose-200 rounded-lg">
            <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
            <p className="text-sm text-rose-700">{error}</p>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-slate-900 mb-2">Intent / Goal</label>
          <input
            type="text"
            required
            value={formData.goal}
            onChange={e => setFormData({ ...formData, goal: e.target.value })}
            placeholder="e.g., Investigate CPU spike in payment service"
            className="w-full px-4 py-2 bg-white border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-900 mb-2">Context (Optional)</label>
          <textarea
            value={formData.context}
            onChange={e => setFormData({ ...formData, context: e.target.value })}
            placeholder="Paste logs, alerts, or user reports here..."
            rows={4}
            className="w-full px-4 py-2 bg-white border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm resize-y font-mono"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-900 mb-2">Task Type</label>
          <select
            value={formData.task_type}
            onChange={e => setFormData({ ...formData, task_type: e.target.value })}
            className="w-full sm:w-1/2 px-4 py-2 bg-white border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
          >
            <option value="incident">Incident Response</option>
            <option value="research">Research / Data Prep</option>
            <option value="report">Report Generation</option>
          </select>
        </div>

        <div className="flex flex-col gap-3 py-2 border-t border-slate-100">
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={formData.dry_run}
              onChange={e => setFormData({ ...formData, dry_run: e.target.checked })}
              className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
            />
            <span className="text-sm font-medium text-slate-700">
              Dry run
              <span className="ml-1.5 text-xs font-normal text-slate-400">
                — runs full pipeline, skips memory write and ticket creation
              </span>
            </span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={formData.inject_failure}
              onChange={e => setFormData({ ...formData, inject_failure: e.target.checked })}
              className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
            />
            <span className="text-sm font-medium text-slate-700">
              Inject failure at step 3
              <span className="ml-1.5 text-xs font-normal text-slate-400">
                — demos crash recovery; hit Resume to continue from checkpoint
              </span>
            </span>
          </label>
        </div>

        <div className="flex justify-end pt-4 border-t border-slate-100">
          <button
            type="submit"
            disabled={loading || !formData.goal.trim()}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-6 py-2.5 rounded-md font-medium text-sm transition-colors flex items-center gap-2"
          >
            {loading ? "Starting…" : <><Play size={16} /> Run Execution</>}
          </button>
        </div>
      </form>
    </div>
  );
}

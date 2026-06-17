import React, { useEffect, useState } from "react";
import { fetchTasks } from "../lib/api";
import { Link } from "react-router-dom";
import { Task } from "../types";
import { formatDistanceToNow } from "date-fns";
import { PlayCircle, Clock, AlertTriangle, CheckCircle, RefreshCw } from "lucide-react";

export default function Dashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTasks = async () => {
    try {
      const data = await fetchTasks();
      setTasks(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTasks();
    const interval = setInterval(loadTasks, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="max-w-6xl mx-auto p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Dashboard</h1>
          <p className="text-slate-500 mt-1">Review active and historical automation tasks.</p>
        </div>
        <Link 
          to="/tasks/new" 
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md font-medium text-sm transition-colors"
        >
          Create Task
        </Link>
      </div>

      {loading ? (
        <div className="h-40 flex items-center justify-center text-slate-400">Loading tasks...</div>
      ) : tasks.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center flex flex-col items-center">
          <PlayCircle className="w-12 h-12 text-slate-300 mb-4" />
          <h3 className="text-lg font-medium text-slate-900 mb-1">No tasks yet</h3>
          <p className="text-slate-500 mb-6">Create your first automation task or triggered incident.</p>
          <Link to="/tasks/new" className="text-indigo-600 hover:text-indigo-700 font-medium">Get started →</Link>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 text-xs uppercase tracking-wider">
                <th className="px-6 py-4 font-medium">Task / Goal</th>
                <th className="px-6 py-4 font-medium">Status</th>
                <th className="px-6 py-4 font-medium">Type</th>
                <th className="px-6 py-4 font-medium text-right">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {tasks.map(task => (
                <tr key={task.task_id} className="hover:bg-slate-50 transition-colors group">
                  <td className="px-6 py-4">
                    <Link to={`/tasks/${task.task_id}`} className="block">
                      <div className="font-medium text-slate-900 group-hover:text-indigo-600 transition-colors">
                        {task.goal}
                      </div>
                      <div className="text-slate-500 text-xs mt-1 font-mono">
                        {task.task_id.split('-')[0]}
                      </div>
                    </Link>
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={task.status} />
                  </td>
                  <td className="px-6 py-4 text-slate-600 capitalize">
                    {task.task_type}
                  </td>
                  <td className="px-6 py-4 text-slate-500 text-right whitespace-nowrap">
                    {formatDistanceToNow(new Date(task.created_at), { addSuffix: true })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700"><CheckCircle className="w-3.5 h-3.5" /> Completed</span>;
    case 'failed':
      return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-50 text-rose-700"><AlertTriangle className="w-3.5 h-3.5" /> Failed</span>;
    case 'running':
      return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Running</span>;
    default:
      return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700"><Clock className="w-3.5 h-3.5" /> Pending</span>;
  }
}

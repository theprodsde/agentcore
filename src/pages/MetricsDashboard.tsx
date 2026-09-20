import React, { useEffect, useState } from "react";
import { BarChart2, CheckCircle, AlertTriangle, Clock, RefreshCw, TrendingUp } from "lucide-react";
import { fetchMetrics } from "../lib/api";

interface MetricsSummary {
  total_tasks: number;
  completed: number;
  failed: number;
  success_rate: number;
  avg_ttc_s: number | null;
  avg_retries: number;
}

interface StepStat {
  step_name: string;
  avg_ms: number;
  p95_ms: number;
  count: number;
}

interface WeeklyPoint {
  week: string;
  total: number;
  completed: number;
  success_rate: number;
  avg_ttc_s: number | null;
}

interface MetricsData {
  summary: MetricsSummary;
  step_breakdown: StepStat[];
  weekly_trend: WeeklyPoint[];
}

const STEP_COLORS: Record<string, string> = {
  memory_retrieval: "bg-purple-400",
  planner:          "bg-indigo-500",
  execution:        "bg-sky-500",
  synthesizer:      "bg-emerald-500",
};

export default function MetricsDashboard() {
  const [data, setData]       = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  useEffect(() => {
    // apiFetch sends the auth header and routes 401s to the login screen
    fetchMetrics<MetricsData>()
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setError("Failed to load metrics"); setLoading(false); });
  }, []);

  if (loading) return <div className="p-8 text-slate-400">Loading metrics…</div>;
  if (error)   return <div className="p-8 text-rose-500">{error}</div>;
  if (!data)   return null;

  const { summary, step_breakdown, weekly_trend } = data;

  const maxWeeklyTotal = Math.max(...weekly_trend.map(w => w.total), 1);
  const maxStepMs      = Math.max(...step_breakdown.map(s => s.p95_ms), 1);

  return (
    <div className="max-w-6xl mx-auto p-8 flex flex-col gap-8">

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
          <BarChart2 className="text-indigo-600" size={24} /> Metrics
        </h1>
        <p className="text-slate-500 mt-1">Last 30 days · refreshes on page load</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          icon={<CheckCircle className="text-emerald-500" size={20} />}
          label="Success rate"
          value={`${summary.success_rate}%`}
          sub={`${summary.completed} / ${summary.total_tasks} tasks`}
        />
        <KpiCard
          icon={<Clock className="text-indigo-500" size={20} />}
          label="Avg time to resolve"
          value={summary.avg_ttc_s != null ? `${summary.avg_ttc_s}s` : "—"}
          sub="completed tasks"
        />
        <KpiCard
          icon={<AlertTriangle className="text-amber-500" size={20} />}
          label="Avg retries"
          value={String(summary.avg_retries)}
          sub="per task"
        />
        <KpiCard
          icon={<TrendingUp className="text-sky-500" size={20} />}
          label="Total tasks"
          value={String(summary.total_tasks)}
          sub={`${summary.failed} failed`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Weekly trend */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">Weekly tasks</h3>
          {weekly_trend.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">No data yet</p>
          ) : (
            <div className="flex items-end gap-2 h-40">
              {weekly_trend.map((w) => {
                const totalH = Math.round((w.total / maxWeeklyTotal) * 100);
                const compH  = w.total > 0 ? Math.round((w.completed / w.total) * totalH) : 0;
                return (
                  <div key={w.week} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex flex-col justify-end" style={{ height: "120px" }}>
                      <div className="w-full flex flex-col-reverse rounded overflow-hidden">
                        <div className="bg-emerald-400 w-full" style={{ height: `${compH}%` }} title={`${w.completed} completed`} />
                        <div className="bg-rose-200 w-full"    style={{ height: `${totalH - compH}%` }} title={`${w.total - w.completed} failed/pending`} />
                      </div>
                    </div>
                    <span className="text-[9px] text-slate-400 font-mono">
                      {new Date(w.week).toLocaleDateString("en-US", { month: "numeric", day: "numeric" })}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex gap-4 mt-3">
            <span className="flex items-center gap-1.5 text-xs text-slate-500"><span className="w-3 h-3 rounded-sm bg-emerald-400 inline-block" /> Completed</span>
            <span className="flex items-center gap-1.5 text-xs text-slate-500"><span className="w-3 h-3 rounded-sm bg-rose-200 inline-block" /> Failed / pending</span>
          </div>
        </div>

        {/* Step breakdown */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">Step duration (p95)</h3>
          {step_breakdown.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">No data yet</p>
          ) : (
            <div className="flex flex-col gap-3">
              {step_breakdown.map((s) => (
                <div key={s.step_name}>
                  <div className="flex justify-between text-xs text-slate-600 mb-1">
                    <span className="capitalize font-medium">{s.step_name.replace(/_/g, " ")}</span>
                    <span className="font-mono text-slate-400">
                      avg {s.avg_ms < 1000 ? `${s.avg_ms}ms` : `${(s.avg_ms / 1000).toFixed(1)}s`}
                      &ensp;·&ensp;p95 {s.p95_ms < 1000 ? `${s.p95_ms}ms` : `${(s.p95_ms / 1000).toFixed(1)}s`}
                    </span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${STEP_COLORS[s.step_name] ?? "bg-slate-400"}`}
                      style={{ width: `${Math.round((s.p95_ms / maxStepMs) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Weekly table */}
      {weekly_trend.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500 uppercase tracking-wider">
                <th className="px-6 py-3 font-medium">Week</th>
                <th className="px-6 py-3 font-medium text-right">Tasks</th>
                <th className="px-6 py-3 font-medium text-right">Success rate</th>
                <th className="px-6 py-3 font-medium text-right">Avg resolution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...weekly_trend].reverse().map((w) => (
                <tr key={w.week} className="hover:bg-slate-50">
                  <td className="px-6 py-3 font-mono text-slate-600">
                    {new Date(w.week).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </td>
                  <td className="px-6 py-3 text-right text-slate-700">{w.total}</td>
                  <td className="px-6 py-3 text-right">
                    <span className={`font-medium ${w.success_rate >= 90 ? "text-emerald-600" : w.success_rate >= 70 ? "text-amber-600" : "text-rose-600"}`}>
                      {w.success_rate}%
                    </span>
                  </td>
                  <td className="px-6 py-3 text-right font-mono text-slate-500">
                    {w.avg_ttc_s != null ? `${w.avg_ttc_s}s` : "—"}
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

function KpiCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        {icon} {label}
      </div>
      <p className="text-3xl font-bold text-slate-900 tracking-tight">{value}</p>
      <p className="text-xs text-slate-400">{sub}</p>
    </div>
  );
}

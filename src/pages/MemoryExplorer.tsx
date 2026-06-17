import React, { useEffect, useState } from "react";
import { fetchAllMemory } from "../lib/api";
import { Memory } from "../types";
import { BrainCircuit, Search, Database } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function MemoryExplorer() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);

  const loadMemories = async () => {
    try {
      const data = await fetchAllMemory();
      setMemories(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMemories();
    const interval = setInterval(loadMemories, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="max-w-5xl mx-auto p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
          <Database className="text-indigo-600" />
          Episodic Memory Database
        </h1>
        <p className="text-slate-500 mt-1">
          Review semantic outcomes from past automation tasks.
        </p>
      </div>

      <div className="mb-6 relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <Search className="h-5 w-5 text-slate-400" />
        </div>
        <input 
          type="text"
          placeholder="Search semantic memory pool..."
          className="block w-full pl-10 pr-3 py-2 border border-slate-300 rounded-md leading-5 bg-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
        />
      </div>

      {loading ? (
        <div className="p-8 text-slate-500 text-center">Querying database...</div>
      ) : memories.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center flex flex-col items-center">
          <BrainCircuit className="w-12 h-12 text-slate-300 mb-4" />
          <h3 className="text-lg font-medium text-slate-900 mb-1">Vector DB Empty</h3>
          <p className="text-slate-500 mb-6">Complete tasks to automatically generate episodic memory.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {memories.map((mem) => (
             <div key={mem.memory_id} className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm hover:shadow transition-shadow">
               <div className="flex justify-between items-start mb-2">
                 <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono font-medium bg-emerald-50 text-emerald-700 border border-emerald-100">
                    Confidence: {(mem.score * 100).toFixed(0)}%
                 </span>
                 <span className="text-xs text-slate-400 font-mono">
                   {formatDistanceToNow(new Date(mem.created_at), { addSuffix: true })}
                 </span>
               </div>
               <h4 className="text-sm font-semibold text-slate-900 mb-1 line-clamp-2">{mem.goal}</h4>
               <div className="mt-3 bg-slate-50 rounded p-3 text-sm text-slate-600 font-mono border border-slate-100">
                 <span className="text-slate-400 font-bold block mb-1">Outcome:</span>
                 {mem.outcome}
               </div>
               <div className="mt-3 text-right">
                 <span className="text-[10px] text-slate-400 font-mono uppercase tracking-widest">
                   Source Task: {mem.task_id.split('-')[0]}
                 </span>
               </div>
             </div>
          ))}
        </div>
      )}
    </div>
  );
}

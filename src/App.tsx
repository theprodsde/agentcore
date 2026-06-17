import React from "react";
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from "react-router-dom";
import { Activity, LayoutDashboard, PlusCircle, Brain, PlaySquare } from "lucide-react";
import { cn } from "./lib/utils";
import Dashboard from "./pages/Dashboard";
import NewTask from "./pages/NewTask";
import TaskDetail from "./pages/TaskDetail";
import MemoryExplorer from "./pages/MemoryExplorer";
import DemoScenarios from "./pages/DemoScenarios";

export default function App() {
  return (
    <Router>
      <div className="flex h-screen w-full bg-[#FAFAFA] text-slate-900 font-sans">
        <aside className="w-64 border-r border-slate-200 bg-white flex flex-col items-start justify-start flex-shrink-0">
          <div className="h-16 w-full flex items-center px-6 border-b border-slate-100">
            <Activity className="h-6 w-6 text-indigo-600 mr-2" />
            <h1 className="font-semibold text-lg tracking-tight">AgentCore</h1>
          </div>
          
          <nav className="w-full p-4 flex flex-col gap-1 flex-1">
            <NavItem to="/" icon={<LayoutDashboard size={18} />} label="Dashboard" />
            <NavItem to="/tasks/new" icon={<PlusCircle size={18} />} label="New Task" />
            <NavItem to="/memory" icon={<Brain size={18} />} label="Memory" />
            <div className="mt-8 mb-2 px-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">Playground</div>
            <NavItem to="/demo" icon={<PlaySquare size={18} />} label="Scenarios" />
          </nav>
        </aside>

        <main className="flex-1 overflow-auto bg-[#FAFAFA]">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/tasks/new" element={<NewTask />} />
            <Route path="/tasks/:taskId" element={<TaskDetail />} />
            <Route path="/memory" element={<MemoryExplorer />} />
            <Route path="/demo" element={<DemoScenarios />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

function NavItem({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  const location = useLocation();
  const isActive = location.pathname === to || (to !== '/' && location.pathname.startsWith(to));
  
  return (
    <Link 
      to={to} 
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer",
        isActive 
          ? "bg-indigo-50 text-indigo-700" 
          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
      )}
    >
      {icon}
      {label}
    </Link>
  )
}

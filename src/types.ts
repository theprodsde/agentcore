export interface CodeSnippet {
  path: string;
  language: string;
  title: string;
  description: string;
  recoveryFeatures: string[];
  code: string;
}

export interface SimulatedIncident {
  id: string;
  title: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "pending" | "running" | "paused" | "completed" | "failed";
  channel: string;
  logs: string[];
  createdAt: string;
  durationMs?: number;
  traceId: string;
  checkpoints: CheckpointRecord[];
  memoryHits: EpisodicMemory[];
  finalOutput?: string;
  summary?: string;
}

export interface CheckpointRecord {
  stepNumber: number;
  stepName: string;
  stepStatus: "pending" | "running" | "success" | "failed";
  outputData?: string;
  errorInfo?: string;
  durationMs?: number;
}

export interface EpisodicMemory {
  id: string;
  userId: string;
  taskId?: string;
  goal: string;
  outcome: string;
  similarity?: number;
  createdAt: string;
}

export interface MetricSummary {
  totalIncidents: number;
  averageResponseTimeSec: number;
  successRate: number;
  activeIncidents: number;
  memoryRecallHits: number;
}

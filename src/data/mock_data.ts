import { SimulatedIncident, EpisodicMemory } from "../types";

export const PRESET_INCIDENTS: Omit<SimulatedIncident, "id" | "createdAt" | "traceId">[] = [
  {
    title: "Critical Database CPU Spike on prod-pg-01",
    description: "CloudWatch alert: pg_stat_activity shows total connections exceeding 95% limit with idle transaction locks on catalog queries.",
    severity: "critical",
    status: "pending",
    channel: "#ops-severity-1",
    logs: [
      "[SYSTEM] Triggering critical incident response mechanism via Slack webhook.",
      "[ORCHESTRATOR] Acquiring task mutex lock lock:step_lock:cognitive_planning on Redis...",
      "[ORCHESTRATOR] Lock acquired. Acquiring ILLMClient 'gpt-4o-mini' interface.",
      "[COGNITIVE_PLAN] Querying episodic memory for past database lock resolutions.",
      "[pgvector ENGINE] Performing cosine similarity lookup over dense vector indexes..."
    ],
    checkpoints: [
      {
        stepNumber: 1,
        stepName: "Cognitive Planning & Memory Retrieval",
        stepStatus: "pending"
      },
      {
        stepNumber: 2,
        stepName: "MCP Tool Diagnostics (Kubernetes Kube-logs + PG Stat)",
        stepStatus: "pending"
      },
      {
        stepNumber: 3,
        stepName: "Synthesis & Remediation Automation",
        stepStatus: "pending"
      }
    ],
    memoryHits: []
  },
  {
    title: "Auth Service Container Memory Leak",
    description: "Kubernetes event: auth-service-pods-xyz-789 reboot loop with OOMKilled status on node-region-b.",
    severity: "high",
    status: "pending",
    channel: "#ops-severity-2",
    logs: [
      "[SYSTEM] K8s daemon reported Pod crash loop. Slack Incident Commander engaged.",
      "[ORCHESTRATOR] Generated task ID context. Initializing checkpoint loggers.",
      "[COGNITIVE_PLAN] Invoking MemoryAgent cognitive planner with context: auth-service OOMKilled."
    ],
    checkpoints: [
      {
        stepNumber: 1,
        stepName: "Cognitive Planning & Memory Retrieval",
        stepStatus: "pending"
      },
      {
        stepNumber: 2,
        stepName: "MCP Tool Diagnostics (Kubernetes Kube-logs + PG Stat)",
        stepStatus: "pending"
      },
      {
        stepNumber: 3,
        stepName: "Synthesis & Remediation Automation",
        stepStatus: "pending"
      }
    ],
    memoryHits: []
  },
  {
    title: "Payment Service Latency Spike > 15s",
    description: "Stripe webhook timeouts leading to customer checkout drops in EU-Central-1 zone.",
    severity: "high",
    status: "pending",
    channel: "#ops-severity-1",
    logs: [
      "[SYSTEM] Webhook monitor reported high latency rate in checkout modules.",
      "[ORCHESTRATOR] Locked step scheduler context. Loading episodic pgvector databases."
    ],
    checkpoints: [
      {
        stepNumber: 1,
        stepName: "Cognitive Planning & Memory Retrieval",
        stepStatus: "pending"
      },
      {
        stepNumber: 2,
        stepName: "MCP Tool Diagnostics (Kubernetes Kube-logs + PG Stat)",
        stepStatus: "pending"
      },
      {
        stepNumber: 3,
        stepName: "Synthesis & Remediation Automation",
        stepStatus: "pending"
      }
    ],
    memoryHits: []
  }
];

export const DEFAULT_MEMORIES: EpisodicMemory[] = [
  {
    id: "mem-001",
    userId: "slack-worker-01",
    goal: "Handle high database connection pool depletion and lock contamination",
    outcome: "Identified idle transactions from reporting-service. Terminated connections using SELECT pg_terminate_backend(pid); increased pool size from 100 to 250.",
    similarity: 0.94,
    createdAt: "2026-06-10T11:20:00Z"
  },
  {
    id: "mem-002",
    userId: "slack-worker-02",
    goal: "Handle Stripe API timeouts and checkout webhook failures",
    outcome: "Reconfigured connection keep-alive in node client. Implemented circuit breaker with fallback. Switched DNS resolve timeout filter from standard to local caching resolver.",
    similarity: 0.42,
    createdAt: "2026-06-12T15:45:00Z"
  },
  {
    id: "mem-003",
    userId: "slack-worker-01",
    goal: "Resolve Go auth-service container OOM memory leak",
    outcome: "Analyzed pprof heap logs. Discovered runaway goroutine leaky channel. Rebuilt container with Go memory limit set to GOMEMLIMIT=800MiB to trigger clean GC.",
    similarity: 0.88,
    createdAt: "2026-06-14T09:15:00Z"
  },
  {
    id: "mem-004",
    userId: "slack-worker-03",
    goal: "Handle Redis cluster replica replication lag",
    outcome: "Adjusted main redis client maxmemory-policy to volatile-lru. Enlarged TCP backlog limit. Added automated client retry with backoff.",
    similarity: 0.31,
    createdAt: "2026-06-15T18:30:00Z"
  }
];

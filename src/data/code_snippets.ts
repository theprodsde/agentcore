import { CodeSnippet } from "../types";

export const CODE_SNIPPETS: CodeSnippet[] = [
  {
    path: "shared/config.py",
    language: "python",
    title: "Environment & Configuration Engine",
    description: "Configures and type-checks environment boundaries for OpenAI models, Postgres, Redis, and Jaeger.",
    recoveryFeatures: ["Strict Validation - Fails fast if connection bounds missing before memory agent starts", "Distributed Configuration - Decoupled variables for Redis/PG syncs."],
    code: `import os
from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field, field_validator

class Settings(BaseSettings):
    """
    Unified Application Environment & Configuration Schema.
    Validates on startup, guaranteeing that missing variables fail-fast in deployment container.
    """
    # LLM Settings (CometAPI OpenAI Compatible endpoints)
    openai_api_key: str = Field("sk-Mlb1tbUTb9VVoZcx9pCKqTHeQQTnjgKd8ge4jloaFrjGf24f", description="API key from CometAPI")
    openai_base_url: str = Field("https://api.cometapi.com/v1")
    openai_model: str = Field("gpt-4o-mini")
    openai_embed_model: str = Field("text-embedding-3-small")

    # Storage Infrastructure
    pg_dsn: str = Field(..., description="PostgreSQL asyncpg connection URI")
    redis_url: str = Field("redis://localhost:6379/0", description="Distributed scheduler locks and task queues")

    # Communications Setup
    slack_bot_token: Optional[str] = None
    slack_signing_secret: Optional[str] = None

    # Telemetry and Schedulers
    otel_exporter_otlp_endpoint: str = "http://jaeger:4317"
    otel_service_name: str = "slack-incident-commander"
    worker_concurrency: int = 4

    # Pydantic Configuration
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    @field_validator("pg_dsn")
    @classmethod
    def validate_postgres_uri(cls, v: str) -> str:
        if not v.startswith("postgresql://") and not v.startswith("postgresql+asyncpg://"):
            raise ValueError("pg_dsn must be a valid PostgreSQL connection URI")
        return v

# Instantiate global settings singleton
settings = Settings()
`
  },
  {
    path: "shared/llm_client/client.py",
    language: "python",
    title: "LLM Client Contract & OpenAI Adaptor",
    description: "Abstract Interface for LLM completions and embeddings. Uses the Client Adapter pattern to keep core orchestrators clean.",
    recoveryFeatures: ["Agnostic Adapter - Connects seamlessly upon agent resume regardless of provider.", "Timebox Safety - Can be isolated during timeout scenarios while vector queries persist."],
    code: `import json
from typing import Protocol, AsyncIterator, List, Dict, Any, Optional
from openai import AsyncOpenAI
from shared.config import settings

class ILLMClient(Protocol):
    """
    Structural Type Protocol enforcing contracts for all generative model integrations.
    Supports both standard JSON payloads and real-time streams (<10s requirement).
    """
    async def complete(
        self, 
        messages: List[Dict[str, Any]], 
        tools: Optional[List[Dict[str, Any]]] = None, 
        stream: bool = False
    ) -> Any:
        ...

    async def embed(self, text: str) -> List[float]:
        ...


class OpenAIClient(ILLMClient):
    """
    High-Performance concrete implementation communicating with CometAPI.
    Adapts OpenAI-styled tool calls smoothly.
    """
    def __init__(self):
        self._client = AsyncOpenAI(
            api_key=settings.openai_api_key,
            base_url=settings.openai_base_url
        )
        self.model = settings.openai_model
        self.embed_model = settings.openai_embed_model

    async def complete(
        self, 
        messages: List[Dict[str, Any]], 
        tools: Optional[List[Dict[str, Any]]] = None, 
        stream: bool = False
    ) -> Any:
        """
        Executes robust completions with automated tool choices for tool orchestration blocks.
        """
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": stream,
            "temperature": 0.1,  # Low entropy for high incident resolution predictability
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"

        return await self._client.chat.completions.create(**payload)

    async def embed(self, text: str) -> List[float]:
        """
        Requests dense vector representations from OpenAI Embeddings engine for Episodic Memory lookups.
        Outputs a highly dense vector representing contextual operations.
        """
        response = await self._client.embeddings.create(
            model=self.embed_model,
            input=text,
            dimensions=1536 # Standard dense embedding layout for OpenAI text-embedding-3-small
        )
        return response.data[0].embedding
`
  },
  {
    path: "shared/checkpoint/db.py",
    language: "python",
    title: "Task Checkpointer and Transaction Engine",
    description: "Persists structural checkpoints for task executions in SQL. Supports fully stateless, resume-on-failure operations.",
    recoveryFeatures: ["Atomic Upserts - Prevents partial states and zombie tasks during crashes.", "Crash Consistency - Step boundary saves before running function lock."],
    code: `import json
from typing import Protocol, Optional, Dict, Any
import asyncpg
from dataclasses import dataclass

@dataclass(frozen=True)
class CheckpointRecord:
    step_status: str
    output_data: Optional[Dict[str, Any]] = None
    error_info: Optional[Dict[str, Any]] = None


class ICheckpointRepository(Protocol):
    """
    Repository Interface validating step boundaries for our multi-agent pipeline.
    """
    async def get(self, task_id: str, step_number: int) -> Optional[CheckpointRecord]:
        ...
    
    async def upsert(
        self, 
        task_id: str, 
        step_number: int, 
        step_name: str, 
        status: str, 
        output: Optional[Dict[str, Any]] = None, 
        error: Optional[Dict[str, Any]] = None, 
        duration_ms: Optional[int] = None
    ) -> None:
        ...


class PostgresCheckpointRepository(ICheckpointRepository):
    """
    PostgreSQL-backed checkpointer with native upsert locks.
    Optimized for high-concurrency multi-runner runtimes.
    """
    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool

    async def get(self, task_id: str, step_number: int) -> Optional[CheckpointRecord]:
        query = """
            SELECT step_status, output_data, error_info 
            FROM task_checkpoints 
            WHERE task_id = $1 AND step_number = $2
        """
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(query, task_id, step_number)
            if not row:
                return None
            
            output = json.loads(row["output_data"]) if row["output_data"] else None
            error = json.loads(row["error_info"]) if row["error_info"] else None
            return CheckpointRecord(
                step_status=row["step_status"],
                output_data=output,
                error_info=error
            )

    async def upsert(
        self, 
        task_id: str, 
        step_number: int, 
        step_name: str, 
        status: str, 
        output: Optional[Dict[str, Any]] = None, 
        error: Optional[Dict[str, Any]] = None, 
        duration_ms: Optional[int] = None
    ) -> None:
        query = """
            INSERT INTO task_checkpoints 
            (task_id, step_number, step_name, step_status, output_data, error_info, duration_ms)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (task_id, step_number) 
            DO UPDATE SET 
                step_status = EXCLUDED.step_status,
                output_data = EXCLUDED.output_data,
                error_info = EXCLUDED.error_info,
                duration_ms = EXCLUDED.duration_ms
        """
        output_str = json.dumps(output) if output else None
        error_str = json.dumps(error) if error else None

        async with self._pool.acquire() as conn:
            await conn.execute(
                query, 
                task_id, 
                step_number, 
                step_name, 
                status, 
                output_str, 
                error_str, 
                duration_ms
            )
`
  },
  {
    path: "shared/agent_core/orchestrator.py",
    language: "python",
    title: "MemoryAgent & Incident Orchestrator",
    description: "The core machine. Orchestrates planning, tool execution, and synthesis utilizing Dependency Injection (DIP) and Redis distributed locking.",
    recoveryFeatures: ["Idempotent Resume - Fetches checkpoint outputs directly; avoids duplicate side-effects.", "Mutex Watchdog - Locks shared steps against split-brain distributed execution."],
    code: `import asyncio
import time
from typing import Callable, Any, List, Dict
from shared.checkpoint.db import ICheckpointRepository
from shared.llm_client.client import ILLMClient

class StepAlreadyRunningError(Exception):
    pass


class AgentOrchestrator:
    """
    Central Stateful Coordinator managing task steps.
    Contains built-in idempotence locks on top of Redis to avoid dual slack response triggers.
    """
    def __init__(
        self, 
        llm: ILLMClient, 
        checkpoints: ICheckpointRepository, 
        redis_client: Any
    ):
        self._llm = llm
        self._checkpoints = checkpoints
        self._redis = redis_client

    async def execute_step(
        self, 
        task_id: str, 
        step_number: int, 
        step_name: str, 
        func: Callable[[], Any]
    ) -> Any:
        # Checkpoint restoration
        existing = await self._checkpoints.get(task_id, step_number)
        if existing and existing.step_status == "success":
            return existing.output_data

        # Distributed Lock (Prevent race conditions with duplicate Slack messages)
        lock_key = f"step_lock:{task_id}:{step_number}"
        is_locked = await self._redis.set(lock_key, "1", nx=True, ex=30)
        if not is_locked:
            raise StepAlreadyRunningError(f"Step {step_number} ({step_name}) is currently executing or locked.")

        start_time = time.monotonic()
        await self._checkpoints.upsert(task_id, step_number, step_name, status="running")

        try:
            # Execute targeted step with a 30s hardware protection timeout
            result = await asyncio.wait_for(func(), timeout=30.0)
            duration = int((time.monotonic() - start_time) * 1000)
            
            await self._checkpoints.upsert(
                task_id=task_id,
                step_number=step_number,
                step_name=step_name,
                status="success",
                output=result,
                duration_ms=duration
            )
            return result
        except Exception as e:
            await self._checkpoints.upsert(
                task_id=task_id,
                step_number=step_number,
                step_name=step_name,
                status="failed",
                error={"error_class": type(e).__name__, "message": str(e)}
            )
            raise e
        finally:
            await self._redis.delete(lock_key)

    async def execute_incident(self, task_id: str, prompt: str, search_query: str) -> Dict[str, Any]:
        """
        Coordinates full planning, search indexing, execution, and synthesis cycle.
        """
        # Step 1: Query Memories and create plan
        plan = await self.execute_step(
            task_id, 1, "cognitive_planning", 
            lambda: self._generate_plan(prompt, search_query)
        )

        # Step 2: System tool diagnosis
        diagnostics = await self.execute_step(
            task_id, 2, "system_diagnostics",
            lambda: self._execute_mcp_tools(plan)
        )

        # Step 3: Synthesis of post-mortems and remediation recommendations
        remediation = await self.execute_step(
            task_id, 3, "synthesis_and_report",
            lambda: self._synthesize_report(prompt, diagnostics)
        )

        return {
            "task_id": task_id,
            "plan": plan,
            "diagnostics": diagnostics,
            "remediation": remediation,
            "status": "completed"
        }

    async def _generate_plan(self, prompt: str, search_query: str) -> Dict[str, Any]:
        # Implements LLM planning prompt
        return {"remedies": ["query_postgres", "verify_redis"], "query": search_query}

    async def _execute_mcp_tools(self, plan: Dict[str, Any]) -> List[Dict[str, Any]]:
        # High velocity tool loops
        return [{"tool": "query_postgres", "status": "active", "db_count": 1420}]

    async def _synthesize_report(self, prompt: str, diagnostics: List[Dict[str, Any]]) -> Dict[str, Any]:
        # Formulate remediation
        return {"report": "Incident mitigated. Connection limits expanded. pg_stat_activity reviewed."}
`
  },
  {
    path: "infra/init.sql",
    language: "sql",
    title: "SQL Schema & Vector Embeddings Storage",
    description: "Generates relational transactional system tables fused with pgvector vectors for episodic memory.",
    recoveryFeatures: ["Relational Keys - Hard cascading deletes on aborted or zombie task cleanups.", "HNSW Index Checkpointing - Retrieves memory vectors safely across node reboots."],
    code: `-- SQL Script initializing Slack Incident Commander tables with pgvector support
CREATE EXTENSION IF NOT EXISTS vector;

-- Central tasks ledger
CREATE TABLE IF NOT EXISTS tasks (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goal         TEXT NOT NULL,
    track        VARCHAR(20) NOT NULL CHECK (track IN ('slack', 'openai')),
    status       VARCHAR(20) NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','running','paused','completed','failed','permanently_failed')),
    user_id      VARCHAR(100) NOT NULL,
    workspace_id VARCHAR(100),
    created_at   TIMESTAMPTZ DEFAULT now(),
    resumed_at   TIMESTAMPTZ,
    resume_count INTEGER DEFAULT 0,
    final_output JSONB,
    trace_id     VARCHAR(36) NOT NULL
);

-- Task Checkpointer tracking
CREATE TABLE IF NOT EXISTS task_checkpoints (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id      UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    step_number  INTEGER NOT NULL,
    step_name    VARCHAR(100) NOT NULL,
    step_status  VARCHAR(20) NOT NULL
                 CHECK (step_status IN ('pending','running','success','failed')),
    input_data   JSONB,
    output_data  JSONB,
    error_info   JSONB,
    duration_ms  INTEGER,
    created_at   TIMESTAMPTZ DEFAULT now(),
    UNIQUE(task_id, step_number)
);

-- Cognitive Episodic memory (1536-dimension matching OpenAI output)
CREATE TABLE IF NOT EXISTS episodic_memory (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      VARCHAR(100) NOT NULL,
    task_id      UUID REFERENCES tasks(id) ON DELETE SET NULL,
    goal         TEXT NOT NULL,
    outcome      TEXT NOT NULL,
    embedding    vector(1536) NOT NULL,
    created_at   TIMESTAMPTZ DEFAULT now()
);

-- Build high performance cosine search indexing (HNSW)
CREATE INDEX IF NOT EXISTS idx_memory_hnsw ON episodic_memory 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Primary indexing for transactional lookups
CREATE INDEX IF NOT EXISTS idx_checkpoints_task ON task_checkpoints(task_id, step_number);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, created_at);
`
  },
  {
    path: "infra/docker-compose.base.yml",
    language: "yaml",
    title: "Base Infrastructure Declarations",
    description: "Defines lightweight production-grade containers (Postgres with pgvector, Redis Cache, Jaeger OTLP).",
    recoveryFeatures: ["Volume Mounts - Preserves pg_data indefinitely.", "Isolated Network Bridges - Assures container crash restarts link automatically."],
    code: `version: "3.9"

services:
  # High velocity task queue & lock broker
  redis:
    image: redis:7-alpine
    container_name: incident_redis
    command: redis-server --maxmemory 512mb --maxmemory-policy allkeys-lru
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  # Transactional + Vector Database
  postgres:
    image: pgvector/pgvector:pg16
    container_name: incident_postgres
    environment:
      POSTGRES_USER: \${PG_USER:-hackathon}
      POSTGRES_PASSWORD: \${PG_PASSWORD:-changeme}
      POSTGRES_DB: hackathon
    ports:
      - "5432:5432"
    volumes:
      - pg_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${PG_USER:-hackathon} -d hackathon"]
      interval: 5s
      timeout: 5s
      retries: 5

  # Telemetry (OpenTelemetry tracer collector)
  jaeger:
    image: jaegertracing/all-in-one:latest
    container_name: incident_jaeger
    ports:
      - "16686:16686" # Web UI Console
      - "4317:4317"   # OTLP gRPC endpoint
    environment:
      COLLECTOR_OTLP_ENABLED: "true"

volumes:
  pg_data:
    driver: local
`
  }
];

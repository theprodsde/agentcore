import "dotenv/config";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { trace, context, SpanStatusCode, type Span } from "@opentelemetry/api";

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

const spanProcessors = endpoint
  ? [new BatchSpanProcessor(new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }))]
  : [];

const provider = new NodeTracerProvider({
  resource: resourceFromAttributes({
    "service.name": "agentcore",
    "service.version": "0.1.0",
    "deployment.environment": process.env.NODE_ENV ?? "development",
  }),
  spanProcessors,
});

provider.register();

export const tracer = trace.getTracer("agentcore", "0.1.0");
export { context, SpanStatusCode, trace };
export type { Span };

/** Returns active trace/span IDs for log correlation — empty object when no active span. */
export function activeTraceContext(): Record<string, string> {
  const span = trace.getActiveSpan();
  if (!span) return {};
  const ctx = span.spanContext();
  return { trace_id: ctx.traceId, span_id: ctx.spanId };
}

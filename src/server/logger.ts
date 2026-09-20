import pino from "pino";
import { activeTraceContext } from "./telemetry.js";

// pino-pretty is a dev convenience — in production emit raw NDJSON so log
// aggregators (Loki, CloudWatch, ...) can parse fields, and skip the
// formatting worker overhead on every log line.
const prettyTransport = process.env.NODE_ENV === "production"
  ? {}
  : {
      transport: {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:standard" },
      },
    };

export const logger = pino({
  level: process.env.LOG_LEVEL || "warn",
  mixin() {
    return activeTraceContext();
  },
  ...prettyTransport,
});

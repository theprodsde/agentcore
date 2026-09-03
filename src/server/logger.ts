import pino from "pino";
import { activeTraceContext } from "./telemetry.js";

export const logger = pino({
  level: process.env.LOG_LEVEL || "warn",
  mixin() {
    return activeTraceContext();
  },
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:standard",
    },
  },
});

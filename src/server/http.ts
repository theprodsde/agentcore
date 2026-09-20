import type { Request, Response, NextFunction, RequestHandler } from "express";
import { logger } from "./logger.js";
import { toErrorMessage } from "../utils/index.js";

// Express 4 does not forward rejected promises from async handlers to the
// error middleware — the request hangs forever. Every async route handler
// must be wrapped so a DB/LLM failure becomes a 500 instead of a stuck client.
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/** Final JSON error middleware — mount after all routes. */
export function errorMiddleware(err: unknown, req: Request, res: Response, _next: NextFunction) {
  logger.error({ err, path: req.path, method: req.method }, "Unhandled route error");
  if (res.headersSent) return res.end();
  return res.status(500).json({ error: "Internal server error", details: toErrorMessage(err) });
}

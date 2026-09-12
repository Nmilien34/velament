import type { RequestHandler } from "express";
import { consumeBudget } from "../services/rate-limit.service.js";
import { HttpError } from "../utils/errors.js";
export function rateLimit(
  scope: string,
  limit: number,
  windowMs: number,
): RequestHandler {
  return async (req, res, next) => {
    const budget = await consumeBudget(
      scope,
      res.locals.userId || req.ip || "unknown",
      limit,
      windowMs,
    );
    if (!budget.allowed) {
      res.set("Retry-After", String(budget.retryAfter));
      throw new HttpError(
        429,
        "RATE_LIMITED",
        "Too many requests. Try again shortly",
      );
    }
    next();
  };
}

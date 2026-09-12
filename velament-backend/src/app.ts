import { operations } from "./routes/operations.js";
import { checkReadiness } from "./services/readiness.service.js";
import { auth } from "./routes/auth.js";
import { account } from "./routes/account.js";
import express from "express";
import { webhooks } from "./routes/webhooks.js";
import { github } from "./routes/github.js";
import { api } from "./routes/api.js";
import { HttpError } from "./utils/errors.js";
import { ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { corsOptions } from "./config/cors.js";
import cors from "cors";
import helmet from "helmet";
import type { HealthResponse, ApiError } from "@velament/shared";
export function createApp(origin: string) {
  const app = express();
  app.locals.allowedOrigins = new Set(
    origin.split(",").map((value) => new URL(value.trim()).origin),
  );
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Request-Id", randomUUID());
    next();
  });
  app.use("/api/webhooks", webhooks);
  app.use(helmet(), cors(corsOptions(origin)), express.json({ limit: "1mb" }));
  app.get("/api/health", (_req, res) => {
    const body: HealthResponse = { status: "ok", service: "velament-api" };
    res.json(body);
  });
  app.get("/api/ready", async (_req, res) => {
    const body = app.locals.draining
      ? { status: "not-ready", service: "velament-api" }
      : await checkReadiness();
    res
      .set("Cache-Control", "no-store")
      .status(body.status === "ready" ? 200 : 503)
      .json(body);
  });
  app.use("/internal", operations);
  app.use("/api/auth", auth);
  app.use("/api/github", github);
  app.use("/api", account);
  app.use("/api", api);
  app.use((_req, res) => {
    const body: ApiError = {
      error: { code: "NOT_FOUND", message: "Route not found" },
    };
    res.status(404).json(body);
  });
  const errors: express.ErrorRequestHandler = (error, _req, res, _next) => {
    if (!(error instanceof HttpError) && !(error instanceof ZodError))
      console.error("Request failed", {
        requestId: res.getHeader("X-Request-Id"),
        name: error?.name,
      });
    const body: ApiError = {
      error: {
        code:
          error instanceof HttpError
            ? error.code
            : error instanceof ZodError
              ? "VALIDATION_ERROR"
              : error?.code === 11000
                ? "DUPLICATE"
                : "REQUEST_FAILED",
        message:
          error instanceof HttpError
            ? error.message
            : error instanceof ZodError
              ? "Invalid request fields"
              : "Request could not be processed",
      },
    };
    const status =
      error instanceof HttpError
        ? error.status
        : error instanceof ZodError
          ? 400
          : error?.code === 11000
            ? 409
            : error?.type === "entity.too.large"
              ? 413
              : error instanceof SyntaxError
                ? 400
                : 500;
    res.status(status).json(body);
  };
  app.use(errors);
  return app;
}

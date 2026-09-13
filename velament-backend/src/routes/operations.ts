import { objectId } from "@velament/shared";
import { z } from "zod";
import { workerState } from "../services/job.service.js";
import { Router } from "express";
import { timingSafeEqual, createHash } from "node:crypto";
import { Job } from "../models/Job.js";
import { Dispatch } from "../models/Dispatch.js";
import { HttpError } from "../utils/errors.js";
export const operations = Router();
operations.use((req, res, next) => {
  const secret = process.env.OPERATIONS_TOKEN;
  if (!secret || secret.length < 32)
    throw new HttpError(
      503,
      "MONITORING_NOT_CONFIGURED",
      "Monitoring is not configured",
    );
  const actual = req.get("authorization") || "";
  const hash = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(hash(actual), hash("Bearer " + secret)))
    throw new HttpError(
      401,
      "UNAUTHENTICATED",
      "Invalid monitoring credential",
    );
  res.set("Cache-Control", "no-store");
  next();
});
operations.get("/metrics", async (_req, res) => {
  const now = new Date();
  const [queued, running, failed, expired, unknown, oldest, stalePending] =
    await Promise.all([
      Job.countDocuments({ status: "queued" }),
      Job.countDocuments({ status: "running" }),
      Job.countDocuments({ status: "failed" }),
      Job.countDocuments({ status: "running", leaseUntil: { $lt: now } }),
      Dispatch.countDocuments({
        status: "unknown",
        resolution: { $exists: false },
      }),
      Job.findOne({ status: "queued", availableAt: { $lte: now } })
        .sort({ createdAt: 1 })
        .select("createdAt"),
      Dispatch.countDocuments({
        status: "pending",
        createdAt: { $lt: new Date(Date.now() - 120000) },
      }),
    ]);
  res.set("Cache-Control", "no-store").json({
    data: {
      uptimeSeconds: Math.floor(process.uptime()),
      queue: {
        queued,
        running,
        failed,
        expiredLeases: expired,
        oldestReadyAgeSeconds: oldest
          ? Math.floor((now.getTime() - oldest.createdAt.getTime()) / 1000)
          : 0,
      },
      unknownDispatches: unknown,
      stalePendingDispatches: stalePending,
      worker: {
        started: workerState.started,
        heartbeatAgeSeconds: workerState.lastHeartbeat
          ? Math.floor((Date.now() - workerState.lastHeartbeat) / 1000)
          : null,
        pollingFailures: workerState.failures,
      },
    },
  });
});

operations.post("/jobs/:id/retry", async (req, res) => {
  z.object({ retry: z.literal(true) })
    .strict()
    .parse(req.body);
  const job = await Job.findOneAndUpdate(
    { _id: objectId.parse(req.params.id), kind: "webhook", status: "failed" },
    {
      $set: { status: "queued", attempts: 0, availableAt: new Date() },
      $unset: { errorCode: 1, leaseUntil: 1, leaseToken: 1 },
    },
    { new: true },
  );
  if (!job)
    throw new HttpError(
      409,
      "JOB_NOT_RETRYABLE",
      "Only failed webhook jobs can be retried here",
    );
  res.status(202).json({ data: { id: job.id, status: job.status } });
});

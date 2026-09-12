import { Router } from "express";
import { timingSafeEqual, createHash } from "node:crypto";
import { Job } from "../models/Job.js";
import { Dispatch } from "../models/Dispatch.js";
import { HttpError } from "../utils/errors.js";
export const operations = Router();
operations.get("/metrics", async (req, res) => {
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
  const now = new Date();
  const [queued, running, failed, expired, unknown, oldest] = await Promise.all(
    [
      Job.countDocuments({ status: "queued" }),
      Job.countDocuments({ status: "running" }),
      Job.countDocuments({ status: "failed" }),
      Job.countDocuments({ status: "running", leaseUntil: { $lt: now } }),
      Dispatch.countDocuments({ status: "unknown" }),
      Job.findOne({ status: "queued", availableAt: { $lte: now } })
        .sort({ createdAt: 1 })
        .select("createdAt"),
    ],
  );
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
    },
  });
});

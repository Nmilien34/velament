import { processDeletion } from "./deletion.service.js";
import { revokeAccess } from "./access.service.js";
import { randomUUID } from "node:crypto";
import { Job } from "../models/Job.js";
import { Activity } from "../models/Activity.js";
import { Project } from "../models/Project.js";
import { GitHubConnection } from "../models/GitHubConnection.js";
import { analyze } from "./project.service.js";
import { importRun } from "./run.service.js";
import { HttpError } from "../utils/errors.js";
import { z } from "zod";
export async function enqueueAnalysis(projectId: string, key: string) {
  const jobKey = "analysis:" + projectId + ":" + key;
  const existing = await Job.findOne({ key: jobKey });
  if (existing) return existing;
  const project = await Project.findOne({ _id: projectId, archivedAt: null });
  if (!project) throw new HttpError(404, "NOT_FOUND", "Project not found");
  return Job.findOneAndUpdate(
    { key: jobKey },
    {
      $setOnInsert: {
        kind: "analysis",
        projectId,
        status: "queued",
        requestedBranch: project.branch,
      },
    },
    { new: true, upsert: true, runValidators: true },
  );
}
async function webhook(payload: unknown, deliveryKey: string) {
  const p = z
    .object({
      event: z.string(),
      body: z.object({
        action: z.string().optional(),
        sender: z.object({ id: z.number() }).optional(),
        installation: z.object({ id: z.number() }).optional(),
        repository: z.object({ id: z.number() }).optional(),
        repositories_removed: z
          .array(z.object({ id: z.number().int().positive() }))
          .optional(),
        ref: z.string().optional(),
        deleted: z.boolean().optional(),
        workflow_run: z.object({ id: z.number() }).optional(),
      }),
    })
    .parse(payload);
  if (
    p.event === "github_app_authorization" &&
    p.body.action === "revoked" &&
    p.body.sender
  ) {
    const connections = await GitHubConnection.find({
      githubUserId: p.body.sender.id,
    }).select("userId");
    for (const c of connections) await revokeAccess(c.userId.toString());
    return;
  }
  if (!p.body.installation) return;
  if (p.event === "installation_repositories" && p.body.action === "removed") {
    await Project.updateMany(
      {
        installationId: p.body.installation.id,
        repositoryId: {
          $in: (p.body.repositories_removed ?? []).map((r) => r.id),
        },
        archivedAt: null,
      },
      { $set: { connectionState: "unavailable" } },
    );
    return;
  }
  const projects = await Project.find({
    installationId: p.body.installation.id,
    archivedAt: null,
    deletingAt: null,
  });
  for (const project of projects) {
    if (
      p.event === "installation" &&
      ["deleted", "suspend"].includes(p.body.action || "")
    ) {
      await Project.updateOne(
        { _id: project.id },
        { $set: { connectionState: "unavailable" } },
      );
      continue;
    }
    if (p.event === "installation" && p.body.action === "unsuspend") {
      await Project.updateOne(
        { _id: project.id },
        { $set: { connectionState: "active" } },
      );
      continue;
    }
    if (p.body.repository?.id !== project.repositoryId) continue;
    if (p.event === "push" && p.body.ref === "refs/heads/" + project.branch) {
      if (
        project.analyzeOnPush &&
        !p.body.deleted &&
        project.connectionState !== "unavailable"
      ) {
        await Job.findOneAndUpdate(
          { key: "push-analysis:" + deliveryKey + ":" + project.id },
          {
            $setOnInsert: {
              kind: "analysis",
              projectId: project.id,
              status: "queued",
              requestedBranch: project.branch,
            },
          },
          { upsert: true, new: true, runValidators: true },
        );
      }
      await Activity.updateOne(
        { eventKey: deliveryKey + ":" + project.id },
        {
          $setOnInsert: {
            projectId: project.id,
            kind: "push",
            message:
              "A new push is available. Analyze the branch to review it.",
          },
        },
        { upsert: true },
      );
    }
    if (p.event === "workflow_run" && p.body.workflow_run)
      await importRun(project.id, p.body.workflow_run.id);
  }
}
export const workerState = { started: false, lastHeartbeat: 0, failures: 0 };
export async function processNextJob(kind?: "analysis" | "webhook") {
  await Job.updateMany(
    {
      cancelRequested: true,
      $or: [
        { status: "queued" },
        { status: "running", leaseUntil: { $lt: new Date() } },
      ],
    },
    { $set: { status: "cancelled" }, $unset: { leaseUntil: 1, leaseToken: 1 } },
  );
  await Job.updateMany(
    {
      status: "running",
      attempts: { $gte: 3 },
      leaseUntil: { $lt: new Date() },
    },
    {
      $set: { status: "failed", errorCode: "WORKER_INTERRUPTED" },
      $unset: { leaseUntil: 1, leaseToken: 1 },
    },
  );
  const now = new Date();
  const leaseToken = randomUUID();
  const job = await Job.findOneAndUpdate(
    {
      ...(kind ? { kind } : {}),
      attempts: { $lt: 3 },
      $or: [
        { status: "queued", availableAt: { $lte: now } },
        { status: "running", leaseUntil: { $lt: now } },
      ],
    },
    {
      $set: {
        status: "running",
        leaseUntil: new Date(Date.now() + 1200000),
        leaseToken,
      },
      $inc: { attempts: 1 },
    },
    { new: true, sort: { createdAt: 1 } },
  );
  if (!job) return false;
  try {
    if (job.cancelRequested) {
      await Job.updateOne(
        { _id: job.id, leaseToken },
        {
          $set: { status: "cancelled" },
          $unset: { leaseUntil: 1, leaseToken: 1 },
        },
      );
      return true;
    }
    let resultId: string | undefined;
    if (job.kind === "analysis") {
      if (!job.requestedBranch)
        throw new HttpError(
          422,
          "JOB_SCOPE_MISSING",
          "This legacy job has no captured branch. Request a new analysis",
        );
      const result = await analyze(
        job.projectId!.toString(),
        job.requestedBranch,
        { id: job.id, leaseToken },
      );
      resultId = result?.id;
    } else await webhook(job.payload, job.key);
    const completed = await Job.updateOne(
      { _id: job.id, leaseToken, status: "running" },
      [
        {
          $set: {
            status: { $cond: ["$cancelRequested", "cancelled", "completed"] },
            ...(resultId ? { resultId: { $literal: resultId } } : {}),
          },
        },
        { $unset: ["leaseUntil", "leaseToken", "errorCode"] },
      ],
    );
    if (completed.matchedCount && job.projectId) {
      const saved = await Job.findById(job.id);
      await Activity.create({
        projectId: job.projectId,
        kind: "analysis",
        message:
          saved?.status === "cancelled"
            ? "Analysis cancelled; any completed snapshot remains available."
            : "Analysis completed. Review coverage limitations.",
        referenceId: resultId,
      });
    }
  } catch (error) {
    const terminal =
      job.attempts >= 3 ||
      (error instanceof HttpError &&
        ([400, 401, 403, 404, 422].includes(error.status) ||
          error.code === "GITHUB_NOT_CONFIGURED"));
    await Job.updateOne({ _id: job.id, leaseToken }, [
      {
        $set: {
          status: {
            $cond: [
              "$cancelRequested",
              "cancelled",
              terminal ? "failed" : "queued",
            ],
          },
          errorCode: {
            $literal: error instanceof HttpError ? error.code : "JOB_FAILED",
          },
          availableAt: new Date(Date.now() + 60000),
        },
      },
      { $unset: ["leaseUntil", "leaseToken"] },
    ]);
  }
  return true;
}
export function startWorker() {
  workerState.started = true;
  workerState.lastHeartbeat = Date.now();
  let stopped = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const running = new Set<Promise<void>>();
  const heartbeat = setInterval(() => {
    workerState.lastHeartbeat = Date.now();
  }, 5000);
  heartbeat.unref();
  function loop(kind: "analysis" | "webhook") {
    const task = (async () => {
      try {
        await processNextJob(kind);
        if (kind === "webhook") await processDeletion();
      } catch {
        workerState.failures++;
        console.error("Worker polling failed", { kind });
      }
      if (!stopped) {
        const timer = setTimeout(() => {
          timers.delete(timer);
          loop(kind);
        }, 1000);
        timers.add(timer);
      }
    })();
    running.add(task);
    void task.finally(() => running.delete(task));
  }
  loop("analysis");
  loop("webhook");
  return async () => {
    stopped = true;
    for (const timer of timers) clearTimeout(timer);
    await Promise.all(running);
    clearInterval(heartbeat);
    workerState.started = false;
  };
}

export async function retryAnalysis(projectId: string, id: string) {
  const job = await Job.findOneAndUpdate(
    {
      _id: id,
      projectId,
      kind: "analysis",
      status: "failed",
      requestedBranch: { $type: "string" },
    },
    {
      $set: {
        status: "queued",
        attempts: 0,
        cancelRequested: false,
        availableAt: new Date(),
      },
      $unset: { errorCode: 1, leaseToken: 1, leaseUntil: 1, resultId: 1 },
    },
    { new: true },
  );
  if (!job)
    throw new HttpError(
      409,
      "JOB_NOT_RETRYABLE",
      "Only failed analysis jobs with a captured branch can be retried",
    );
  return job;
}

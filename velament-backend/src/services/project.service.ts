import mongoose from "mongoose";
import { Job } from "../models/Job.js";
import { randomUUID } from "node:crypto";
import { repositoryToken } from "./github-app.service.js";
import { Project } from "../models/Project.js";
import { Revision } from "../models/Revision.js";
import { HttpError } from "../utils/errors.js";
import { readRepository } from "./github.service.js";
import { buildEdges } from "./graph.service.js";
export async function ownProject(userId: string, id: string) {
  const p = await Project.findOne({
    _id: id,
    userId,
    archivedAt: { $exists: false },
  });
  if (!p) throw new HttpError(404, "NOT_FOUND", "Project not found");
  return p;
}
export async function revision(projectId: string, id: string) {
  const r = await Revision.findOne({ _id: id, projectId });
  if (!r) throw new HttpError(404, "NOT_FOUND", "Revision not found");
  return r;
}
export async function analyze(
  projectId: string,
  requestedBranch: string,
  jobScope?: { id: string; leaseToken: string },
) {
  const now = new Date(),
    lockToken = randomUUID();
  const lock = await Project.findOneAndUpdate(
    {
      _id: projectId,
      archivedAt: { $exists: false },
      connectionState: { $ne: "unavailable" },
      $or: [
        { analysisLockedUntil: { $exists: false } },
        { analysisLockedUntil: { $lte: now } },
      ],
    },
    {
      $set: {
        analysisLockedUntil: new Date(Date.now() + 900000),
        analysisLockToken: lockToken,
      },
    },
    { new: true },
  );
  if (!lock) {
    const project = await Project.findById(projectId);
    if (!project || project.archivedAt)
      throw new HttpError(404, "NOT_FOUND", "Project unavailable");
    if (project.connectionState === "unavailable")
      throw new HttpError(
        403,
        "GITHUB_CONNECTION_REQUIRED",
        "Reconnect GitHub",
      );
    throw new HttpError(
      409,
      "ANALYSIS_BUSY",
      "An analysis is already in progress",
    );
  }
  try {
    if (!lock.installationId || !lock.repositoryId)
      throw new HttpError(
        409,
        "GITHUB_CONNECTION_REQUIRED",
        "Reconnect this project using its GitHub installation",
      );
    const token = await repositoryToken(
      lock.userId.toString(),
      lock.installationId,
      lock.repositoryId,
    );
    const snapshot = await readRepository(
      lock.owner,
      lock.repo,
      requestedBranch,
      token,
    );
    const edges = buildEdges(snapshot.files);
    if (Buffer.byteLength(JSON.stringify({ ...snapshot, edges })) > 8000000)
      throw new HttpError(
        422,
        "SNAPSHOT_TOO_LARGE",
        "Snapshot and graph exceed the storage budget",
      );
    return await mongoose.connection.transaction(async (session) => {
      const ownsLease = await Project.findOneAndUpdate(
        {
          _id: projectId,
          analysisLockToken: lockToken,
          connectionState: { $ne: "unavailable" },
          archivedAt: null,
          analysisLockedUntil: { $gt: new Date() },
        },
        { $unset: { analysisLockedUntil: 1, analysisLockToken: 1 } },
        { session },
      );
      if (!ownsLease)
        throw new HttpError(
          409,
          "ANALYSIS_LEASE_LOST",
          "Analysis access or lease changed. Retry the job",
        );
      if (jobScope) {
        const job = await Job.updateOne(
          {
            _id: jobScope.id,
            projectId,
            leaseToken: jobScope.leaseToken,
            status: "running",
            cancelRequested: false,
          },
          { $set: { leaseUntil: new Date(Date.now() + 1200000) } },
          { session },
        );
        if (!job.matchedCount)
          throw new HttpError(
            409,
            "ANALYSIS_CANCELLED",
            "Analysis cancelled or superseded",
          );
      }
      return Revision.findOneAndUpdate(
        { projectId, sha: snapshot.sha },
        {
          $setOnInsert: {
            projectId,
            branch: requestedBranch,
            ...snapshot,
            edges,
          },
        },
        { upsert: true, new: true, runValidators: true, session },
      );
    });
  } finally {
    await Project.updateOne(
      { _id: projectId, analysisLockToken: lockToken },
      { $unset: { analysisLockedUntil: 1, analysisLockToken: 1 } },
    );
  }
}

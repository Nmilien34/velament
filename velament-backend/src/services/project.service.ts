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
export async function analyze(projectId: string, requestedBranch: string) {
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
    const ownsLease = await Project.exists({
      _id: projectId,
      analysisLockToken: lockToken,
      analysisLockedUntil: { $gt: new Date() },
      archivedAt: null,
    });
    if (!ownsLease)
      throw new HttpError(
        409,
        "ANALYSIS_LEASE_LOST",
        "Analysis lease expired or was replaced. Retry the job",
      );
    return await Revision.findOneAndUpdate(
      { projectId, sha: snapshot.sha },
      {
        $setOnInsert: {
          projectId,
          branch: requestedBranch,
          ...snapshot,
          edges: buildEdges(snapshot.files),
        },
      },
      { upsert: true, new: true, runValidators: true },
    );
  } finally {
    await Project.updateOne(
      { _id: projectId, analysisLockToken: lockToken },
      { $unset: { analysisLockedUntil: 1, analysisLockToken: 1 } },
    );
  }
}

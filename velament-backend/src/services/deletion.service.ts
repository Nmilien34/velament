import mongoose from "mongoose";
import { Deletion } from "../models/Deletion.js";
export { Deletion } from "../models/Deletion.js";
import { User } from "../models/User.js";
import { Session } from "../models/Session.js";
import { Project } from "../models/Project.js";
import { Job } from "../models/Job.js";
import { GitHubConnection, GitHubState } from "../models/GitHubConnection.js";
import { revokeAccess } from "./access.service.js";
import { HttpError } from "../utils/errors.js";

// Delay gives already admitted HTTP requests time to finish. Archived projects
// and deleting accounts cannot admit new requests. Active analysis blocks purge.
export async function requestDeletion(userId: string, projectId?: string) {
  if (projectId) {
    if (
      !(await Project.exists({
        _id: projectId,
        userId,
        archivedAt: { $type: "date" },
      }))
    )
      throw new HttpError(
        409,
        "ARCHIVE_REQUIRED",
        "Archive the project before permanent deletion",
      );
  } else {
    await revokeAccess(userId);
  }
  return mongoose.connection.transaction(async (session) => {
    if (!projectId) {
      await User.updateOne(
        { _id: userId },
        { $set: { deletingAt: new Date() } },
        { session },
      );
      await Session.deleteMany({ userId }, { session });
    } else {
      const archived = await Project.updateOne(
        { _id: projectId, userId, archivedAt: { $type: "date" } },
        { $set: { deletingAt: new Date() } },
        { session },
      );
      if (!archived.matchedCount)
        throw new HttpError(
          409,
          "ARCHIVE_REQUIRED",
          "Project was restored; archive it before deletion",
        );
    }
    const projects = await Project.find({
      userId,
      ...(projectId ? { _id: projectId } : {}),
    })
      .select("_id")
      .session(session);
    const scope = {
      projectId: { $in: projects.map((p) => p._id) },
      kind: "analysis",
    };
    await Job.updateMany(
      { ...scope, status: "queued" },
      {
        $set: { status: "cancelled", cancelRequested: true },
        $unset: { leaseUntil: 1, leaseToken: 1 },
      },
      { session },
    );
    await Job.updateMany(
      { ...scope, status: "running" },
      { $set: { cancelRequested: true } },
      { session },
    );
    return Deletion.findOneAndUpdate(
      { key: projectId ? "project:" + projectId : "account:" + userId },
      {
        $setOnInsert: {
          userId,
          projectId,
          dueAt: new Date(Date.now() + 3600000),
        },
      },
      { upsert: true, new: true, session },
    );
  });
}

export async function processDeletion() {
  const next = await Deletion.findOne({
    completedAt: null,
    dueAt: { $lte: new Date() },
  }).sort({ dueAt: 1 });
  if (!next) return;
  try {
    await mongoose.connection.transaction(async (session) => {
      // Claim by a write within the same transaction as every deletion.
      const claimed = await Deletion.findOneAndUpdate(
        { _id: next.id, completedAt: null },
        { $set: { completedAt: new Date() } },
        { session },
      );
      if (!claimed) return;
      const projects = await Project.find({
        userId: next.userId,
        ...(next.projectId ? { _id: next.projectId } : {}),
      })
        .select("_id")
        .session(session);
      const ids = projects.map((p) => p._id);
      if (
        await Job.exists({
          projectId: { $in: ids },
          status: { $in: ["queued", "running"] },
        }).session(session)
      ) {
        await Deletion.updateOne(
          { _id: next.id },
          {
            $unset: { completedAt: 1 },
            $set: { dueAt: new Date(Date.now() + 60000) },
          },
          { session },
        );
        return;
      }
      for (const name of [
        "Revision",
        "Feature",
        "Pin",
        "Investigation",
        "FeatureAssessment",
        "AiDiscovery",
        "TestRun",
        "Dispatch",
        "Activity",
        "Job",
      ]) {
        const target = mongoose.models[name];
        if (!target) throw new Error("Deletion model unavailable: " + name);
        await target.deleteMany({ projectId: { $in: ids } }, { session });
      }
      await Project.deleteMany({ _id: { $in: ids } }, { session });
      if (!next.projectId) {
        await GitHubConnection.deleteMany({ userId: next.userId }, { session });
        await GitHubState.deleteMany({ userId: next.userId }, { session });
        await Session.deleteMany({ userId: next.userId }, { session });
        await User.deleteOne({ _id: next.userId }, { session });
      }
    });
  } catch (error) {
    // Preserve the request and let other due deletions run before retrying.
    // A completed request is never reopened, including an uncertain commit.
    await Deletion.updateOne(
      { _id: next.id, completedAt: null, dueAt: next.dueAt },
      { $set: { dueAt: new Date(Date.now() + 60000) } },
    );
    throw error;
  }
}

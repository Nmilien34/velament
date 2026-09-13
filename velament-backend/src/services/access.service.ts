import mongoose, { type ClientSession } from "mongoose";
import { AccessFence } from "../models/AccessFence.js";
import { Project } from "../models/Project.js";
import { Job } from "../models/Job.js";
import { GitHubConnection, GitHubState } from "../models/GitHubConnection.js";
import { HttpError } from "../utils/errors.js";

// A persistent tombstone prevents callbacks and analysis started before revocation
// from restoring access. It contains no source, credentials, or profile data.
export async function accessGeneration(userId: string) {
  const fence = await AccessFence.findOneAndUpdate(
    { _id: userId },
    { $setOnInsert: { generation: 0 } },
    { upsert: true, new: true },
  );
  return fence!.generation!;
}
export async function assertAccess(
  userId: string,
  generation: number,
  session: ClientSession,
) {
  const result = await AccessFence.updateOne(
    { _id: userId, generation },
    { $inc: { writes: 1 } },
    { session },
  );
  if (!result.matchedCount)
    throw new HttpError(409, "ACCESS_REVOKED", "Access changed. Start again");
}
export async function revokeAccess(userId: string) {
  await accessGeneration(userId);
  await mongoose.connection.transaction(async (session) => {
    await AccessFence.updateOne(
      { _id: userId },
      { $inc: { generation: 1 } },
      { session },
    );
    await GitHubConnection.deleteOne({ userId }, { session });
    await GitHubState.deleteMany({ userId }, { session });
    await Project.updateMany(
      { userId },
      { $set: { connectionState: "unavailable" } },
      { session },
    );
    const projects = await Project.find({ userId })
      .select("_id")
      .session(session);
    await Job.updateMany(
      {
        projectId: { $in: projects.map((p) => p._id) },
        kind: "analysis",
        status: { $in: ["queued", "running"] },
      },
      { $set: { cancelRequested: true } },
      { session },
    );
  });
}

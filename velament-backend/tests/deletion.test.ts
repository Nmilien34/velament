import { Revision } from "../src/models/Revision.js";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import "../src/app.js";
import {
  requestDeletion,
  processDeletion,
  Deletion,
} from "../src/services/deletion.service.js";
import { Project } from "../src/models/Project.js";
import { User } from "../src/models/User.js";
import { Job } from "../src/models/Job.js";
import { Feature } from "../src/models/Feature.js";
import { RealityReview } from "../src/models/RealityReview.js";
const uri = process.env.TEST_MONGODB_URI;
it.skipIf(!uri)(
  "backs off a failed purge so another deletion can proceed",
  async () => {
    const first = await Deletion.create({
      userId: new mongoose.Types.ObjectId(),
      projectId: new mongoose.Types.ObjectId(),
      key: "failure-first",
      dueAt: new Date(0),
    });
    const second = await Deletion.create({
      userId: new mongoose.Types.ObjectId(),
      projectId: new mongoose.Types.ObjectId(),
      key: "failure-second",
      dueAt: new Date(1),
    });
    const spy = vi
      .spyOn(mongoose.connection, "transaction")
      .mockRejectedValueOnce(new Error("temporary database error"));
    try {
      await expect(processDeletion()).rejects.toThrow(
        "temporary database error",
      );
    } finally {
      spy.mockRestore();
    }
    expect(
      (await Deletion.findById(first.id))?.dueAt.getTime(),
    ).toBeGreaterThan(Date.now());
    await processDeletion();
    expect((await Deletion.findById(second.id))?.completedAt).toBeTruthy();
    expect((await Deletion.findById(first.id))?.completedAt).toBeFalsy();
  },
);
it.skipIf(!uri)(
  "deletion cancels queued analysis and signals running analysis",
  async () => {
    const p = await Project.create({
      userId: new mongoose.Types.ObjectId(),
      owner: "a",
      repo: "delete-work",
      branch: "main",
      archivedAt: new Date(),
    });
    const queued = await Job.create({
      key: "delete-queued",
      kind: "analysis",
      projectId: p.id,
    });
    const running = await Job.create({
      key: "delete-running",
      kind: "analysis",
      projectId: p.id,
      status: "running",
      leaseToken: "worker",
      leaseUntil: new Date(Date.now() + 60000),
    });
    await requestDeletion(p.userId.toString(), p.id);
    expect((await Job.findById(queued.id))?.status).toBe("cancelled");
    const active = await Job.findById(running.id);
    expect(active?.cancelRequested).toBe(true);
    expect(active?.status).toBe("running");
    expect(active?.leaseToken).toBe("worker");
  },
);
beforeAll(async () => {
  if (uri) {
    await mongoose.connect(uri, { dbName: "deletion_" + randomUUID() });
    await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  }
});
afterAll(async () => {
  if (uri) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
it.skipIf(!uri)(
  "purges only an archived project's data and waits for active work",
  async () => {
    const user = await User.create({
      email: "delete@example.com",
      name: "Delete",
    });
    const p = await Project.create({
      userId: user.id,
      owner: "a",
      repo: "b",
      branch: "main",
    });
    const other = await Project.create({
      userId: user.id,
      owner: "a",
      repo: "c",
      branch: "main",
    });
    await expect(requestDeletion(user.id, p.id)).rejects.toMatchObject({
      code: "ARCHIVE_REQUIRED",
    });
    await Project.updateOne(
      { _id: p.id },
      { $set: { archivedAt: new Date() } },
    );
    const revision = await Revision.create({
      projectId: p.id,
      branch: "main",
      sha: "a".repeat(40),
      state: "partial",
      files: [
        {
          path: "src/a.ts",
          content: "export const a = 1",
          hash: "b".repeat(64),
        },
      ],
      edges: [],
      limitations: [],
    });
    await Feature.create({
      projectId: p.id,
      title: "Feature",
      requirement: "Works",
      kind: "existing",
      paths: ["src/a.ts"],
      revisionId: revision.id,
    });
    const d = await requestDeletion(user.id, p.id);
    await RealityReview.create({
      projectId: p.id,
      revisionId: revision.id,
      findingId: "a".repeat(64),
      reason: "Intentional policy",
    });
    await Deletion.updateOne({ _id: d!.id }, { $set: { dueAt: new Date(0) } });
    const job = await Job.create({
      key: "block",
      kind: "analysis",
      projectId: p.id,
    });
    await processDeletion();
    expect(await Project.exists({ _id: p.id })).not.toBeNull();
    await Job.updateOne({ _id: job.id }, { $set: { status: "cancelled" } });
    await Deletion.updateOne({ _id: d!.id }, { $set: { dueAt: new Date(0) } });
    await processDeletion();
    expect(await Project.exists({ _id: p.id })).toBeNull();
    expect(await Project.exists({ _id: other.id })).not.toBeNull();
    expect(await User.exists({ _id: user.id })).not.toBeNull();
    expect(await Job.countDocuments({ projectId: p.id })).toBe(0);
    expect(await Feature.countDocuments({ projectId: p.id })).toBe(0);
    expect(await Revision.countDocuments({ projectId: p.id })).toBe(0);
    expect(await RealityReview.countDocuments({ projectId: p.id })).toBe(0);
  },
);
it.skipIf(!uri)(
  "account deletion revokes access immediately and removes account after grace period",
  async () => {
    const user = await User.create({
      email: "account@example.com",
      name: "Account",
    });
    const p = await Project.create({
      userId: user.id,
      owner: "x",
      repo: "y",
      branch: "main",
    });
    const d = await requestDeletion(user.id);
    expect((await User.findById(user.id))?.deletingAt).toBeTruthy();
    expect((await Project.findById(p.id))?.connectionState).toBe("unavailable");
    await Deletion.updateOne({ _id: d!.id }, { $set: { dueAt: new Date(0) } });
    await processDeletion();
    expect(await User.exists({ _id: user.id })).toBeNull();
    expect(await Project.exists({ _id: p.id })).toBeNull();
  },
);

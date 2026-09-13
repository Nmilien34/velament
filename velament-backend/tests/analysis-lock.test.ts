import { Job } from "../src/models/Job.js";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { randomBytes } from "node:crypto";
vi.mock("../src/services/github-app.service.js", () => ({
  repositoryToken: vi.fn().mockResolvedValue("token"),
}));
vi.mock("../src/services/github.service.js", () => ({
  readRepository: vi.fn(),
}));
import { readRepository } from "../src/services/github.service.js";
import { analyze } from "../src/services/project.service.js";
import { Project } from "../src/models/Project.js";
import { Revision } from "../src/models/Revision.js";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)("analysis lease ownership", () => {
  beforeAll(async () => {
    await mongoose.connect(uri!, {
      dbName: "velament_lock_" + randomBytes(8).toString("hex"),
    });
  });
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  it("does not save or release another worker's lease after losing ownership", async () => {
    const p = await Project.create({
      userId: new mongoose.Types.ObjectId(),
      owner: "acme",
      repo: "app",
      branch: "develop",
      installationId: 1,
      repositoryId: 2,
    });
    let ready!: () => void, finish!: () => void;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      finish = resolve;
    });
    vi.mocked(readRepository).mockImplementation(async () => {
      ready();
      await blocked;
      return {
        sha: "a".repeat(40),
        state: "empty" as const,
        files: [],
        limitations: [],
      };
    });
    const running = analyze(p.id, "main");
    await started;
    await Project.updateOne(
      { _id: p.id },
      {
        $set: {
          analysisLockToken: "replacement",
          analysisLockedUntil: new Date(Date.now() + 60000),
        },
      },
      { strict: false },
    );
    finish();
    await expect(running).rejects.toMatchObject({
      code: "ANALYSIS_LEASE_LOST",
    });
    expect((await Project.findById(p.id).lean())?.analysisLockToken).toBe(
      "replacement",
    );
    expect(await Revision.countDocuments()).toBe(0);
    expect(readRepository).toHaveBeenCalledWith(
      "acme",
      "app",
      "main",
      "token",
      { checkpoint: expect.any(Function) },
    );
  });
  it("does not save a snapshot when access is removed during fetching", async () => {
    const p = await Project.create({
      userId: new mongoose.Types.ObjectId(),
      owner: "acme",
      repo: "disconnect",
      branch: "main",
      installationId: 1,
      repositoryId: 2,
    });
    vi.mocked(readRepository).mockImplementation(async () => {
      await Project.updateOne(
        { _id: p.id },
        { $set: { connectionState: "unavailable" } },
      );
      return {
        sha: "b".repeat(40),
        state: "empty" as const,
        files: [],
        limitations: [],
      };
    });
    await expect(analyze(p.id, "main")).rejects.toMatchObject({
      code: "ANALYSIS_LEASE_LOST",
    });
    expect(await Revision.countDocuments({ projectId: p.id })).toBe(0);
    expect((await Project.findById(p.id))?.analysisLockToken).toBeUndefined();
  });

  it("commits a snapshot and releases the project lease atomically", async () => {
    const p = await Project.create({
      userId: new mongoose.Types.ObjectId(),
      owner: "acme",
      repo: "atomic",
      branch: "main",
      installationId: 1,
      repositoryId: 2,
    });
    vi.mocked(readRepository).mockResolvedValue({
      sha: "c".repeat(40),
      state: "empty",
      files: [],
      limitations: [],
    });
    const result = await analyze(p.id, "main");
    expect(result?.sha).toBe("c".repeat(40));
    expect((await Project.findById(p.id))?.analysisLockToken).toBeUndefined();
  });
  it("rolls back a snapshot when its job is cancelled", async () => {
    const p = await Project.create({
      userId: new mongoose.Types.ObjectId(),
      owner: "acme",
      repo: "cancel-atomic",
      branch: "main",
      installationId: 1,
      repositoryId: 2,
    });
    const job = await Job.create({
      key: "atomic-cancel",
      kind: "analysis",
      projectId: p.id,
      status: "running",
      leaseToken: "lease",
      cancelRequested: true,
    });
    vi.mocked(readRepository).mockResolvedValue({
      sha: "d".repeat(40),
      state: "empty",
      files: [],
      limitations: [],
    });
    await expect(
      analyze(p.id, "main", { id: job.id, leaseToken: "lease" }),
    ).rejects.toMatchObject({ code: "ANALYSIS_CANCELLED" });
    expect(await Revision.countDocuments({ projectId: p.id })).toBe(0);
  });
});

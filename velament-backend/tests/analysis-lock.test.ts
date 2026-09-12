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
    expect(readRepository).toHaveBeenCalledWith("acme", "app", "main", "token");
  });
});

import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { randomBytes } from "node:crypto";
vi.mock("../src/services/run.service.js", () => ({ importRun: vi.fn() }));
import { importRun } from "../src/services/run.service.js";
import { Dispatch } from "../src/models/Dispatch.js";
import { refreshDispatch } from "../src/services/dispatch.service.js";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)("dispatch recovery", () => {
  const projectId = new mongoose.Types.ObjectId().toString();
  beforeAll(async () => {
    await mongoose.connect(uri!, {
      dbName: "velament_dispatch_" + randomBytes(8).toString("hex"),
    });
  });
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  it("keeps uncertain submissions unconfirmed without resubmitting", async () => {
    const d = await Dispatch.create({
      projectId,
      key: "unknown",
      workflowId: "test.yml",
      ref: "main",
      sha: "a".repeat(40),
      status: "unknown",
    });
    const result = await refreshDispatch(projectId, d.id);
    expect(result.run).toBeNull();
    expect(result.revisionMatches).toBeNull();
    expect(importRun).not.toHaveBeenCalled();
  });
  it("imports an authoritative run ID and detects branch movement", async () => {
    const d = await Dispatch.create({
      projectId,
      key: "known",
      workflowId: "test.yml",
      ref: "main",
      sha: "a".repeat(40),
      status: "accepted",
      githubRunId: 12,
    });
    vi.mocked(importRun).mockResolvedValue({ sha: "b".repeat(40) } as never);
    const result = await refreshDispatch(projectId, d.id);
    expect(result.revisionMatches).toBe(false);
    expect(importRun).toHaveBeenCalledWith(projectId, 12);
  });
  it("does not expose another project's dispatch", async () => {
    const d = await Dispatch.findOne({ projectId });
    await expect(
      refreshDispatch(new mongoose.Types.ObjectId().toString(), d!.id),
    ).rejects.toMatchObject({ status: 404 });
  });
});

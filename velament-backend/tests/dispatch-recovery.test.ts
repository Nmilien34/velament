vi.mock("../src/services/workflow.service.js", () => ({
  workflowAccess: vi
    .fn()
    .mockResolvedValue({ base: "/repos/acme/app", token: "test" }),
}));
vi.mock("../src/services/github-app.service.js", () => ({
  githubRequest: vi.fn(),
}));
import { githubRequest } from "../src/services/github-app.service.js";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { randomBytes } from "node:crypto";
vi.mock("../src/services/run.service.js", () => ({ importRun: vi.fn() }));
import { importRun } from "../src/services/run.service.js";
import { Dispatch } from "../src/models/Dispatch.js";
import { dispatch, refreshDispatch } from "../src/services/dispatch.service.js";
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
  it("requests and persists the provider run ID", async () => {
    vi.mocked(githubRequest)
      .mockResolvedValueOnce({ sha: "a".repeat(40) })
      .mockResolvedValueOnce({ workflow_run_id: 123 });
    const result = await dispatch(projectId, "new-run", {
      workflowId: "test.yml",
      ref: "main",
      sha: "a".repeat(40),
    });

    expect(result.githubRunId).toBe(123);
  });
  it("marks interrupted pending submissions uncertain without resubmitting", async () => {
    const d = await Dispatch.create({
      projectId,
      key: "abandoned",
      workflowId: "test.yml",
      ref: "main",
      sha: "a".repeat(40),
      createdAt: new Date(Date.now() - 180000),
    });
    const result = await refreshDispatch(projectId, d.id);
    expect(result.dispatch.status).toBe("unknown");
    expect(result.dispatch.errorCode).toBe("DISPATCH_UNCERTAIN");
  });

  it("does not accept a response missing its run ID", async () => {
    vi.mocked(githubRequest)
      .mockResolvedValueOnce({ sha: "a".repeat(40) })
      .mockResolvedValueOnce({});
    const result = await dispatch(projectId, "no-id", {
      workflowId: "test.yml",
      ref: "main",
      sha: "a".repeat(40),
    });
    expect(result.status).toBe("unknown");
  });
  it("returns the same submission for simultaneous identical requests", async () => {
    await Dispatch.init();
    let arrivals = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let posts = 0;
    vi.mocked(githubRequest).mockImplementation(async (path) => {
      if (path.includes("/commits/")) {
        arrivals++;
        if (arrivals === 2) release();
        await barrier;
        return { sha: "a".repeat(40) };
      }
      posts++;
      return { workflow_run_id: 999 };
    });
    const input = { workflowId: "test.yml", ref: "main", sha: "a".repeat(40) };
    const results = await Promise.allSettled([
      dispatch(projectId, "concurrent", input),
      dispatch(projectId, "concurrent", input),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(posts).toBe(1);
    const ids = results.map((r) =>
      r.status === "fulfilled" ? r.value.id : null,
    );
    expect(ids[0]).toBe(ids[1]);
  });
});

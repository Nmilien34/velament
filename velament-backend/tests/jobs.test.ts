import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
vi.mock("../src/services/project.service.js", () => ({ analyze: vi.fn() }));
import { analyze } from "../src/services/project.service.js";
import {
  enqueueAnalysis,
  retryAnalysis,
  processNextJob,
} from "../src/services/job.service.js";
import { Project } from "../src/models/Project.js";
import { Job } from "../src/models/Job.js";
import { Activity } from "../src/models/Activity.js";
import { HttpError } from "../src/utils/errors.js";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)("durable analysis jobs", () => {
  const projectId = new mongoose.Types.ObjectId().toString();
  beforeAll(async () => {
    await mongoose.connect(uri!, { dbName: "velament_jobs_" + randomUUID() });
    await Job.init();
  });
  beforeEach(async () => {
    await Activity.deleteMany({});
    await Job.deleteMany({});
    await Project.findOneAndUpdate(
      { _id: projectId },
      {
        $set: {
          userId: new mongoose.Types.ObjectId(),
          owner: "acme",
          repo: "app",
          branch: "main",
        },
      },
      { upsert: true },
    );
    vi.mocked(analyze).mockReset();
  });
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  it("deduplicates requests and claims a job only once", async () => {
    const a = await enqueueAnalysis(projectId, "request-one");
    const b = await enqueueAnalysis(projectId, "request-one");
    expect(a!.id).toBe(b!.id);
    vi.mocked(analyze).mockResolvedValue(null);
    await Promise.all([processNextJob(), processNextJob()]);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect((await Job.findById(a!.id))!.status).toBe("completed");
  });
  it("queues opt-in pushes only for the tracked branch and deduplicates delivery", async () => {
    await Project.updateOne(
      { _id: projectId },
      { $set: { installationId: 77, repositoryId: 88, analyzeOnPush: true } },
    );
    const event = await Job.create({
      key: "push-enabled",
      kind: "webhook",
      payload: {
        event: "push",
        body: {
          installation: { id: 77 },
          repository: { id: 88 },
          ref: "refs/heads/main",
        },
      },
    });
    await processNextJob("webhook");
    expect(await Job.countDocuments({ kind: "analysis", projectId })).toBe(1);
    await Job.updateOne({ _id: event.id }, { $set: { status: "queued" } });
    await processNextJob("webhook");
    expect(await Job.countDocuments({ kind: "analysis", projectId })).toBe(1);
  });
  it("does not announce completion after losing its lease", async () => {
    const job = await enqueueAnalysis(projectId, "lost-lease");
    vi.mocked(analyze).mockImplementationOnce(async () => {
      await Job.updateOne(
        { _id: job!.id },
        { $set: { leaseToken: "replacement-worker" } },
      );
      return null;
    });
    await processNextJob();
    expect((await Job.findById(job!.id))?.status).toBe("running");
    expect(await Activity.countDocuments({ projectId })).toBe(0);
  });
  it.each(["disabled", "other-branch", "deleted", "archived"])(
    "does not auto-analyze %s pushes",
    async (mode) => {
      await Project.updateOne(
        { _id: projectId },
        {
          $set: {
            installationId: 77,
            repositoryId: 88,
            analyzeOnPush: mode !== "disabled",
            archivedAt: mode === "archived" ? new Date() : null,
          },
        },
      );
      await Job.create({
        key: "skip-" + mode,
        kind: "webhook",
        payload: {
          event: "push",
          body: {
            installation: { id: 77 },
            repository: { id: 88 },
            ref: "refs/heads/" + (mode === "other-branch" ? "other" : "main"),
            deleted: mode === "deleted",
          },
        },
      });
      await processNextJob("webhook");
      expect(await Job.countDocuments({ kind: "analysis", projectId })).toBe(0);
      await Project.updateOne(
        { _id: projectId },
        { $unset: { archivedAt: 1 } },
      );
    },
  );
  it("honors cancellation arriving as the completion write begins", async () => {
    const job = await enqueueAnalysis(projectId, "late-cancel");
    const original = Job.updateOne.bind(Job);
    vi.mocked(analyze).mockImplementationOnce(async () => {
      vi.spyOn(Job, "updateOne").mockImplementationOnce(((
        filter: unknown,
        update: unknown,
        options: unknown,
      ) => {
        return (async () => {
          await original({ _id: job!.id }, { $set: { cancelRequested: true } });
          return original(filter as never, update as never, options as never);
        })();
      }) as never);
      return null;
    });
    try {
      await processNextJob();
      expect((await Job.findById(job!.id))?.status).toBe("cancelled");
      expect((await Activity.findOne({ projectId }))?.message).toContain(
        "cancelled",
      );
    } finally {
      vi.restoreAllMocks();
    }
  });
  it.each([
    new Error("temporary"),
    new HttpError(401, "RECONNECT", "Reconnect"),
  ])("honors cancellation during failure settlement: %s", async (failure) => {
    const job = await enqueueAnalysis(projectId, "late-cancel");
    const original = Job.updateOne.bind(Job);
    vi.mocked(analyze).mockImplementationOnce(async () => {
      vi.spyOn(Job, "updateOne").mockImplementationOnce(((
        filter: unknown,
        update: unknown,
        options: unknown,
      ) => {
        return (async () => {
          await original({ _id: job!.id }, { $set: { cancelRequested: true } });
          return original(filter as never, update as never, options as never);
        })();
      }) as never);
      throw failure;
    });
    try {
      await processNextJob();
      expect((await Job.findById(job!.id))?.status).toBe("cancelled");
    } finally {
      vi.restoreAllMocks();
    }
  });
  it("retains the requested branch after the project switches branches", async () => {
    await enqueueAnalysis(projectId, "branch-test");
    await Project.updateOne(
      { _id: projectId },
      { $set: { branch: "develop" } },
    );
    vi.mocked(analyze).mockResolvedValue(null);
    await processNextJob();
    expect(analyze).toHaveBeenCalledWith(
      projectId,
      "main",
      expect.objectContaining({
        id: expect.any(String),
        leaseToken: expect.any(String),
      }),
    );
  });
  it("retries failed analysis on its original branch and rejects duplicate retries", async () => {
    const job = await enqueueAnalysis(projectId, "retry-test");
    await Job.updateOne(
      { _id: job!.id },
      {
        $set: {
          status: "failed",
          attempts: 3,
          errorCode: "GITHUB_REQUEST_FAILED",
        },
      },
    );
    await Project.updateOne(
      { _id: projectId },
      { $set: { branch: "develop" } },
    );
    const retried = await retryAnalysis(projectId, job!.id);
    expect(retried.status).toBe("queued");
    expect(retried.requestedBranch).toBe("main");
    expect(retried.attempts).toBe(0);
    await expect(retryAnalysis(projectId, job!.id)).rejects.toMatchObject({
      status: 409,
    });
  });
  it("cancels before accessing repository code", async () => {
    const job = await enqueueAnalysis(projectId, "cancel-me");
    await Job.updateOne({ _id: job!.id }, { cancelRequested: true });
    await processNextJob();
    expect(analyze).not.toHaveBeenCalled();
    expect((await Job.findById(job!.id))!.status).toBe("cancelled");
  });
  it("recovers an expired lease and retries transient failures", async () => {
    const job = await enqueueAnalysis(projectId, "recover-me");
    await Job.updateOne(
      { _id: job!.id },
      { status: "running", leaseUntil: new Date(0) },
    );
    vi.mocked(analyze).mockRejectedValue(new Error("temporary outage"));
    await processNextJob();
    const saved = await Job.findById(job!.id);
    expect(saved!.status).toBe("queued");
    expect(saved!.attempts).toBe(1);
    expect(saved!.availableAt.getTime()).toBeGreaterThan(Date.now());
  });
  it("does not retry revoked authorization", async () => {
    const job = await enqueueAnalysis(projectId, "revoked-access");
    vi.mocked(analyze).mockRejectedValue(
      new HttpError(401, "RECONNECT", "Reconnect"),
    );
    await processNextJob();
    expect((await Job.findById(job!.id))!.status).toBe("failed");
  });
  it("retries temporary unavailability but stops after three attempts", async () => {
    const job = await enqueueAnalysis(projectId, "temporary-unavailable");
    vi.mocked(analyze).mockRejectedValue(
      new HttpError(503, "TEMPORARILY_UNAVAILABLE", "Retry later"),
    );
    for (let attempt = 1; attempt <= 3; attempt++) {
      await Job.updateOne(
        { _id: job!.id },
        { $set: { availableAt: new Date(0) } },
      );
      await processNextJob();
      const saved = await Job.findById(job!.id);
      expect(saved?.attempts).toBe(attempt);
      expect(saved?.status).toBe(attempt === 3 ? "failed" : "queued");
    }
  });
  it("does not retry missing GitHub configuration", async () => {
    const job = await enqueueAnalysis(projectId, "missing-config");
    vi.mocked(analyze).mockRejectedValue(
      new HttpError(503, "GITHUB_NOT_CONFIGURED", "Configure GitHub"),
    );
    await processNextJob();
    expect((await Job.findById(job!.id))?.status).toBe("failed");
  });
  it("marks only removed repositories unavailable", async () => {
    await Project.updateOne(
      { _id: projectId },
      {
        $set: {
          installationId: 42,
          repositoryId: 10,
          connectionState: "active",
        },
      },
    );
    const other = await Project.create({
      userId: new mongoose.Types.ObjectId(),
      owner: "acme",
      repo: "other",
      branch: "main",
      installationId: 42,
      repositoryId: 11,
      connectionState: "active",
    });
    await Job.create({
      key: "webhook:removed",
      kind: "webhook",
      payload: {
        event: "installation_repositories",
        body: {
          action: "removed",
          installation: { id: 42 },
          repositories_removed: [{ id: 10 }],
        },
      },
    });
    await processNextJob();
    expect((await Project.findById(projectId))?.connectionState).toBe(
      "unavailable",
    );
    expect((await Project.findById(other.id))?.connectionState).toBe("active");
    expect(await Project.exists({ _id: projectId })).toBeTruthy();
  });
  it("settles an exhausted interrupted lease without claiming it again", async () => {
    const job = await Job.create({
      key: "exhausted",
      kind: "analysis",
      projectId,
      status: "running",
      attempts: 3,
      leaseUntil: new Date(0),
      leaseToken: "old",
    });
    await processNextJob();
    const saved = await Job.findById(job.id);
    expect(saved?.status).toBe("failed");
    expect(saved?.errorCode).toBe("WORKER_INTERRUPTED");
    expect(saved?.leaseToken).toBeUndefined();
  });
});

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
import { HttpError } from "../src/utils/errors.js";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)("durable analysis jobs", () => {
  const projectId = new mongoose.Types.ObjectId().toString();
  beforeAll(async () => {
    await mongoose.connect(uri!, { dbName: "velament_jobs_" + randomUUID() });
    await Job.init();
  });
  beforeEach(async () => {
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
  it("retains the requested branch after the project switches branches", async () => {
    await enqueueAnalysis(projectId, "branch-test");
    await Project.updateOne(
      { _id: projectId },
      { $set: { branch: "develop" } },
    );
    vi.mocked(analyze).mockResolvedValue(null);
    await processNextJob();
    expect(analyze).toHaveBeenCalledWith(projectId, "main");
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
});

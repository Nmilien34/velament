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
import { createHmac, randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { Job } from "../src/models/Job.js";
import { Project } from "../src/models/Project.js";
import { processNextJob } from "../src/services/job.service.js";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)("GitHub webhook ingestion", () => {
  const app = createApp("http://localhost:5173");
  const secret = "isolated-webhook-test-secret";
  const body = JSON.stringify({
    action: "removed",
    installation: { id: 42 },
    repositories_removed: [{ id: 10 }],
  });
  const signature = (value: string) =>
    "sha256=" + createHmac("sha256", secret).update(value).digest("hex");
  const deliver = (
    id = randomUUID(),
    value = body,
    event = "installation_repositories",
    signed = signature(value),
  ) =>
    request(app)
      .post("/api/webhooks/github")
      .set("Content-Type", "application/json")
      .set("x-github-delivery", id)
      .set("x-github-event", event)
      .set("x-hub-signature-256", signed)
      .send(value);
  beforeAll(async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", secret);
    await mongoose.connect(uri!, {
      dbName: "velament_webhooks_" + randomUUID(),
    });
    await Job.init();
  });
  beforeEach(async () => {
    await Job.deleteMany({});
    await Project.deleteMany({});
  });
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    vi.unstubAllEnvs();
  });
  it("deduplicates simultaneous deliveries and applies the queued change", async () => {
    const project = await Project.create({
      userId: new mongoose.Types.ObjectId(),
      owner: "acme",
      repo: "app",
      branch: "main",
      installationId: 42,
      repositoryId: 10,
      connectionState: "active",
    });
    const id = randomUUID();
    const responses = await Promise.all([deliver(id), deliver(id)]);
    expect(responses.map((response) => response.status)).toEqual([202, 202]);
    expect(await Job.countDocuments()).toBe(1);
    expect((await Project.findById(project.id))?.connectionState).toBe(
      "active",
    );
    await processNextJob();
    expect((await Job.findOne())?.status).toBe("completed");
    expect((await Project.findById(project.id))?.connectionState).toBe(
      "unavailable",
    );
  });
  it("rejects a modified payload before queuing anything", async () => {
    expect(
      (
        await deliver(
          randomUUID(),
          body + " ",
          "installation_repositories",
          signature(body),
        )
      ).status,
    ).toBe(401);
    expect(await Job.countDocuments()).toBe(0);
  });
  it("ignores authenticated unsupported events", async () => {
    expect((await deliver(randomUUID(), "{}", "ping")).status).toBe(204);
    expect(await Job.countDocuments()).toBe(0);
  });
  it("rejects malformed JSON and delivery identifiers without queuing", async () => {
    expect((await deliver(randomUUID(), "{")).status).toBe(400);
    expect((await deliver("invalid-id")).status).toBe(400);
    expect(await Job.countDocuments()).toBe(0);
  });
});

import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { Project } from "../src/models/Project.js";
import { Job } from "../src/models/Job.js";
import { Session } from "../src/models/Session.js";
import { GitHubConnection } from "../src/models/GitHubConnection.js";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)("GitHub onboarding status", () => {
  const app = createApp("http://localhost:5173");
  const userId = new mongoose.Types.ObjectId();
  const token = randomBytes(32).toString("base64url");
  const get = () =>
    request(app).get("/api/github/connection").auth(token, { type: "bearer" });
  beforeAll(async () => {
    await mongoose.connect(uri!, { dbName: "velament_status_" + randomUUID() });
    await Session.create({
      userId,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 60000),
    });
  });
  beforeEach(async () => {
    await GitHubConnection.deleteMany({});
  });
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  it("requires authentication", async () => {
    expect((await request(app).get("/api/github/connection")).status).toBe(401);
  });
  it("does not expose another accounts connection", async () => {
    await GitHubConnection.create({
      userId: new mongoose.Types.ObjectId(),
      githubUserId: 9,
      token: "secret",
      expiresAt: new Date(Date.now() + 60000),
    });
    expect((await get()).body.data).toEqual({
      status: "disconnected",
      githubUserId: null,
      access: "not-checked",
    });
  });
  it.each([false, true])(
    "reports expired credentials with refresh available %s",
    async (refresh) => {
      await GitHubConnection.create({
        userId,
        githubUserId: 9,
        token: "secret",
        expiresAt: new Date(0),
        ...(refresh
          ? {
              refreshToken: "refresh-secret",
              refreshExpiresAt: new Date(Date.now() + 60000),
            }
          : {}),
      });
      const response = await get();
      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({
        status: refresh ? "connected" : "reconnect-required",
        githubUserId: 9,
        access: "not-checked",
      });
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(JSON.stringify(response.body)).not.toContain("secret");
    },
  );
  it("reports an unexpired connection without claiming repository access", async () => {
    await GitHubConnection.create({
      userId,
      githubUserId: 9,
      token: "secret",
      expiresAt: new Date(Date.now() + 60000),
    });
    expect((await get()).body.data).toEqual({
      status: "connected",
      githubUserId: 9,
      access: "not-checked",
    });
  });
  it("disconnects only owned projects and cancels their pending analyses", async () => {
    const own = await Project.create({
      userId,
      owner: "acme",
      repo: "own",
      branch: "main",
    });
    const other = await Project.create({
      userId: new mongoose.Types.ObjectId(),
      owner: "acme",
      repo: "other",
      branch: "main",
    });
    await Job.create({
      projectId: own.id,
      key: randomUUID(),
      kind: "analysis",
    });
    await Job.create({
      projectId: other.id,
      key: randomUUID(),
      kind: "analysis",
    });
    const response = await request(app)
      .delete("/api/github/connection")
      .auth(token, { type: "bearer" });
    expect(response.status).toBe(204);
    expect((await Project.findById(own.id))?.connectionState).toBe(
      "unavailable",
    );
    expect((await Project.findById(other.id))?.connectionState).not.toBe(
      "unavailable",
    );
    expect((await Job.findOne({ projectId: own.id }))?.cancelRequested).toBe(
      true,
    );
    expect((await Job.findOne({ projectId: other.id }))?.cancelRequested).toBe(
      false,
    );
    expect(await Project.countDocuments()).toBe(2);
  });
});

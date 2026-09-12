vi.mock("../src/services/github-app.service.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../src/services/github-app.service.js")
    >();
  return {
    ...actual,
    repositoryToken: vi.fn().mockResolvedValue("test-only"),
    githubRequest: vi.fn().mockResolvedValue({ id: 123 }),
  };
});
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import mongoose from "mongoose";
import { randomBytes, createHash } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { User } from "../src/models/User.js";
import { Session } from "../src/models/Session.js";
import { Revision } from "../src/models/Revision.js";
import { TestRun } from "../src/models/TestRun.js";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)("MongoDB API isolation", () => {
  const app = createApp("http://localhost:5173");
  let token = "",
    other = "",
    projectId = "",
    revisionId = "",
    featureId = "",
    investigationId = "";
  const auth = () => ({ Authorization: "Bearer " + token });
  beforeAll(async () => {
    await mongoose.connect(uri!, {
      dbName: "velament_test_" + randomBytes(6).toString("hex"),
    });
    for (const name of ["owner", "other"]) {
      const user = await User.create({ email: name + "@example.com", name });
      const t = randomBytes(32).toString("base64url");
      await Session.create({
        userId: user.id,
        tokenHash: createHash("sha256").update(t).digest("hex"),
        expiresAt: new Date(Date.now() + 60000),
      });
      if (name === "owner") token = t;
      else other = t;
    }
  });
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  it("rejects anonymous project access", async () =>
    expect((await request(app).get("/api/projects")).status).toBe(401));
  it("creates project and isolates it from another owner", async () => {
    const res = await request(app).post("/api/projects").set(auth()).send({
      owner: "acme",
      repo: "test",
      branch: "main",
      installationId: 1,
      repositoryId: 123,
    });
    expect(res.status).toBe(201);
    projectId = res.body.data._id;
    expect(
      (
        await request(app)
          .get("/api/projects/" + projectId + "/features")
          .set({ Authorization: "Bearer " + other })
      ).status,
    ).toBe(404);
    const revision = await Revision.create({
      projectId,
      sha: "a".repeat(40),
      branch: "main",
      state: "partial",
      limitations: ["Static only"],
      files: [
        { path: "src/a.ts", content: "export const a = 1;", hash: "one" },
      ],
      edges: [],
    });
    revisionId = revision.id;
  });
  it("validates feature scope, pins baseline and detects changed source", async () => {
    const body = {
      title: "A feature",
      requirement: "Must work",
      kind: "existing",
      revisionId,
      paths: ["missing.ts"],
    };
    expect(
      (
        await request(app)
          .post("/api/projects/" + projectId + "/features")
          .set(auth())
          .send(body)
      ).status,
    ).toBe(422);
    const f = await request(app)
      .post("/api/projects/" + projectId + "/features")
      .set(auth())
      .send({ ...body, paths: ["src/a.ts"] });
    expect(f.status).toBe(201);
    featureId = f.body.data._id;
    expect(
      (
        await request(app)
          .put("/api/projects/" + projectId + "/features/" + featureId + "/pin")
          .set(auth())
          .send({ revisionId })
      ).status,
    ).toBe(200);
    const second = await Revision.create({
      projectId,
      sha: "b".repeat(40),
      branch: "main",
      state: "partial",
      files: [
        { path: "src/a.ts", content: "export const a = 2;", hash: "two" },
      ],
      edges: [],
    });
    const comparison = await request(app)
      .get(
        "/api/projects/" +
          projectId +
          "/features/" +
          featureId +
          "/pin/compare",
      )
      .query({ revisionId: second.id })
      .set(auth());
    expect(comparison.body.data.changed).toEqual(["src/a.ts"]);
    expect(comparison.body.data.verification).toBe("unknown");
  });
  it("stores trace provenance and rejects evidence for another commit", async () => {
    const i = await request(app)
      .post("/api/projects/" + projectId + "/investigations")
      .set(auth())
      .send({ revisionId, text: "at /app/src/a.ts:1:1" });
    expect(i.status).toBe(201);
    investigationId = i.body.data._id;
    expect(i.body.data.frames[0].provenance).toBe("trace");
    const run = await TestRun.create({
      projectId,
      githubRunId: 123,
      sha: "b".repeat(40),
      name: "test",
      status: "completed",
      conclusion: "success",
      url: "https://github.com/acme/test/actions/runs/123",
    });
    expect(
      (
        await request(app)
          .put(
            "/api/projects/" +
              projectId +
              "/investigations/" +
              investigationId +
              "/verification",
          )
          .set(auth())
          .send({ runId: run.id })
      ).status,
    ).toBe(422);
  });
  it("revokes sessions on logout", async () => {
    expect((await request(app).post("/api/logout").set(auth())).status).toBe(
      204,
    );
    expect((await request(app).get("/api/projects").set(auth())).status).toBe(
      401,
    );
  });
});

import { beforeAll, afterAll, describe, expect, it } from "vitest";
import mongoose from "mongoose";
import { createHash, randomBytes } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { User } from "../src/models/User.js";
import { Session } from "../src/models/Session.js";
import { Project } from "../src/models/Project.js";
import { Revision } from "../src/models/Revision.js";
import { Feature } from "../src/models/Feature.js";
import { TestRun } from "../src/models/TestRun.js";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)("feature assessment flow", () => {
  const app = createApp("http://localhost:5173");
  const token = randomBytes(32).toString("base64url");
  let projectId = "",
    featureId = "",
    revisionId = "",
    assessmentId = "";
  const auth = () => ({ Authorization: "Bearer " + token });
  const base = () => "/api/projects/" + projectId;
  beforeAll(async () => {
    await mongoose.connect(uri!, {
      dbName: "velament_assessment_" + randomBytes(8).toString("hex"),
    });
    const u = await User.create({ email: "evidence@example.com", name: "Dev" });
    await Session.create({
      userId: u.id,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 600000),
    });
    const p = await Project.create({
      userId: u.id,
      owner: "acme",
      repo: "app",
      branch: "main",
    });
    projectId = p.id;
    const r = await Revision.create({
      projectId,
      sha: "a".repeat(40),
      branch: "main",
      state: "partial",
      limitations: ["Only a partial repository snapshot was analyzed"],
      files: [
        {
          path: "signup.ts",
          content: "export function signup() {}",
          hash: "a",
        },
      ],
      edges: [],
    });
    revisionId = r.id;
    const f = await Feature.create({
      projectId,
      revisionId,
      title: "Signup",
      requirement: "Users can sign up",
      kind: "existing",
      paths: ["signup.ts"],
    });
    featureId = f.id;
  });
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  it("lists candidates with an explicit unverified label", async () => {
    const res = await request(app)
      .get(base() + "/revisions/" + revisionId + "/feature-candidates")
      .set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data.candidates[0].verification).toBe("unverified");
  });
  it("saves an assessment tied to feature version and revision", async () => {
    const res = await request(app)
      .post(base() + "/features/" + featureId + "/assessments")
      .set(auth())
      .send({ revisionId, featureVersion: 1 });
    expect(res.status).toBe(201);
    assessmentId = res.body.data._id;
    expect(res.body.data.evidence.proof).toBe("not-established");
    expect(res.body.data.sha).toBe("a".repeat(40));
    expect(res.body.data.evidence.prompt).toContain(
      "Only a partial repository snapshot was analyzed",
    );
  });
  it("rejects evidence from a different commit", async () => {
    const run = await TestRun.create({
      projectId,
      githubRunId: 99,
      sha: "b".repeat(40),
      name: "test",
      status: "completed",
      conclusion: "success",
      url: "https://github.com/acme/app/actions/runs/99",
    });
    const res = await request(app)
      .put(base() + "/assessments/" + assessmentId + "/verification")
      .set(auth())
      .send({ runId: run.id });
    expect(res.status).toBe(422);
  });
  it("shows historical assessments as stale after changing the requirement", async () => {
    await Feature.updateOne({ _id: featureId }, { $inc: { version: 1 } });
    const res = await request(app)
      .get(base() + "/assessments/" + assessmentId)
      .set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data.stale).toBe(true);
    expect(res.body.data.assessment.featureVersion).toBe(1);
  });
});

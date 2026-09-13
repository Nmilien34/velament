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
  it("scopes reality findings and intentional reviews to an exact revision", async () => {
    const r = await Revision.create({
      projectId,
      sha: "c".repeat(40),
      branch: "main",
      state: "partial",
      files: [
        { path: "config.ts", hash: "fixed", content: "const timeout = 3600;" },
      ],
      edges: [],
      limitations: [],
    });
    const url = base() + "/revisions/" + r.id + "/reality";
    const found = await request(app).get(url).set(auth());
    expect(found.status).toBe(200);
    const findingId = found.body.data.findings[0].id;
    expect(
      (
        await request(app)
          .put(url + "/" + findingId + "/review")
          .set(auth())
          .send({ reason: "Intentional timeout policy" })
      ).status,
    ).toBe(200);
    const reviewed = await request(app).get(url).set(auth());
    expect(reviewed.body.data.reviews[0].reason).toBe(
      "Intentional timeout policy",
    );
    expect(reviewed.body.data.verification).toBe("not-established");
    expect(
      (
        await request(app)
          .get(base() + "/revisions/" + revisionId + "/reality")
          .set(auth())
      ).body.data.reviews,
    ).toEqual([]);
    expect(
      (
        await request(app)
          .put(url + "/" + "f".repeat(64) + "/review")
          .set(auth())
          .send({ reason: "Invalid finding" })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .delete(url + "/" + findingId + "/review")
          .set(auth())
      ).status,
    ).toBe(204);
    expect((await request(app).get(url).set(auth())).body.data.reviews).toEqual(
      [],
    );
    expect((await request(app).get(url)).status).toBe(401);
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
  it("requires reassociation after a GitHub rerun", async () => {
    const run = await TestRun.create({
      projectId,
      githubRunId: 100,
      sha: "a".repeat(40),
      name: "test",
      status: "completed",
      conclusion: "success",
      runAttempt: 1,
      url: "https://github.com/acme/app/actions/runs/100",
    });
    const url = base() + "/assessments/" + assessmentId;
    let res = await request(app)
      .put(url + "/verification")
      .set(auth())
      .send({ runId: run.id });
    expect(res.body.data.runEvidence.selectedAttempt).toBe(1);
    expect(res.body.data.runEvidence.stale).toBe(false);
    await TestRun.updateOne(
      { _id: run.id },
      { $set: { runAttempt: 2, conclusion: "failure" } },
    );
    res = await request(app).get(url).set(auth());
    expect(res.body.data.runEvidence.stale).toBe(true);
    expect(res.body.data.runEvidence.selectedAttempt).toBe(1);
    expect(res.body.data.runEvidence.featureVerification).toBe(
      "not-established",
    );
    res = await request(app)
      .put(url + "/verification")
      .set(auth())
      .send({ runId: run.id });
    expect(res.body.data.runEvidence.selectedAttempt).toBe(2);
    expect(res.body.data.runEvidence.stale).toBe(false);
  });
  it("ingests attempt-scoped user reports without promoting them to verified proof", async () => {
    const run = await TestRun.findOne({ projectId, githubRunId: 100 });
    const url = base() + "/assessments/" + assessmentId;
    const body = {
      runId: run!.id,
      attempt: 2,
      sha: "a".repeat(40),
      environment: "staging",
      mockedBoundaries: ["email provider"],
      tests: [{ name: "Signup sends email", outcome: "passed" }],
    };
    expect(
      (
        await request(app)
          .put(url + "/test-report")
          .set(auth())
          .send({ ...body, attempt: 1 })
      ).status,
    ).toBe(422);
    const saved = await request(app)
      .put(url + "/test-report")
      .set(auth())
      .send(body);
    expect(saved.status).toBe(200);
    expect(saved.body.data.reportEvidence.report.provenance).toBe(
      "user-uploaded",
    );
    expect(saved.body.data.reportEvidence.featureVerification).toBe(
      "not-established",
    );
    expect(saved.body.data.reportEvidence.report.outcome).toBe("passed");
    expect(
      (
        await request(app)
          .put(url + "/test-report")
          .set(auth())
          .send({ ...body, tests: [body.tests[0], body.tests[0]] })
      ).status,
    ).toBe(400);
    expect(saved.body.data.reportEvidence.staleReasons).toEqual([
      "feature-changed",
    ]);
    await TestRun.updateOne(
      { _id: run!.id },
      { $set: { status: "in_progress" } },
    );
    const pending = (await request(app).get(url).set(auth())).body.data
      .reportEvidence;
    expect(pending.staleReasons).toContain("run-not-completed");
    expect(pending.stale).toBe(true);
    await TestRun.updateOne({ _id: run!.id }, { $set: { runAttempt: 3 } });
    expect(
      (await request(app).get(url).set(auth())).body.data.reportEvidence.stale,
    ).toBe(true);
  });
  it("removes uploaded evidence without removing the assessment or run association", async () => {
    const url = base() + "/assessments/" + assessmentId;
    expect((await request(app).delete(url + "/test-report")).status).toBe(401);
    expect(
      (
        await request(app)
          .delete(url + "/test-report")
          .set(auth())
      ).status,
    ).toBe(204);
    const response = await request(app).get(url).set(auth());
    expect(response.status).toBe(200);
    expect(response.body.data.reportEvidence).toBeNull();
    expect(response.body.data.assessment.testRunId).toBeTruthy();
    expect(
      (
        await request(app)
          .delete(url + "/test-report")
          .set(auth())
      ).status,
    ).toBe(204);
    expect(
      (
        await request(app)
          .delete(
            base() +
              "/assessments/" +
              new mongoose.Types.ObjectId() +
              "/test-report",
          )
          .set(auth())
      ).status,
    ).toBe(404);
  });
});

import { Investigation } from "../src/models/Investigation.js";
import { diagnoseWithAI } from "../src/services/ai-diagnosis.service.js";
vi.mock("../src/services/ai-diagnosis.service.js", () => ({
  diagnoseWithAI: vi.fn(),
}));
import { discoverWithAI } from "../src/services/ai-discovery.service.js";
vi.mock("../src/services/ai-discovery.service.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../src/services/ai-discovery.service.js")
  >()),
  discoverWithAI: vi.fn(),
}));
import { claimDiscoveryRetry } from "../src/services/ai-recovery.service.js";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { createHash, randomBytes } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { User } from "../src/models/User.js";
import { Session } from "../src/models/Session.js";
import { Project } from "../src/models/Project.js";
import { Revision } from "../src/models/Revision.js";
import { Feature } from "../src/models/Feature.js";
import { AiDiscovery } from "../src/models/AiDiscovery.js";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)("AI recovery", () => {
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
      dbName: "velament_ai_recovery_" + randomBytes(8).toString("hex"),
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

  it("expires abandoned requests without resending source", async () => {
    const record = await AiDiscovery.create({
      projectId,
      revisionId,
      scopeKey: "expired",
      status: "pending",
      createdAt: new Date(Date.now() - 180000),
    });
    const res = await request(app)
      .get(base() + "/ai-discoveries/" + record.id)
      .set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("failed");
    expect(res.body.data.errorCode).toBe("AI_REQUEST_INTERRUPTED");
  });
  it("keeps recent work pending and hides another project's record", async () => {
    const record = await AiDiscovery.create({
      projectId,
      revisionId,
      scopeKey: "recent",
      status: "pending",
    });
    expect(
      (
        await request(app)
          .get(base() + "/ai-discoveries/" + record.id)
          .set(auth())
      ).body.data.status,
    ).toBe("pending");
    const foreign = await AiDiscovery.create({
      projectId: new mongoose.Types.ObjectId(),
      revisionId,
      scopeKey: "foreign",
      status: "completed",
    });
    expect(
      (
        await request(app)
          .get(base() + "/ai-discoveries/" + foreign.id)
          .set(auth())
      ).status,
    ).toBe(404);
  });
  it("returns cached discovery without provider configuration and requires sharing consent", async () => {
    const record = await AiDiscovery.create({
      projectId,
      revisionId,
      scopeKey: createHash("sha256")
        .update(JSON.stringify(["signup.ts"]))
        .digest("hex"),
      status: "completed",
      result: { verification: "unverified" },
    });
    const url = base() + "/revisions/" + revisionId + "/ai-discovery";
    const response = await request(app)
      .post(url)
      .set(auth())
      .send({ paths: ["signup.ts"], allowSourceSharing: true });
    expect(response.status).toBe(200);
    expect(response.body.data._id).toBe(record.id);
    expect(
      (
        await request(app)
          .post(url)
          .set(auth())
          .send({ paths: ["signup.ts"] })
      ).status,
    ).toBe(400);
  });
  it("claims only one concurrent retry and starts a fresh timeout", async () => {
    const record = await AiDiscovery.create({
      projectId,
      revisionId,
      scopeKey: "retry",
      status: "failed",
      createdAt: new Date(Date.now() - 180000),
    });
    const claims = await Promise.all([
      claimDiscoveryRetry(projectId, record.id, 1),
      claimDiscoveryRetry(projectId, record.id, 1),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)?.attempt).toBe(2);
    const response = await request(app)
      .get(base() + "/ai-discoveries/" + record.id)
      .set(auth());
    expect(response.body.data.status).toBe("pending");
    expect(await claimDiscoveryRetry(projectId, record.id, 1)).toBeNull();
  });
  it("executes one explicit retry and rejects stale replay", async () => {
    const scopeKey = createHash("sha256")
      .update(JSON.stringify(["signup.ts"]))
      .digest("hex");
    await AiDiscovery.updateOne(
      { projectId, revisionId, scopeKey },
      { $set: { status: "failed" } },
    );
    vi.stubEnv("OPENAI_API_KEY", "test-only");
    vi.mocked(discoverWithAI).mockResolvedValue({
      features: [],
      limitations: [],
      provenance: "openai",
      verification: "unverified",
      model: "test",
      usage: null,
    });
    try {
      const url = base() + "/revisions/" + revisionId + "/ai-discovery";
      const input = {
        paths: ["signup.ts"],
        allowSourceSharing: true,
        retryAttempt: 1,
      };
      const response = await request(app).post(url).set(auth()).send(input);
      expect(response.status).toBe(201);
      expect(response.body.data.attempt).toBe(2);
      expect(
        (await request(app).post(url).set(auth()).send(input)).status,
      ).toBe(409);
      expect(discoverWithAI).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("binds AI diagnosis to an investigation and reuses its result", async () => {
    const investigation = await Investigation.create({
      projectId,
      revisionId,
      traceRevisionId: new mongoose.Types.ObjectId(),
      text: "TypeError at signup.ts:1",
      prompt: "Investigate",
    });
    vi.stubEnv("OPENAI_API_KEY", "test-only");
    vi.mocked(diagnoseWithAI).mockResolvedValue({
      causes: [],
      nextSteps: [],
      limitations: [],
      prompt: "Investigate",
      historicalTrace: true,
      provenance: "openai",
      verification: "unverified",
      model: "test",
      usage: null,
    });
    try {
      const url =
        base() +
        "/revisions/" +
        revisionId +
        "/investigations/" +
        investigation.id +
        "/ai-diagnosis";
      const body = { paths: ["signup.ts"], allowSourceSharing: true };
      const first = await request(app).post(url).set(auth()).send(body);
      expect(first.status).toBe(201);
      expect(first.body.data.result.kind).toBe("error-diagnosis");
      expect(vi.mocked(diagnoseWithAI).mock.calls[0]?.[1].historicalTrace).toBe(
        true,
      );
      expect((await request(app).post(url).set(auth()).send(body)).status).toBe(
        200,
      );
      expect(diagnoseWithAI).toHaveBeenCalledTimes(1);
      const foreign = await Investigation.create({
        projectId: new mongoose.Types.ObjectId(),
        revisionId,
        text: "error",
        prompt: "Investigate",
      });
      expect(
        (
          await request(app)
            .post(
              base() +
                "/revisions/" +
                revisionId +
                "/investigations/" +
                foreign.id +
                "/ai-diagnosis",
            )
            .set(auth())
            .send(body)
        ).status,
      ).toBe(404);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

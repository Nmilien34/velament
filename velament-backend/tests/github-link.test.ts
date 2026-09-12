import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { createHash, randomBytes } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { GitHubState } from "../src/models/GitHubConnection.js";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)("repository authorization browser binding", () => {
  const app = createApp("http://localhost:5173"),
    state = randomBytes(32).toString("base64url"),
    browser = randomBytes(32).toString("base64url");
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ error: "test" })));
  beforeAll(async () => {
    await mongoose.connect(uri!, {
      dbName: "velament_link_" + randomBytes(8).toString("hex"),
    });
    for (const [key, value] of Object.entries({
      GITHUB_APP_ID: "1",
      GITHUB_APP_CLIENT_ID: "client",
      GITHUB_APP_CLIENT_SECRET: "secret",
      GITHUB_APP_PRIVATE_KEY: "key",
      GITHUB_APP_CALLBACK_URL: "http://localhost:4000/api/github/callback",
      TOKEN_ENCRYPTION_KEY: "a".repeat(64),
    }))
      vi.stubEnv(key, value);
    await GitHubState.create({
      userId: new mongoose.Types.ObjectId(),
      hash: createHash("sha256").update(state).digest("hex"),
      browserHash: createHash("sha256").update(browser).digest("hex"),
      verifier: "verifier",
      expiresAt: new Date(Date.now() + 60000),
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it("rejects a forwarded callback without the initiating browser cookie", async () => {
    const res = await request(app)
      .get("/api/github/callback")
      .query({ state, code: "test-code" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_OAUTH_STATE");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await GitHubState.countDocuments()).toBe(1);
  });
  it("handles cancellation once without contacting GitHub", async () => {
    const res = await request(app)
      .get("/api/github/callback")
      .set("Cookie", "velament_github_link=" + browser)
      .query({ state, error: "access_denied" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("GITHUB_CONNECTION_CANCELLED");
    expect(await GitHubState.countDocuments()).toBe(0);
    expect(res.headers["set-cookie"].join("")).toContain(
      "velament_github_link=;",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

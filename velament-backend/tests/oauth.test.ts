import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import mongoose from "mongoose";
import { randomBytes } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { User } from "../src/models/User.js";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)("OAuth browser flow", () => {
  const app = createApp("http://localhost:5173");
  const fetchMock = vi.fn();
  beforeAll(async () => {
    await mongoose.connect(uri!, {
      dbName: "velament_oauth_" + randomBytes(8).toString("hex"),
    });
    await User.init();
    vi.stubEnv("AUTH_API_ORIGIN", "http://localhost:4000");
    vi.stubEnv("AUTH_APP_ORIGIN", "http://localhost:5173");
    vi.stubEnv("GITHUB_OAUTH_CLIENT_ID", "test-client");
    vi.stubEnv("GITHUB_OAUTH_CLIENT_SECRET", "test-secret");
    vi.stubGlobal("fetch", fetchMock);
  });
  beforeEach(() => fetchMock.mockReset());
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  async function start() {
    const res = await request(app).get("/api/auth/github/start");
    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.hostname).toBe("github.com");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    return {
      state: location.searchParams.get("state")!,
      cookie: res.headers["set-cookie"]![0]!.split(";")[0]!,
    };
  }
  function provider(subject: number, email: string) {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "secret-provider-token" })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: subject, login: "dev", name: "Developer" }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ email, verified: true, primary: true }]),
        ),
      );
  }
  it("binds callbacks to the initiating browser", async () => {
    const flow = await start();
    const res = await request(app)
      .get("/api/auth/github/callback")
      .query({ state: flow.state, code: "code" });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("signs up, creates an opaque cookie and rejects callback replay", async () => {
    const flow = await start();
    provider(101, "first@example.com");
    const res = await request(app)
      .get("/api/auth/github/callback")
      .set("Cookie", flow.cookie)
      .query({ state: flow.state, code: "code" });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://localhost:5173/auth/complete");
    expect(JSON.stringify(res.headers)).not.toContain("secret-provider-token");
    const cookie = (res.headers["set-cookie"] as unknown as string[]).find(
      (s) => s.startsWith("velament_session="),
    )!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    const me = await request(app)
      .get("/api/me")
      .set("Cookie", cookie.split(";")[0]!);
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe("first@example.com");
    const replay = await request(app)
      .get("/api/auth/github/callback")
      .set("Cookie", flow.cookie)
      .query({ state: flow.state, code: "code" });
    expect(replay.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("never merges a new provider identity by matching email", async () => {
    await User.create({ email: "existing@example.com", name: "Existing" });
    const flow = await start();
    provider(202, "existing@example.com");
    const res = await request(app)
      .get("/api/auth/github/callback")
      .set("Cookie", flow.cookie)
      .query({ state: flow.state, code: "code" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ACCOUNT_EXISTS");
  });
  it("handles provider denial without exchanging credentials", async () => {
    const flow = await start();
    const res = await request(app)
      .get("/api/auth/github/callback")
      .set("Cookie", flow.cookie)
      .query({ state: flow.state, error: "access_denied" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SIGN_IN_CANCELLED");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

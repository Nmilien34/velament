import { beforeAll, afterAll, describe, expect, it } from "vitest";
import mongoose from "mongoose";
import { randomBytes, createHash } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { User } from "../src/models/User.js";
import { Session } from "../src/models/Session.js";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)("browser authentication", () => {
  const app = createApp("http://localhost:5173");
  let token = "";
  beforeAll(async () => {
    await mongoose.connect(uri!, {
      dbName: "velament_auth_" + randomBytes(8).toString("hex"),
    });
    const user = await User.create({
      email: "cookie@example.com",
      name: "Cookie",
    });
    token = randomBytes(32).toString("base64url");
    await Session.create({
      userId: user.id,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 60000),
    });
  });
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  it("accepts an HttpOnly browser session", async () => {
    const res = await request(app)
      .get("/api/me")
      .set("Cookie", "velament_session=" + token);
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe("cookie@example.com");
  });
  it("rejects cookie-authenticated writes from an untrusted origin", async () => {
    const res = await request(app)
      .post("/api/logout")
      .set("Cookie", "velament_session=" + token)
      .set("Origin", "https://evil.example");
    expect(res.status).toBe(403);
  });
  it("requires an Origin for browser mutations", async () => {
    expect(
      (
        await request(app)
          .post("/api/logout")
          .set("Cookie", "velament_session=" + token)
      ).status,
    ).toBe(403);
  });
  it("lists sessions without exposing token hashes", async () => {
    const res = await request(app)
      .get("/api/sessions")
      .set("Cookie", "velament_session=" + token);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].current).toBe(true);
    expect(res.body.data[0].tokenHash).toBeUndefined();
  });
  it("logs out and clears the cookie", async () => {
    const res = await request(app)
      .post("/api/logout")
      .set("Cookie", "velament_session=" + token)
      .set("Origin", "http://localhost:5173");
    expect(res.status).toBe(204);
    expect(res.headers["set-cookie"]?.[0]).toContain("velament_session=;");
    expect(
      (
        await request(app)
          .get("/api/me")
          .set("Cookie", "velament_session=" + token)
      ).status,
    ).toBe(401);
  });
});

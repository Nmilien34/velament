import { beforeAll, afterAll, describe, expect, it } from "vitest";
import mongoose from "mongoose";
import { randomBytes, createHash } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { User } from "../src/models/User.js";
import { Session } from "../src/models/Session.js";
import { Project } from "../src/models/Project.js";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)("project lifecycle", () => {
  const app = createApp("http://localhost:5173"),
    token = randomBytes(32).toString("base64url");
  let id = "",
    otherId = "";
  const auth = () => ({ Authorization: "Bearer " + token });
  beforeAll(async () => {
    await mongoose.connect(uri!, {
      dbName: "velament_lifecycle_" + randomBytes(8).toString("hex"),
    });
    const user = await User.create({ name: "Dev", email: "dev@example.com" });
    await Session.create({
      userId: user.id,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 600000),
    });
    id = (
      await Project.create({
        userId: user.id,
        owner: "acme",
        repo: "app",
        branch: "main",
        archivedAt: new Date(),
      })
    ).id;
    otherId = (
      await Project.create({
        userId: new mongoose.Types.ObjectId(),
        owner: "other",
        repo: "app",
        branch: "main",
        archivedAt: new Date(),
      })
    ).id;
  });
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  it("lists archived projects separately", async () => {
    const res = await request(app)
      .get("/api/projects?status=archived")
      .set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data.map((p: { _id: string }) => p._id)).toEqual([id]);
  });
  it("rejects fractional pagination", async () => {
    expect(
      (await request(app).get("/api/projects?page=1.5").set(auth())).status,
    ).toBe(400);
  });
  it("restores only an owned archived project", async () => {
    expect(
      (
        await request(app)
          .post("/api/projects/" + otherId + "/restore")
          .set(auth())
      ).status,
    ).toBe(404);
    const res = await request(app)
      .post("/api/projects/" + id + "/restore")
      .set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data.archivedAt).toBeUndefined();
  });
  it("reports missing connection and analysis instead of inventing readiness", async () => {
    const res = await request(app)
      .get("/api/projects/" + id + "/status")
      .set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data.connection).toBe("not-configured");
    expect(res.body.data.analysis).toBe("not-started");
    expect(res.body.data.latestRevision).toBeNull();
  });
});

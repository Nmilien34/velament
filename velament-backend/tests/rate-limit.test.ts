import express from "express";
import request from "supertest";
import { rateLimit } from "../src/middleware/rate-limit.js";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import mongoose from "mongoose";
import { randomBytes } from "node:crypto";
import { consumeBudget } from "../src/services/rate-limit.service.js";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)("shared request budget", () => {
  beforeAll(async () => {
    await mongoose.connect(uri!, {
      dbName: "velament_limit_" + randomBytes(8).toString("hex"),
    });
  });
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  it("caps concurrent requests against one shared budget", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        consumeBudget("auth", "client", 3, 60000),
      ),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
    expect(results.every((r) => r.retryAfter > 0)).toBe(true);
  });
  it("keeps different clients independent", async () => {
    expect((await consumeBudget("auth", "other", 3, 60000)).allowed).toBe(true);
  });
  it("rejects over-budget HTTP requests before their handler", async () => {
    const app = express();
    let calls = 0;
    app.use((_req, res, next) => {
      res.locals.userId = "http-user";
      next();
    });
    app.get("/work", rateLimit("http-test", 1, 60000), (_req, res) => {
      calls++;
      res.sendStatus(200);
    });
    app.use(((error, _req, res, _next) =>
      res
        .status(error.status)
        .json({ code: error.code })) as express.ErrorRequestHandler);
    expect((await request(app).get("/work")).status).toBe(200);
    const denied = await request(app).get("/work");
    expect(denied.status).toBe(429);
    expect(Number(denied.headers["retry-after"])).toBeGreaterThan(0);
    expect(calls).toBe(1);
  });
});

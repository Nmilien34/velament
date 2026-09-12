import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
describe("API boundary", () => {
  const app = createApp("http://localhost:5173");
  it("returns the shared health contract", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", service: "velament-api" });
  });
  it("reports not-ready when MongoDB is disconnected", async () => {
    const res = await request(app).get("/api/ready");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("not-ready");
    expect(res.headers["cache-control"]).toBe("no-store");
  });
  it("returns structured missing routes", async () => {
    const res = await request(app).get("/missing");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});

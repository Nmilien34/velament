import { expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
const app = createApp("http://localhost:5173,https://app.example.com");
it("allows configured origins and preflight", async () => {
  const res = await request(app)
    .options("/api/health")
    .set("Origin", "https://app.example.com")
    .set("Access-Control-Request-Method", "GET");
  expect(res.status).toBe(204);
  expect(res.headers["access-control-allow-origin"]).toBe(
    "https://app.example.com",
  );
});
it("does not grant browser access to other origins", async () => {
  const res = await request(app)
    .get("/api/health")
    .set("Origin", "https://untrusted.example");
  expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  expect(res.headers["x-request-id"]).toBeTruthy();
});

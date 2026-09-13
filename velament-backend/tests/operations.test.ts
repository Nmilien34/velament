import { it, expect, vi, afterEach } from "vitest";
import request from "supertest";
vi.mock("../src/models/Deletion.js", () => ({
  Deletion: { countDocuments: vi.fn().mockResolvedValue(2) },
}));
vi.mock("../src/models/Job.js", () => ({
  Job: {
    countDocuments: vi.fn().mockResolvedValue(0),
    findOne: vi
      .fn()
      .mockReturnValue({ sort: () => ({ select: async () => null }) }),
  },
}));
vi.mock("../src/models/Dispatch.js", () => ({
  Dispatch: { countDocuments: vi.fn().mockResolvedValue(0) },
}));
import { createApp } from "../src/app.js";
const app = createApp("http://localhost:5173");
afterEach(() => vi.unstubAllEnvs());
it("requires a configured operator token", async () => {
  vi.stubEnv("OPERATIONS_TOKEN", "");
  expect((await request(app).get("/internal/metrics")).status).toBe(503);
  vi.stubEnv("OPERATIONS_TOKEN", "a".repeat(32));
  expect((await request(app).get("/internal/metrics")).status).toBe(401);
});
it("returns aggregate metrics without project data", async () => {
  vi.stubEnv("OPERATIONS_TOKEN", "a".repeat(32));
  const response = await request(app)
    .get("/internal/metrics")
    .auth("a".repeat(32), { type: "bearer" });
  expect(response.status).toBe(200);
  expect(response.body.data.deletions).toEqual({ pending: 2, overdue: 2 });
  expect(response.body.data.queue).toEqual({
    queued: 0,
    running: 0,
    failed: 0,
    expiredLeases: 0,
    oldestReadyAgeSeconds: 0,
  });
  expect(response.headers["cache-control"]).toBe("no-store");
});

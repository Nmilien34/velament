import { beforeAll, afterAll, it, expect, vi } from "vitest";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
vi.mock("../src/services/github-app.service.js", () => ({
  repositoryToken: vi.fn().mockResolvedValue("token"),
}));
vi.mock("../src/services/github.service.js", () => ({ githubGet: vi.fn() }));
import { githubGet } from "../src/services/github.service.js";
import { importRun } from "../src/services/run.service.js";
import { Project } from "../src/models/Project.js";
import { TestRun } from "../src/models/TestRun.js";
import { revokeAccess } from "../src/services/access.service.js";
const uri = process.env.TEST_MONGODB_URI;
let projectId: string;
beforeAll(async () => {
  if (!uri) return;
  await mongoose.connect(uri, { dbName: "run_import_" + randomUUID() });
  await TestRun.init();
  projectId = (
    await Project.create({
      userId: new mongoose.Types.ObjectId(),
      owner: "a",
      repo: "b",
      branch: "main",
      installationId: 1,
      repositoryId: 2,
    })
  ).id;
});
afterAll(async () => {
  if (uri) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
function response(status: string, attempt = 1, time = "2026-09-12T12:00:00Z") {
  return {
    id: 123,
    head_sha: "abc",
    name: "Tests",
    status,
    conclusion: status === "completed" ? "success" : null,
    html_url: "https://github.com/a/b/actions/runs/123",
    updated_at: time,
    run_attempt: attempt,
  };
}
it.skipIf(!uri)(
  "keeps completion despite a delayed active response and accepts a new attempt",
  async () => {
    vi.mocked(githubGet).mockResolvedValue(response("completed"));
    await importRun(projectId, 123);
    vi.mocked(githubGet).mockResolvedValue(response("in_progress"));
    expect((await importRun(projectId, 123))?.status).toBe("completed");
    vi.mocked(githubGet).mockResolvedValue(response("in_progress", 2));
    expect((await importRun(projectId, 123))?.status).toBe("in_progress");
    vi.mocked(githubGet).mockResolvedValue(
      response("completed", 1, "2026-09-12T13:00:00Z"),
    );
    expect((await importRun(projectId, 123))?.status).toBe("in_progress");
  },
);
it.skipIf(!uri)("rejects a mismatched provider run", async () => {
  vi.mocked(githubGet).mockResolvedValue(response("completed"));
  await expect(importRun(projectId, 456)).rejects.toMatchObject({
    code: "GITHUB_RUN_MISMATCH",
  });
});
it.skipIf(!uri)(
  "does not save a response received after revocation",
  async () => {
    const p = await Project.findById(projectId);
    const before = await TestRun.findOne({ projectId }).lean();
    vi.mocked(githubGet).mockImplementationOnce(async () => {
      await revokeAccess(p!.userId.toString());
      return response("completed", 3);
    });
    await expect(importRun(projectId, 123)).rejects.toMatchObject({
      code: "ACCESS_REVOKED",
    });
    const after = await TestRun.findOne({ projectId }).lean();
    expect(after?.runAttempt).toBe(before?.runAttempt);
    expect(after?.status).toBe(before?.status);
  },
);

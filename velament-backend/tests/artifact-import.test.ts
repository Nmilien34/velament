import { beforeAll, afterAll, afterEach, it, expect, vi } from "vitest";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
vi.mock("../src/services/github-app.service.js", () => ({
  repositoryToken: vi.fn().mockResolvedValue("private-token"),
}));
vi.mock("../src/services/github.service.js", () => ({ githubGet: vi.fn() }));
vi.mock("../src/services/artifact-report.service.js", () => ({
  boundedBody: vi.fn().mockResolvedValue(Buffer.from("zip")),
  readArtifactReport: vi.fn(),
}));
import { githubGet } from "../src/services/github.service.js";
import { readArtifactReport } from "../src/services/artifact-report.service.js";
import { importArtifactReport } from "../src/services/artifact.service.js";
import { revokeAccess } from "../src/services/access.service.js";
import { Project } from "../src/models/Project.js";
import { TestRun } from "../src/models/TestRun.js";
import { FeatureAssessment } from "../src/models/FeatureAssessment.js";
const uri = process.env.TEST_MONGODB_URI;
let projectId: string, runId: string, assessmentId: string, userId: string;
beforeAll(async () => {
  if (!uri) return;
  await mongoose.connect(uri, { dbName: "artifact_import_" + randomUUID() });
  userId = new mongoose.Types.ObjectId().toString();
  projectId = (
    await Project.create({
      userId,
      owner: "a",
      repo: "b",
      branch: "main",
      installationId: 1,
      repositoryId: 2,
    })
  ).id;
  runId = (
    await TestRun.create({
      projectId,
      githubRunId: 1,
      sha: "a".repeat(40),
      name: "Tests",
      status: "completed",
      runAttempt: 1,
      url: "https://github.com/a/b/actions/runs/1",
    })
  ).id;
  assessmentId = (
    await FeatureAssessment.create({
      projectId,
      featureId: new mongoose.Types.ObjectId(),
      revisionId: new mongoose.Types.ObjectId(),
      sha: "a".repeat(40),
      featureVersion: 1,
      requirement: "Signup",
      evidence: {},
    })
  ).id;
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  if (uri) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
function setup(host = "storage.blob.core.windows.net") {
  vi.mocked(githubGet).mockResolvedValue({
    id: 3,
    expired: false,
    size_in_bytes: 100,
    workflow_run: { id: 1, head_sha: "a".repeat(40) },
  });
  vi.mocked(readArtifactReport).mockResolvedValue({
    runId,
    attempt: 1,
    sha: "a".repeat(40),
    environment: "ci",
    mockedBoundaries: [],
    tests: [{ name: "Signup", outcome: "passed" }],
  });
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: `https://${host}/archive` },
      }),
    )
    .mockResolvedValueOnce(new Response("zip"));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
it.skipIf(!uri)(
  "imports provenance and never forwards credentials to storage",
  async () => {
    const fetcher = setup();
    const result = await importArtifactReport(
      projectId,
      assessmentId,
      runId,
      3,
    );
    expect(result.reportEvidence?.report.provenance).toBe("github-artifact");
    expect(result.reportEvidence?.report.artifactId).toBe(3);
    expect(fetcher.mock.calls[0]?.[1].headers.Authorization).toBe(
      "Bearer private-token",
    );
    expect(fetcher.mock.calls[1]?.[1]).not.toHaveProperty("headers");
  },
);
it.skipIf(!uri)("rejects unknown storage before downloading", async () => {
  const fetcher = setup("attacker.example");
  await expect(
    importArtifactReport(projectId, assessmentId, runId, 3),
  ).rejects.toMatchObject({ code: "ARTIFACT_UNAVAILABLE" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it.skipIf(!uri)(
  "rejects artifacts from other runs before downloading",
  async () => {
    const fetcher = setup();
    vi.mocked(githubGet).mockResolvedValue({
      id: 3,
      expired: false,
      size_in_bytes: 100,
      workflow_run: { id: 2, head_sha: "a".repeat(40) },
    });
    await expect(
      importArtifactReport(projectId, assessmentId, runId, 3),
    ).rejects.toMatchObject({ code: "ARTIFACT_MISMATCH" });
    expect(fetcher).not.toHaveBeenCalled();
  },
);
it.skipIf(!uri)(
  "rejects persistence after revocation during download",
  async () => {
    setup();
    await FeatureAssessment.updateOne(
      { _id: assessmentId },
      { $unset: { testReport: 1 } },
    );
    vi.mocked(readArtifactReport).mockImplementationOnce(async () => {
      await revokeAccess(userId);
      return {
        runId,
        attempt: 1,
        sha: "a".repeat(40),
        environment: "ci",
        mockedBoundaries: [],
        tests: [{ name: "Signup", outcome: "passed" }],
      };
    });
    await expect(
      importArtifactReport(projectId, assessmentId, runId, 3),
    ).rejects.toMatchObject({ code: "ACCESS_REVOKED" });
    expect(
      (await FeatureAssessment.findById(assessmentId))?.testReport,
    ).toBeUndefined();
  },
);

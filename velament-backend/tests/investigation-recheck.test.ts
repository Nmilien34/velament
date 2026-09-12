import { beforeAll, afterAll, describe, expect, it } from "vitest";
import mongoose from "mongoose";
import { randomBytes } from "node:crypto";
import { Investigation } from "../src/models/Investigation.js";
import { Revision } from "../src/models/Revision.js";
import {
  recheckInvestigation,
  investigationGraph,
} from "../src/services/investigation.service.js";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)("investigation recheck", () => {
  const projectId = new mongoose.Types.ObjectId().toString();
  let previousId = "",
    nextRevisionId = "",
    firstRevisionId = "";
  beforeAll(async () => {
    await mongoose.connect(uri!, {
      dbName: "velament_recheck_" + randomBytes(8).toString("hex"),
    });
    const first = await Revision.create({
      projectId,
      sha: "a".repeat(40),
      branch: "main",
      state: "partial",
      files: [
        { path: "src/a.ts", content: "throw new Error('oops');", hash: "a" },
      ],
      edges: [],
    });
    firstRevisionId = first.id;
    const next = await Revision.create({
      projectId,
      sha: "b".repeat(40),
      branch: "main",
      state: "partial",
      files: [
        {
          path: "src/a.ts",
          content: "// shifted\nthrow new Error('oops');",
          hash: "b",
        },
      ],
      edges: [],
    });
    nextRevisionId = next.id;
    const original = await Investigation.create({
      projectId,
      revisionId: first.id,
      text: "at /app/src/a.ts:1:1",
      prompt: "Original custom prompt",
      status: "closed",
      testRunId: new mongoose.Types.ObjectId(),
    });
    previousId = original.id;
  });
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  it("creates a new open investigation without carrying old proof or changing history", async () => {
    const next = await recheckInvestigation(projectId, previousId, {
      revisionId: nextRevisionId,
    });
    expect(next.parentId?.toString()).toBe(previousId);
    expect(next.testRunId).toBeUndefined();
    expect(next.status).toBe("open");
    expect(next.traceRevisionId?.toString()).toBe(firstRevisionId);
    expect(next.frames[0]!.lineAvailable).toBe(false);
    expect(next.prompt).toContain("historical");
    const old = await Investigation.findById(previousId);
    expect(old!.prompt).toBe("Original custom prompt");
    expect(old!.status).toBe("closed");
  });
  it("maps a newly supplied trace to the new revision", async () => {
    const next = await recheckInvestigation(projectId, previousId, {
      revisionId: nextRevisionId,
      text: "at /app/src/a.ts:2:1",
    });
    expect(next.frames[0]!.lineAvailable).toBe(true);
    expect(next.traceRevisionId?.toString()).toBe(nextRevisionId);
    const graph = await investigationGraph(projectId, next.id);
    expect(graph.nodes[0]!.path).toBe("src/a.ts");
    expect(graph.proof).toBe("not-established");
  });
  it("rejects cross-project access", async () => {
    await expect(
      recheckInvestigation(
        new mongoose.Types.ObjectId().toString(),
        previousId,
        { revisionId: nextRevisionId },
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});

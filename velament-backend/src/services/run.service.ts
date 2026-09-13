import mongoose from "mongoose";
import { accessGeneration, assertAccess } from "./access.service.js";
import { repositoryToken } from "./github-app.service.js";
import { z } from "zod";
import { Project } from "../models/Project.js";
import { TestRun } from "../models/TestRun.js";
import { githubGet } from "./github.service.js";
import { HttpError } from "../utils/errors.js";
export async function importRun(projectId: string, runId: number) {
  const p = await Project.findById(projectId);
  if (!p) throw new HttpError(404, "NOT_FOUND", "Project not found");
  if (!p.installationId || !p.repositoryId)
    throw new HttpError(
      409,
      "GITHUB_CONNECTION_REQUIRED",
      "Reconnect the project",
    );
  const generation = await accessGeneration(p.userId.toString());
  const token = await repositoryToken(
    p.userId.toString(),
    p.installationId,
    p.repositoryId,
  );
  const run = z
    .object({
      id: z.number(),
      head_sha: z.string(),
      name: z.string().nullable(),
      status: z.string(),
      conclusion: z.string().nullable(),
      html_url: z.string().url(),
      updated_at: z.iso.datetime(),
      run_attempt: z.number().int().positive().default(1),
    })
    .parse(
      await githubGet(
        "/repos/" +
          encodeURIComponent(p.owner) +
          "/" +
          encodeURIComponent(p.repo) +
          "/actions/runs/" +
          runId,
        token,
      ),
    );
  if (run.id !== runId)
    throw new HttpError(
      502,
      "GITHUB_RUN_MISMATCH",
      "GitHub returned a different run",
    );
  const key = { projectId, githubRunId: run.id };
  const values = {
    sha: run.head_sha,
    name: run.name || "GitHub workflow",
    status: run.status,
    conclusion: run.conclusion,
    url: run.html_url,
    runAttempt: run.run_attempt,
    providerUpdatedAt: new Date(run.updated_at),
    completedAt: run.status === "completed" ? new Date(run.updated_at) : null,
  };
  return mongoose.connection.transaction(async (session) => {
    await assertAccess(p.userId.toString(), generation, session);
    await TestRun.updateOne(
      key,
      {
        $setOnInsert: {
          ...values,
          ...key,
          environment: "unknown",
          provenance: "github-actions",
        },
      },
      { upsert: true, runValidators: true, session },
    );

    // Compare in MongoDB, so a delayed response cannot replace a newer attempt
    // or roll a completed attempt back to an active state.
    await TestRun.updateOne(
      {
        ...key,
        $or: [
          { runAttempt: { $lt: run.run_attempt } },
          {
            $and: [
              {
                $or: [
                  { runAttempt: run.run_attempt },
                  { runAttempt: { $exists: false } },
                ],
              },
              {
                $or: [
                  { providerUpdatedAt: { $lte: values.providerUpdatedAt } },
                  { providerUpdatedAt: { $exists: false } },
                ],
              },
              ...(run.status === "completed"
                ? []
                : [{ status: { $ne: "completed" } }]),
            ],
          },
        ],
      },
      { $set: values },
      { runValidators: true, session },
    );
    return TestRun.findOne(key).session(session);
  });
}

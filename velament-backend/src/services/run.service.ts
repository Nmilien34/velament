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
      updated_at: z.string(),
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
  return TestRun.findOneAndUpdate(
    { projectId, githubRunId: run.id },
    {
      $set: {
        sha: run.head_sha,
        name: run.name || "GitHub workflow",
        status: run.status,
        conclusion: run.conclusion,
        url: run.html_url,
        completedAt:
          run.status === "completed" ? new Date(run.updated_at) : null,
      },
      $setOnInsert: {
        projectId,
        githubRunId: run.id,
        environment: "unknown",
        provenance: "github-actions",
      },
    },
    { upsert: true, new: true, runValidators: true },
  );
}

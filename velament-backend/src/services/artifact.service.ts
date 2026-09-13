import { z } from "zod";
import { Project } from "../models/Project.js";
import { TestRun } from "../models/TestRun.js";
import { repositoryToken } from "./github-app.service.js";
import { githubGet } from "./github.service.js";
import { HttpError } from "../utils/errors.js";
export function parseArtifacts(value: unknown, page: number) {
  const parsed = z
    .object({
      total_count: z.number().int().nonnegative(),
      artifacts: z
        .array(
          z.object({
            id: z.number().int().positive(),
            name: z.string(),
            size_in_bytes: z.number().int().nonnegative(),
            expired: z.boolean(),
            created_at: z.string(),
            expires_at: z.string(),
          }),
        )
        .max(100),
    })
    .parse(value);
  return {
    artifacts: parsed.artifacts,
    nextPage: page * 100 < parsed.total_count && page < 100 ? page + 1 : null,
    truncated: page === 100 && parsed.total_count > 10000,
    attemptVerification: "not-established",
  };
}
export async function listRunArtifacts(
  projectId: string,
  id: string,
  page: number,
) {
  const run = await TestRun.findOne({ _id: id, projectId });
  if (!run) throw new HttpError(404, "NOT_FOUND", "Run not found");
  const project = await Project.findById(projectId);
  if (!project?.installationId || !project.repositoryId)
    throw new HttpError(
      409,
      "GITHUB_CONNECTION_REQUIRED",
      "Reconnect the project",
    );
  const token = await repositoryToken(
    project.userId.toString(),
    project.installationId,
    project.repositoryId,
  );
  return parseArtifacts(
    await githubGet(
      `/repos/${encodeURIComponent(project.owner)}/${encodeURIComponent(project.repo)}/actions/runs/${run.githubRunId}/artifacts?per_page=100&page=${page}`,
      token,
    ),
    page,
  );
}

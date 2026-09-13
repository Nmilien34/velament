import { artifactDownloadUrl } from "./artifact-url.service.js";
import { FeatureAssessment } from "../models/FeatureAssessment.js";
import { accessGeneration } from "./access.service.js";
import { boundedBody, readArtifactReport } from "./artifact-report.service.js";
import { uploadTestReport } from "./assessment.service.js";
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

export async function importArtifactReport(
  projectId: string,
  assessmentId: string,
  runId: string,
  artifactId: number,
) {
  const run = await TestRun.findOne({ _id: runId, projectId });
  const project = await Project.findById(projectId);
  if (!run || !project) throw new HttpError(404, "NOT_FOUND", "Run not found");
  const assessment = await FeatureAssessment.findOne({
    _id: assessmentId,
    projectId,
  });
  if (!assessment)
    throw new HttpError(404, "NOT_FOUND", "Assessment not found");
  if (run.sha !== assessment.sha || run.status !== "completed")
    throw new HttpError(
      422,
      "EVIDENCE_MISMATCH",
      "Select a completed run at the assessment commit before importing",
    );
  if (!project.installationId || !project.repositoryId)
    throw new HttpError(409, "GITHUB_CONNECTION_REQUIRED", "Reconnect project");
  const generation = await accessGeneration(project.userId.toString());
  const token = await repositoryToken(
    project.userId.toString(),
    project.installationId,
    project.repositoryId,
  );
  const endpoint = `/repos/${encodeURIComponent(project.owner)}/${encodeURIComponent(project.repo)}/actions/artifacts/${artifactId}`;
  const metadata = z
    .object({
      id: z.number(),
      expired: z.boolean(),
      size_in_bytes: z.number(),
      workflow_run: z.object({ id: z.number(), head_sha: z.string() }),
    })
    .parse(await githubGet(endpoint, token));
  if (
    metadata.id !== artifactId ||
    metadata.expired ||
    metadata.size_in_bytes > 2_000_000 ||
    metadata.workflow_run.id !== run.githubRunId ||
    metadata.workflow_run.head_sha !== run.sha
  )
    throw new HttpError(
      422,
      "ARTIFACT_MISMATCH",
      "Artifact is expired, oversized, or belongs to a different run",
    );
  const response = await fetch("https://api.github.com" + endpoint + "/zip", {
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "User-Agent": "Velament",
    },
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  if (response.status !== 302)
    throw new HttpError(
      502,
      "ARTIFACT_UNAVAILABLE",
      "GitHub did not provide an artifact download",
    );
  const url = artifactDownloadUrl(response.headers.get("location"));
  const bytes = await boundedBody(
    await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15000) }),
  );
  const report = await readArtifactReport(bytes, runId);
  if (report.attempt !== (run.runAttempt ?? 1))
    throw new HttpError(
      422,
      "EVIDENCE_MISMATCH",
      "Report attempt differs from selected run",
    );
  return uploadTestReport(projectId, assessmentId, report, {
    userId: project.userId.toString(),
    generation,
    artifactId,
  });
}

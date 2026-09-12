import { Project } from "../models/Project.js";
import { Revision } from "../models/Revision.js";
import { Job } from "../models/Job.js";
import { repositoryToken, githubRequest } from "./github-app.service.js";
import { HttpError } from "../utils/errors.js";
import { z } from "zod";
export async function projectStatus(projectId: string) {
  const project = await Project.findOne({ _id: projectId, archivedAt: null });
  if (!project) throw new HttpError(404, "NOT_FOUND", "Project not found");
  const job = await Job.findOne({
    projectId,
    kind: "analysis",
    requestedBranch: project.branch,
  })
    .sort({ createdAt: -1 })
    .select("status requestedBranch resultId errorCode createdAt updatedAt");
  const latestRevision = await Revision.findOne({
    projectId,
    ...(job?.resultId ? { _id: job.resultId } : { branch: project.branch }),
  })
    .sort({ createdAt: -1 })
    .select("sha branch state limitations createdAt");
  return {
    projectId,
    branch: project.branch,
    connection:
      !project.installationId || !project.repositoryId
        ? "not-configured"
        : project.connectionState === "unavailable"
          ? "unavailable"
          : "configured-unverified",
    analysis: job?.status ?? (latestRevision ? "completed" : "not-started"),
    latestJob: job,
    latestRevision,
    remoteFreshness: "not-checked",
  };
}
export async function listBranches(projectId: string, page: number) {
  const p = await Project.findOne({ _id: projectId, archivedAt: null });
  if (
    !p?.installationId ||
    !p.repositoryId ||
    p.connectionState === "unavailable"
  )
    throw new HttpError(
      409,
      "GITHUB_CONNECTION_REQUIRED",
      "Connect this project to GitHub",
    );
  const token = await repositoryToken(
    p.userId.toString(),
    p.installationId,
    p.repositoryId,
  );
  const result = z
    .array(
      z.object({
        name: z.string(),
        protected: z.boolean(),
        commit: z.object({ sha: z.string() }),
      }),
    )
    .parse(
      await githubRequest(
        "/repos/" +
          encodeURIComponent(p.owner) +
          "/" +
          encodeURIComponent(p.repo) +
          "/branches?per_page=100&page=" +
          page,
        token,
      ),
    );
  return {
    branches: result.map((b) => ({
      name: b.name,
      protected: b.protected,
      sha: b.commit.sha,
    })),
    page,
    mayHaveMore: result.length === 100,
  };
}

export async function refreshProjectConnection(projectId: string) {
  const p = await Project.findOne({ _id: projectId, archivedAt: null });
  if (!p) throw new HttpError(404, "NOT_FOUND", "Project not found");
  if (!p.installationId || !p.repositoryId)
    throw new HttpError(
      409,
      "GITHUB_CONNECTION_REQUIRED",
      "Connect this project",
    );
  const token = await repositoryToken(
    p.userId.toString(),
    p.installationId,
    p.repositoryId,
  );
  const remote = z
    .object({ id: z.number() })
    .parse(
      await githubRequest(
        "/repos/" +
          encodeURIComponent(p.owner) +
          "/" +
          encodeURIComponent(p.repo),
        token,
      ),
    );
  if (remote.id !== p.repositoryId)
    throw new HttpError(
      409,
      "REPOSITORY_IDENTITY_CHANGED",
      "Reconnect the project",
    );
  const result = await Project.updateOne(
    {
      _id: projectId,
      archivedAt: null,
      installationId: p.installationId,
      repositoryId: p.repositoryId,
      updatedAt: p.updatedAt,
    },
    { $set: { connectionState: "active" } },
  );
  if (!result.matchedCount)
    throw new HttpError(409, "PROJECT_CHANGED", "Refresh and retry");
  return {
    projectId,
    connection: "verified" as const,
    verifiedAt: new Date().toISOString(),
  };
}

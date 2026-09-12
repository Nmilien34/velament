import { z } from "zod";
import { Project } from "../models/Project.js";
import {
  githubRequest,
  repositoryToken,
  userToken,
} from "./github-app.service.js";
import { HttpError } from "../utils/errors.js";
export async function workflowAccess(projectId: string, write = false) {
  const p = await Project.findOne({ _id: projectId, archivedAt: null });
  if (
    !p?.installationId ||
    !p.repositoryId ||
    p.connectionState === "unavailable"
  )
    throw new HttpError(409, "GITHUB_CONNECTION_REQUIRED", "Reconnect GitHub");
  const base =
    "/repos/" + encodeURIComponent(p.owner) + "/" + encodeURIComponent(p.repo);
  if (write) {
    const permission = z
      .object({ permissions: z.object({ push: z.boolean() }) })
      .parse(await githubRequest(base, await userToken(p.userId.toString())));
    if (!permission.permissions.push)
      throw new HttpError(
        403,
        "EXECUTION_FORBIDDEN",
        "Write access is required",
      );
  }
  const token = await repositoryToken(
    p.userId.toString(),
    p.installationId,
    p.repositoryId,
    write ? "write" : "read",
  );
  return { base, token };
}
export async function workflows(projectId: string, page: number) {
  const { base, token } = await workflowAccess(projectId);
  return githubRequest(
    base + "/actions/workflows?per_page=50&page=" + page,
    token,
  );
}
export async function workflowJobs(
  projectId: string,
  runId: number,
  page: number,
) {
  const { base, token } = await workflowAccess(projectId);
  return githubRequest(
    base +
      "/actions/runs/" +
      runId +
      "/jobs?filter=latest&per_page=50&page=" +
      page,
    token,
  );
}
export async function cancelWorkflow(projectId: string, runId: number) {
  const { base, token } = await workflowAccess(projectId, true);
  const run = z
    .object({ status: z.string() })
    .parse(await githubRequest(base + "/actions/runs/" + runId, token));
  if (run.status === "completed")
    throw new HttpError(409, "RUN_FINISHED", "This run has already finished");
  await githubRequest(base + "/actions/runs/" + runId + "/cancel", token, {});
  return { status: "cancellation_requested" as const };
}

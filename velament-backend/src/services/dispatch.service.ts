import { importRun } from "./run.service.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import { Dispatch } from "../models/Dispatch.js";
import { workflowAccess } from "./workflow.service.js";
import { githubRequest } from "./github-app.service.js";
import { HttpError } from "../utils/errors.js";
export const dispatchInput = z
  .object({
    workflowId: z
      .string()
      .regex(/^[a-zA-Z0-9_.-]+$/)
      .max(200),
    ref: z.string().min(1).max(200),
    sha: z.string().regex(/^[a-f0-9]{40}$/),
    inputs: z
      .record(
        z.string(),
        z.union([z.string().max(2000), z.boolean(), z.number()]),
      )
      .default({}),
  })
  .strict();
export async function dispatch(projectId: string, key: string, body: unknown) {
  const input = dispatchInput.parse(body);
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify({
        ...input,
        inputs: Object.fromEntries(Object.entries(input.inputs).sort()),
      }),
    )
    .digest("hex");
  const existing = await Dispatch.findOne({ projectId, key });
  if (existing) {
    if (
      existing.requestHash !== requestHash ||
      existing.workflowId !== input.workflowId ||
      existing.ref !== input.ref ||
      existing.sha !== input.sha
    )
      throw new HttpError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "Key was used for a different request",
      );
    return existing;
  }
  const { base, token } = await workflowAccess(projectId, true);
  const head = z
    .object({ sha: z.string() })
    .parse(
      await githubRequest(
        base + "/commits/" + encodeURIComponent(input.ref),
        token,
      ),
    );
  if (head.sha !== input.sha)
    throw new HttpError(
      409,
      "REVISION_MOVED",
      "Branch changed. Review the current revision before running",
    );
  const record = await Dispatch.create({
    projectId,
    key,
    requestHash,
    workflowId: input.workflowId,
    ref: input.ref,
    sha: input.sha,
  });
  try {
    const result = z
      .object({ workflow_run_id: z.number().optional() })
      .parse(
        await githubRequest(
          base +
            "/actions/workflows/" +
            encodeURIComponent(input.workflowId) +
            "/dispatches",
          token,
          { ref: input.ref, inputs: input.inputs },
        ),
      );
    record.status = "accepted";
    if (result.workflow_run_id) record.githubRunId = result.workflow_run_id;
    await record.save();
  } catch {
    record.status = "unknown";
    record.errorCode = "DISPATCH_UNCERTAIN";
    await record.save();
  }
  return record;
}

export async function refreshDispatch(projectId: string, dispatchId: string) {
  const record = await Dispatch.findOne({ _id: dispatchId, projectId });
  if (!record) throw new HttpError(404, "NOT_FOUND", "Dispatch not found");
  if (!record.githubRunId)
    return {
      dispatch: record,
      run: null,
      revisionMatches: null,
      recovery: "unconfirmed" as const,
    };
  const run = await importRun(projectId, record.githubRunId);
  return {
    dispatch: record,
    run,
    revisionMatches: run?.sha === record.sha,
    recovery: "provider-run-id" as const,
  };
}

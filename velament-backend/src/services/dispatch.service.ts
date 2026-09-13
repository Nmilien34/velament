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
  let record;
  try {
    record = await Dispatch.create({
      projectId,
      key,
      requestHash,
      workflowId: input.workflowId,
      ref: input.ref,
      sha: input.sha,
    });
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    const winner = await Dispatch.findOne({ projectId, key });
    if (!winner || winner.requestHash !== requestHash)
      throw new HttpError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "Key was used for a different request",
      );
    return winner;
  }

  try {
    const result = z
      .object({ workflow_run_id: z.number().int().positive() })
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
  } catch (error) {
    const status = (error as { providerStatus?: number }).providerStatus;
    const rejected =
      status !== undefined && [400, 401, 403, 404, 422, 429].includes(status);
    record.status = rejected ? "rejected" : "unknown";
    record.errorCode = rejected ? "DISPATCH_REJECTED" : "DISPATCH_UNCERTAIN";
    await record.save();
  }
  return record;
}

export async function refreshDispatch(projectId: string, dispatchId: string) {
  await Dispatch.updateOne(
    {
      _id: dispatchId,
      projectId,
      status: "pending",
      createdAt: { $lte: new Date(Date.now() - 120000) },
    },
    { $set: { status: "unknown", errorCode: "DISPATCH_UNCERTAIN" } },
  );
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
    verification:
      run?.sha === record.sha ? "revision-matched" : "revision-mismatch",
    eligibleAsApprovedRevisionEvidence: run?.sha === record.sha,
    recovery:
      record.resolution === "user-associated"
        ? ("user-associated" as const)
        : ("provider-run-id" as const),
  };
}

export async function reconcileDispatch(
  projectId: string,
  id: string,
  runId: number,
) {
  const record = await Dispatch.findOne({
    _id: id,
    projectId,
    status: { $in: ["pending", "unknown"] },
  });
  if (!record)
    throw new HttpError(
      409,
      "DISPATCH_NOT_UNCERTAIN",
      "Refresh dispatch before reconciling",
    );
  const { base, token } = await workflowAccess(projectId);
  const workflow = z
    .object({ id: z.number() })
    .parse(
      await githubRequest(
        base + "/actions/workflows/" + encodeURIComponent(record.workflowId),
        token,
      ),
    );
  const run = z
    .object({
      id: z.number(),
      workflow_id: z.number(),
      event: z.string(),
      head_sha: z.string(),
      created_at: z.string(),
    })
    .parse(await githubRequest(base + "/actions/runs/" + runId, token));
  if (
    run.id !== runId ||
    run.workflow_id !== workflow.id ||
    run.event !== "workflow_dispatch" ||
    !Number.isFinite(Date.parse(run.created_at)) ||
    Date.parse(run.created_at) < record.createdAt.getTime() - 60000
  )
    throw new HttpError(
      422,
      "RUN_MISMATCH",
      "Run does not match this workflow submission",
    );
  await Dispatch.updateOne(
    { _id: id, projectId, status: { $in: ["pending", "unknown"] } },
    {
      $set: {
        githubRunId: runId,
        status: "accepted",
        resolution: "user-associated",
        resolvedAt: new Date(),
      },
      $unset: { errorCode: 1 },
    },
  );
  return refreshDispatch(projectId, id);
}
export async function dismissDispatch(projectId: string, id: string) {
  const record = await Dispatch.findOneAndUpdate(
    { _id: id, projectId, status: "unknown" },
    { $set: { resolution: "user-dismissed", resolvedAt: new Date() } },
    { new: true },
  );
  if (!record)
    throw new HttpError(
      409,
      "DISPATCH_NOT_UNCERTAIN",
      "Only uncertain submissions can be acknowledged",
    );
  return {
    dispatch: record,
    warning:
      "Acknowledged only. This does not prove no workflow ran; inspect GitHub before submitting another run.",
  };
}

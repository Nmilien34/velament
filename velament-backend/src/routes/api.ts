import { requestDeletion } from "../services/deletion.service.js";
import { rateLimit } from "../middleware/rate-limit.js";
import {
  projectStatus,
  refreshProjectConnection,
  listBranches,
} from "../services/project-status.service.js";
import { retryAnalysis } from "../services/job.service.js";
import {
  createInvestigation,
  recheckInvestigation,
  investigationGraph,
} from "../services/investigation.service.js";
import { featureEvidence } from "./feature-evidence.js";
import {
  workflows,
  workflowJobs,
  cancelWorkflow,
} from "../services/workflow.service.js";
import {
  dispatch,
  refreshDispatch,
  reconcileDispatch,
  dismissDispatch,
} from "../services/dispatch.service.js";
import { Dispatch } from "../models/Dispatch.js";
import { Job } from "../models/Job.js";
import { Activity } from "../models/Activity.js";
import { TestRun } from "../models/TestRun.js";
import { Project } from "../models/Project.js";
import { importRun } from "../services/run.service.js";
import { Router } from "express";
import { z } from "zod";
import { objectId, featureInput, pinInput } from "@velament/shared";
import { authenticate } from "../middleware/auth.js";
import {
  listProjects,
  createProject,
  projectAccess,
  analyzeProject,
  listRevisions,
} from "../controllers/project.controller.js";
import { Feature } from "../models/Feature.js";
import { Pin } from "../models/Pin.js";
import { Investigation } from "../models/Investigation.js";
import { revision } from "../services/project.service.js";
import { HttpError } from "../utils/errors.js";
const listPage = (value: unknown) =>
  z.coerce.number().int().min(1).max(10000).default(1).parse(value);
export const api = Router();
api.use(authenticate);
api.use(rateLimit("api-read-write", 120, 60000));
api.use((req, res, next) => {
  if (
    ["GET", "HEAD", "OPTIONS"].includes(req.method) ||
    /\/(cancel|refresh)$/.test(req.path)
  )
    return next();
  return rateLimit("api-mutations", 60, 3600000)(req, res, next);
});

api.get("/projects", listProjects);
api.post("/projects", createProject);
api.post("/projects/:projectId/restore", async (req, res) => {
  const project = await Project.findOneAndUpdate(
    {
      _id: objectId.parse(req.params.projectId),
      userId: res.locals.userId,
      deletingAt: null,
    },
    { $unset: { archivedAt: 1 } },
    { new: true },
  );
  if (!project) throw new HttpError(404, "NOT_FOUND", "Project not found");
  res.json({ data: project });
});
api.delete("/projects/:projectId/permanent", async (req, res) => {
  z.object({ confirm: z.literal("DELETE PROJECT") })
    .strict()
    .parse(req.body);
  const deletion = await requestDeletion(
    res.locals.userId,
    objectId.parse(req.params.projectId),
  );
  res.status(202).json({
    data: {
      id: deletion!.id,
      status: "deletion-pending",
      dueAt: deletion!.dueAt,
    },
  });
});
api.use("/projects/:projectId", projectAccess);
api.get("/projects/:projectId/status", async (_req, res) => {
  res.json({ data: await projectStatus(res.locals.projectId) });
});
api.get("/projects/:projectId/branches", async (req, res) => {
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(10000)
    .default(1)
    .parse(req.query.page);
  res.json({ data: await listBranches(res.locals.projectId, page) });
});
api.post("/projects/:projectId/analysis", analyzeProject);
api.get("/projects/:projectId/revisions", listRevisions);
api.get(
  "/projects/:projectId/revisions/:revisionId/graph",
  async (req, res) => {
    const r = await revision(
      res.locals.projectId,
      objectId.parse(req.params.revisionId),
    );
    res.json({
      data: {
        revisionId: r.id,
        sha: r.sha,
        state: r.state,
        limitations: r.limitations,
        nodes: r.files.map((f) => ({
          path: f.path,
          hash: f.hash,
          kind: "source",
        })),
        edges: r.edges,
      },
    });
  },
);
api.get(
  "/projects/:projectId/revisions/:revisionId/source",
  async (req, res) => {
    const r = await revision(
      res.locals.projectId,
      objectId.parse(req.params.revisionId),
    );
    const path = z.string().parse(req.query.path),
      file = r.files.find((f) => f.path === path);
    if (!file)
      throw new HttpError(
        404,
        "NOT_FOUND",
        "File unavailable at this revision",
      );
    res.json({ data: file });
  },
);
api.get("/projects/:projectId/features", async (req, res) =>
  res.json({
    data: await Feature.find({
      projectId: res.locals.projectId,
      archivedAt:
        z
          .enum(["active", "archived"])
          .default("active")
          .parse(req.query.status) === "archived"
          ? { $type: "date" }
          : null,
    })
      .sort({ _id: -1 })
      .skip((listPage(req.query.page) - 1) * 100)
      .limit(100),
    page: listPage(req.query.page),
    pageSize: 100,
  }),
);
async function validatedFeature(projectId: string, body: unknown) {
  const input = featureInput.parse(body),
    r = await revision(projectId, input.revisionId);
  if (input.paths.some((p) => !r.files.some((f) => f.path === p)))
    throw new HttpError(
      422,
      "INVALID_SCOPE",
      "Scope includes files unavailable in this revision",
    );
  return input;
}
api.post("/projects/:projectId/features", async (req, res) =>
  res.status(201).json({
    data: await Feature.create({
      projectId: res.locals.projectId,
      ...(await validatedFeature(res.locals.projectId, req.body)),
    }),
  }),
);
api.put("/projects/:projectId/features/:id", async (req, res) => {
  const input = await validatedFeature(res.locals.projectId, req.body);
  const version = z.coerce.number().int().min(1).parse(req.get("If-Match"));
  const f = await Feature.findOneAndUpdate(
    {
      _id: objectId.parse(req.params.id),
      projectId: res.locals.projectId,
      version,
      archivedAt: null,
    },
    { $set: input, $inc: { version: 1 } },
    { new: true, runValidators: true },
  );
  if (!f)
    throw new HttpError(
      409,
      "STALE_FEATURE",
      "Feature changed or is unavailable. Reload before saving",
    );
  res.json({ data: f });
});
api.put("/projects/:projectId/features/:id/pin", async (req, res) => {
  const input = pinInput.parse(req.body);
  const f = await Feature.findOne({
    _id: objectId.parse(req.params.id),
    projectId: res.locals.projectId,
    archivedAt: null,
  });
  if (!f) throw new HttpError(404, "NOT_FOUND", "Feature not found");
  const r = await revision(res.locals.projectId, input.revisionId);
  if (
    !f.paths.length ||
    f.paths.some((p) => !r.files.some((n) => n.path === p))
  )
    throw new HttpError(
      422,
      "INVALID_SCOPE",
      "Pin requires available mapped files",
    );
  const hashes = r.files
    .filter((n) => f.paths.includes(n.path))
    .map((n) => ({ path: n.path, hash: n.hash }));
  const edgeKeys = r.edges
    .filter((e) => f.paths.includes(e.from) || f.paths.includes(e.to))
    .map((e) => e.from + " → " + e.to)
    .sort();
  res.json({
    data: await Pin.findOneAndUpdate(
      { featureId: f.id },
      {
        $set: {
          projectId: res.locals.projectId,
          featureId: f.id,
          ...input,
          featureVersion: f.version,
          paths: f.paths,
          hashes,
          edgeKeys,
        },
      },
      { upsert: true, new: true, runValidators: true },
    ),
  });
});
api.get("/projects/:projectId/pins", async (req, res) =>
  res.json({
    data: await Pin.find({
      projectId: res.locals.projectId,
      featureId: {
        $in: await Feature.find({
          projectId: res.locals.projectId,
          archivedAt: null,
        }).distinct("_id"),
      },
    })
      .sort({ _id: -1 })
      .skip((listPage(req.query.page) - 1) * 100)
      .limit(100),
    page: listPage(req.query.page),
    pageSize: 100,
  }),
);
api.delete("/projects/:projectId/features/:id/pin", async (req, res) => {
  await Pin.deleteOne({
    projectId: res.locals.projectId,
    featureId: objectId.parse(req.params.id),
  });
  res.sendStatus(204);
});
api.get("/projects/:projectId/features/:id/pin/compare", async (req, res) => {
  const pin = await Pin.findOne({
    projectId: res.locals.projectId,
    featureId: objectId.parse(req.params.id),
  });
  if (!pin) throw new HttpError(404, "NOT_FOUND", "Pin not found");
  const current = await revision(
    res.locals.projectId,
    objectId.parse(req.query.revisionId),
  );
  const feature = await Feature.findById(pin.featureId);
  const changed = pin.paths.filter(
    (p) =>
      current.files.find((f) => f.path === p)?.hash !==
      pin.hashes.find((h) => h.path === p)?.hash,
  );
  const now = current.edges
    .filter((e) => pin.paths.includes(e.from) || pin.paths.includes(e.to))
    .map((e) => e.from + " → " + e.to)
    .sort();
  const scopeChanged = feature?.version !== pin.featureVersion;
  res.json({
    data: {
      baselineRevision: pin.revisionId,
      currentRevision: current.id,
      changed,
      scopeChanged,
      addedEdges: now.filter((e) => !pin.edgeKeys.includes(e)),
      removedEdges: pin.edgeKeys.filter((e) => !now.includes(e)),
      implementation: feature?.kind,
      verification: "unknown",
      limitations: current.limitations,
    },
  });
});
api.post("/projects/:projectId/investigations", async (req, res) => {
  res
    .status(201)
    .json({ data: await createInvestigation(res.locals.projectId, req.body) });
});
api.post(
  "/projects/:projectId/investigations/:id/recheck",
  async (req, res) => {
    res.status(201).json({
      data: await recheckInvestigation(
        res.locals.projectId,
        objectId.parse(req.params.id),
        req.body,
      ),
    });
  },
);
api.get("/projects/:projectId/investigations/:id/graph", async (req, res) => {
  res.json({
    data: await investigationGraph(
      res.locals.projectId,
      objectId.parse(req.params.id),
    ),
  });
});
api.get("/projects/:projectId/investigations", async (req, res) =>
  res.json({
    data: await Investigation.find({ projectId: res.locals.projectId })
      .select("-text -prompt")
      .sort({ _id: -1 })
      .skip((listPage(req.query.page) - 1) * 100)
      .limit(100),
    page: listPage(req.query.page),
    pageSize: 100,
  }),
);
api.get("/projects/:projectId/investigations/:id", async (req, res) => {
  const i = await Investigation.findOne({
    _id: objectId.parse(req.params.id),
    projectId: res.locals.projectId,
  });
  if (!i) throw new HttpError(404, "NOT_FOUND", "Investigation not found");
  res.json({ data: i });
});
api.post("/projects/:projectId/runs", async (req, res) => {
  const key = z.string().min(8).max(100).parse(req.get("Idempotency-Key"));
  res
    .status(202)
    .json({ data: await dispatch(res.locals.projectId, key, req.body) });
});

api.patch("/projects/:projectId", async (req, res) => {
  const input = z
    .object({
      branch: z.string().trim().min(1).max(200).optional(),
      analyzeOnPush: z.boolean().optional(),
    })
    .strict()
    .refine(
      (input) =>
        input.branch !== undefined || input.analyzeOnPush !== undefined,
      "Provide a setting to update",
    )
    .parse(req.body);
  const p = await Project.findOneAndUpdate(
    {
      _id: res.locals.projectId,
      $or: [
        { analysisLockedUntil: { $exists: false } },
        { analysisLockedUntil: { $lte: new Date() } },
      ],
    },
    { $set: input },
    { new: true },
  );
  if (!p)
    throw new HttpError(
      409,
      "ANALYSIS_BUSY",
      "Wait for current analysis before switching branch",
    );
  res.json({ data: p });
});
api.post("/projects/:projectId/runs/import", async (req, res) => {
  const input = z
    .object({ githubRunId: z.number().int().positive() })
    .strict()
    .parse(req.body);
  res.json({ data: await importRun(res.locals.projectId, input.githubRunId) });
});
api.get("/projects/:projectId/runs", async (req, res) =>
  res.json({
    data: await TestRun.find({ projectId: res.locals.projectId })
      .sort({ githubRunId: -1 })
      .skip((listPage(req.query.page) - 1) * 100)
      .limit(100),
    page: listPage(req.query.page),
    pageSize: 100,
  }),
);
api.put(
  "/projects/:projectId/investigations/:id/verification",
  async (req, res) => {
    const input = z.object({ runId: objectId }).strict().parse(req.body);
    const i = await Investigation.findOne({
      _id: objectId.parse(req.params.id),
      projectId: res.locals.projectId,
    });
    if (!i) throw new HttpError(404, "NOT_FOUND", "Investigation not found");
    const run = await TestRun.findOne({
      _id: input.runId,
      projectId: res.locals.projectId,
    });
    const rev = await revision(res.locals.projectId, i.revisionId.toString());
    if (!run || run.sha !== rev.sha)
      throw new HttpError(
        422,
        "EVIDENCE_MISMATCH",
        "Run must belong to this project and exact revision",
      );
    i.set("testRunId", run.id);
    await i.save();
    res.json({
      data: i,
      coverage: "user-associated",
      resolution: "unverified",
    });
  },
);
api.delete(
  "/projects/:projectId/investigations/:id/verification",
  async (req, res) => {
    const i = await Investigation.findOneAndUpdate(
      { _id: objectId.parse(req.params.id), projectId: res.locals.projectId },
      { $unset: { testRunId: 1 } },
      { new: true },
    );
    if (!i) throw new HttpError(404, "NOT_FOUND", "Investigation not found");
    res.json({ data: i });
  },
);
api.patch("/projects/:projectId/investigations/:id", async (req, res) => {
  const input = z
    .object({
      prompt: z.string().max(40000).optional(),
      status: z.enum(["open", "closed"]).optional(),
    })
    .strict()
    .parse(req.body);
  const i = await Investigation.findOneAndUpdate(
    { _id: objectId.parse(req.params.id), projectId: res.locals.projectId },
    { $set: input },
    { new: true, runValidators: true },
  );
  if (!i) throw new HttpError(404, "NOT_FOUND", "Investigation not found");
  res.json({ data: i });
});

api.get("/projects/:projectId/jobs", async (req, res) =>
  res.json({
    data: await Job.find({ projectId: res.locals.projectId })
      .select("-payload -leaseToken")
      .sort({ createdAt: -1 })
      .skip((listPage(req.query.page) - 1) * 100)
      .limit(100),
    page: listPage(req.query.page),
    pageSize: 100,
  }),
);
api.post("/projects/:projectId/jobs/:id/cancel", async (req, res) => {
  const job = await Job.findOneAndUpdate(
    {
      _id: objectId.parse(req.params.id),
      projectId: res.locals.projectId,
      status: { $in: ["queued", "running"] },
    },
    [
      {
        $set: {
          cancelRequested: true,
          status: {
            $cond: [{ $eq: ["$status", "queued"] }, "cancelled", "$status"],
          },
        },
      },
    ],
    { new: true },
  );
  if (!job)
    throw new HttpError(
      409,
      "JOB_NOT_ACTIVE",
      "Job is already finished or unavailable",
    );
  res.json({ data: { id: job.id, status: "cancellation_requested" } });
});
api.get("/projects/:projectId/activity", async (req, res) =>
  res.json({
    data: await Activity.find({ projectId: res.locals.projectId })
      .sort({ createdAt: -1 })
      .skip((listPage(req.query.page) - 1) * 100)
      .limit(100),
    page: listPage(req.query.page),
    pageSize: 100,
  }),
);
api.post("/projects/:projectId/activity/:id/read", async (req, res) => {
  await Activity.updateOne(
    { _id: objectId.parse(req.params.id), projectId: res.locals.projectId },
    { $set: { readAt: new Date() } },
  );
  res.sendStatus(204);
});
api.delete("/projects/:projectId", async (_req, res) => {
  await Project.updateOne(
    { _id: res.locals.projectId },
    { $set: { archivedAt: new Date() } },
  );
  await Job.updateMany(
    { projectId: res.locals.projectId, status: { $in: ["queued", "running"] } },
    { $set: { cancelRequested: true } },
  );
  res.sendStatus(204);
});

api.get("/projects/:projectId/dispatches", async (req, res) =>
  res.json({
    data: await Dispatch.find({ projectId: res.locals.projectId })
      .sort({ createdAt: -1 })
      .skip((listPage(req.query.page) - 1) * 100)
      .limit(100),
    page: listPage(req.query.page),
    pageSize: 100,
  }),
);
api.delete("/projects/:projectId/features/:id", async (req, res) => {
  const f = await Feature.findOneAndUpdate(
    { _id: objectId.parse(req.params.id), projectId: res.locals.projectId },
    { $set: { archivedAt: new Date() } },
    { new: true },
  );
  if (!f) throw new HttpError(404, "NOT_FOUND", "Feature not found");
  res.sendStatus(204);
});
api.post("/projects/:projectId/features/:id/restore", async (req, res) => {
  const f = await Feature.findOneAndUpdate(
    { _id: objectId.parse(req.params.id), projectId: res.locals.projectId },
    { $unset: { archivedAt: 1 } },
    { new: true },
  );
  if (!f) throw new HttpError(404, "NOT_FOUND", "Feature not found");
  res.json({ data: f });
});
api.get(
  "/projects/:projectId/revisions/:revisionId/search",
  async (req, res) => {
    const r = await revision(
      res.locals.projectId,
      objectId.parse(req.params.revisionId),
    );
    const q = z
      .string()
      .trim()
      .min(2)
      .max(200)
      .parse(req.query.q)
      .toLowerCase();
    res.json({
      data: r.files
        .filter(
          (f) =>
            f.path.toLowerCase().includes(q) ||
            f.content.toLowerCase().includes(q),
        )
        .slice(0, 50)
        .map((f) => ({
          path: f.path,
          line:
            f.content
              .split("\n")
              .findIndex((line) => line.toLowerCase().includes(q)) + 1 || null,
        })),
    });
  },
);

api.get("/projects/:projectId/workflows", async (req, res) => {
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(1)
    .parse(req.query.page);
  res.json({ data: await workflows(res.locals.projectId, page) });
});
api.get("/projects/:projectId/runs/:id/jobs", async (req, res) => {
  const run = await TestRun.findOne({
    _id: objectId.parse(req.params.id),
    projectId: res.locals.projectId,
  });
  if (!run) throw new HttpError(404, "NOT_FOUND", "Run not found");
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(1)
    .parse(req.query.page);
  res.json({
    data: await workflowJobs(res.locals.projectId, run.githubRunId, page),
    mapping: "workflow-steps-only",
  });
});
api.post("/projects/:projectId/runs/:id/refresh", async (req, res) => {
  const run = await TestRun.findOne({
    _id: objectId.parse(req.params.id),
    projectId: res.locals.projectId,
  });
  if (!run) throw new HttpError(404, "NOT_FOUND", "Run not found");
  res.json({ data: await importRun(res.locals.projectId, run.githubRunId) });
});
api.post("/projects/:projectId/runs/:id/cancel", async (req, res) => {
  const run = await TestRun.findOne({
    _id: objectId.parse(req.params.id),
    projectId: res.locals.projectId,
  });
  if (!run) throw new HttpError(404, "NOT_FOUND", "Run not found");
  res.status(202).json({
    data: await cancelWorkflow(res.locals.projectId, run.githubRunId),
  });
});

api.post("/projects/:projectId/dispatches/:id/refresh", async (req, res) => {
  res.json({
    data: await refreshDispatch(
      res.locals.projectId,
      objectId.parse(req.params.id),
    ),
  });
});

api.use(featureEvidence);

api.post("/projects/:projectId/jobs/:id/retry", async (req, res) => {
  const job = await retryAnalysis(
    res.locals.projectId,
    objectId.parse(req.params.id),
  );
  res.status(202).json({
    data: {
      id: job.id,
      status: job.status,
      requestedBranch: job.requestedBranch,
    },
  });
});

api.post("/projects/:projectId/connection/refresh", async (req, res) => {
  res.json({ data: await refreshProjectConnection(res.locals.projectId) });
});

api.post("/projects/:projectId/dispatches/:id/reconcile", async (req, res) => {
  const input = z
    .object({ githubRunId: z.number().int().positive() })
    .strict()
    .parse(req.body);
  res.json({
    data: await reconcileDispatch(
      res.locals.projectId,
      objectId.parse(req.params.id),
      input.githubRunId,
    ),
  });
});
api.post(
  "/projects/:projectId/dispatches/:id/acknowledge",
  async (req, res) => {
    z.object({ acknowledgeUncertainty: z.literal(true) })
      .strict()
      .parse(req.body);
    res.json({
      data: await dismissDispatch(
        res.locals.projectId,
        objectId.parse(req.params.id),
      ),
    });
  },
);

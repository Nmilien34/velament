import { batchSource } from "../services/discovery-source.js";
import {
  planRepositoryDiscovery,
  repositoryDiscoveryProgress,
} from "../services/repository-discovery.service.js";
import mongoose from "mongoose";
import { Project } from "../models/Project.js";
import { accessGeneration, assertAccess } from "../services/access.service.js";
import { Investigation } from "../models/Investigation.js";
import { inspectReality } from "../services/reality.service.js";
import { RealityReview } from "../models/RealityReview.js";
import { Feature } from "../models/Feature.js";
import { diagnoseWithAI } from "../services/ai-diagnosis.service.js";
import {
  getDiscovery,
  claimDiscoveryRetry,
} from "../services/ai-recovery.service.js";
import { createHash } from "node:crypto";
import { AiDiscovery } from "../models/AiDiscovery.js";
import {
  prepareSource,
  discoverWithAI,
} from "../services/ai-discovery.service.js";
import { consumeBudget } from "../services/rate-limit.service.js";
import { Router } from "express";
import { z } from "zod";
import { objectId } from "@velament/shared";
import { FeatureAssessment } from "../models/FeatureAssessment.js";
import { revision } from "../services/project.service.js";
import { discoverCandidates } from "../services/feature-evidence.service.js";
import {
  uploadTestReport,
  createAssessment,
  getAssessment,
  associateAssessmentRun,
} from "../services/assessment.service.js";
import { HttpError } from "../utils/errors.js";
export const featureEvidence = Router();
featureEvidence.get(
  "/projects/:projectId/revisions/:revisionId/reality",
  async (req, res) => {
    const snapshot = await revision(
      res.locals.projectId,
      objectId.parse(req.params.revisionId),
    );
    const featureId =
      req.query.featureId === undefined
        ? undefined
        : objectId.parse(req.query.featureId);
    const feature = featureId
      ? await Feature.findOne({
          _id: featureId,
          projectId: res.locals.projectId,
          archivedAt: null,
        })
      : null;
    if (featureId && !feature)
      throw new HttpError(404, "NOT_FOUND", "Active feature not found");
    const result = inspectReality(
      feature
        ? snapshot.files.filter((f) => feature.paths.includes(f.path))
        : snapshot.files,
    );
    if (feature)
      result.limitations.push(
        "Scope uses the feature's current mapped paths; unavailable paths and unmapped behavior remain unknown.",
      );
    const reviews = await RealityReview.find({
      projectId: res.locals.projectId,
      revisionId: snapshot.id,
      findingId: { $in: result.findings.map((f) => f.id) },
    }).select("findingId reason updatedAt");
    res.json({
      data: {
        ...result,
        reviews,
        revisionId: snapshot.id,
        sha: snapshot.sha,
        limitations: [...snapshot.limitations, ...result.limitations],
      },
    });
  },
);
featureEvidence.put(
  "/projects/:projectId/revisions/:revisionId/reality/:findingId/review",
  async (req, res) => {
    const { reason } = z
      .object({ reason: z.string().trim().min(1).max(2000) })
      .strict()
      .parse(req.body);
    const snapshot = await revision(
      res.locals.projectId,
      objectId.parse(req.params.revisionId),
    );
    const findingId = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(req.params.findingId);
    if (
      !snapshot.files.some((file) =>
        inspectReality([file]).findings.some((f) => f.id === findingId),
      )
    )
      throw new HttpError(
        404,
        "NOT_FOUND",
        "Finding not present in this revision",
      );
    const review = await RealityReview.findOneAndUpdate(
      { projectId: res.locals.projectId, revisionId: snapshot.id, findingId },
      { $set: { reason } },
      { upsert: true, new: true, runValidators: true },
    );
    res.json({ data: review });
  },
);
featureEvidence.delete(
  "/projects/:projectId/revisions/:revisionId/reality/:findingId/review",
  async (req, res) => {
    const snapshot = await revision(
      res.locals.projectId,
      objectId.parse(req.params.revisionId),
    );
    await RealityReview.deleteOne({
      projectId: res.locals.projectId,
      revisionId: snapshot.id,
      findingId: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(req.params.findingId),
    });
    res.sendStatus(204);
  },
);
featureEvidence.get(
  "/projects/:projectId/revisions/:revisionId/feature-candidates",
  async (req, res) => {
    const snapshot = await revision(
      res.locals.projectId,
      objectId.parse(req.params.revisionId),
    );
    res.json({
      data: {
        revisionId: snapshot.id,
        sha: snapshot.sha,
        candidates: discoverCandidates(snapshot.files),
        limitations: [
          ...snapshot.limitations,
          "Exported symbols are candidates to investigate, not confirmed product features. Maximum 200 candidates; only named exported functions/classes are discovered.",
        ],
      },
    });
  },
);
featureEvidence.post(
  "/projects/:projectId/features/:id/assessments",
  async (req, res) => {
    const input = z
      .object({
        revisionId: objectId,
        featureVersion: z.number().int().positive(),
      })
      .strict()
      .parse(req.body);
    res.status(201).json({
      data: await createAssessment(
        res.locals.projectId,
        objectId.parse(req.params.id),
        input.revisionId,
        input.featureVersion,
      ),
    });
  },
);
featureEvidence.get(
  "/projects/:projectId/features/:id/assessments",
  async (req, res) => {
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .default(1)
      .parse(req.query.page);
    res.json({
      data: await FeatureAssessment.find({
        projectId: res.locals.projectId,
        featureId: objectId.parse(req.params.id),
      })
        .sort({ _id: -1 })
        .skip((page - 1) * 25)
        .limit(25),
      page,
    });
  },
);
featureEvidence.get(
  "/projects/:projectId/assessments/:id",
  async (req, res) => {
    res.json({
      data: await getAssessment(
        res.locals.projectId,
        objectId.parse(req.params.id),
      ),
    });
  },
);
featureEvidence.put(
  "/projects/:projectId/assessments/:id/test-report",
  async (req, res) => {
    res.json({
      data: await uploadTestReport(
        res.locals.projectId,
        objectId.parse(req.params.id),
        req.body,
      ),
    });
  },
);
featureEvidence.put(
  "/projects/:projectId/assessments/:id/verification",
  async (req, res) => {
    const input = z.object({ runId: objectId }).strict().parse(req.body);
    res.json({
      data: await associateAssessmentRun(
        res.locals.projectId,
        objectId.parse(req.params.id),
        input.runId,
      ),
    });
  },
);
featureEvidence.delete(
  "/projects/:projectId/assessments/:id/verification",
  async (req, res) => {
    const result = await FeatureAssessment.updateOne(
      { _id: objectId.parse(req.params.id), projectId: res.locals.projectId },
      { $unset: { testRunId: 1 } },
    );
    if (!result.matchedCount)
      throw new HttpError(404, "NOT_FOUND", "Assessment not found");
    res.sendStatus(204);
  },
);

featureEvidence.get(
  "/projects/:projectId/revisions/:revisionId/repository-discovery",
  async (req, res) => {
    const snapshot = await revision(
      res.locals.projectId,
      objectId.parse(req.params.revisionId),
    );
    res.json({
      data: {
        ...(await repositoryDiscoveryProgress(
          res.locals.projectId,
          snapshot.id,
          snapshot.files,
        )),
        sha: snapshot.sha,
        snapshotLimitations: snapshot.limitations,
      },
    });
  },
);

// Explicit request only: selected revision source is sent to OpenAI.
featureEvidence.post(
  [
    "/projects/:projectId/revisions/:revisionId/ai-discovery",
    "/projects/:projectId/revisions/:revisionId/repository-discovery",
    "/projects/:projectId/revisions/:revisionId/investigations/:investigationId/ai-diagnosis",
  ],
  async (req, res) => {
    const input = z
      .object({
        paths: z.array(z.string().min(1)).min(1).max(40).optional(),
        batchId: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        allowSourceSharing: z.literal(true),
        retryAttempt: z.number().int().positive().optional(),
      })
      .strict()
      .parse(req.body);
    const repositoryMode = req.path.endsWith("/repository-discovery");
    if (
      repositoryMode
        ? !input.batchId || input.paths !== undefined
        : !input.paths || input.batchId !== undefined
    )
      throw new HttpError(
        400,
        "INVALID_SCOPE",
        "Use batchId for repository discovery and paths for scoped analysis",
      );
    const generation = await accessGeneration(String(res.locals.userId));
    const snapshot = await revision(
      res.locals.projectId,
      objectId.parse(req.params.revisionId),
    );
    const investigation = req.params.investigationId
      ? await Investigation.findOne({
          _id: objectId.parse(req.params.investigationId),
          projectId: res.locals.projectId,
          revisionId: snapshot.id,
        })
      : null;
    if (req.params.investigationId && !investigation)
      throw new HttpError(
        404,
        "NOT_FOUND",
        "Investigation not found for this revision",
      );
    const batch = repositoryMode
      ? planRepositoryDiscovery(snapshot.files).batches.find(
          (b) => b.id === input.batchId,
        )
      : undefined;
    if (repositoryMode && !batch)
      throw new HttpError(
        422,
        "INVALID_BATCH",
        "Batch is not part of this revision's discovery plan",
      );
    const paths = [...new Set(batch?.paths ?? input.paths!)].sort();
    const files = batch
      ? batchSource(snapshot.files, batch)
      : paths.map((path) => {
          const file = snapshot.files.find((f) => f.path === path);
          if (!file)
            throw new HttpError(
              422,
              "SOURCE_UNAVAILABLE",
              "A selected file is unavailable in this revision",
            );
          return { path: file.path, content: file.content, hash: file.hash };
        });
    prepareSource(files);
    const filter = {
      projectId: res.locals.projectId,
      revisionId: snapshot.id,
      scopeKey:
        batch?.id ??
        createHash("sha256")
          .update(
            JSON.stringify(
              investigation
                ? [
                    paths,
                    investigation.id,
                    investigation.text,
                    investigation.traceRevisionId,
                  ]
                : paths,
            ),
          )
          .digest("hex"),
    };
    const cached = await AiDiscovery.findOne(filter);
    const existing = cached
      ? await getDiscovery(res.locals.projectId, cached.id)
      : null;
    if (existing && input.retryAttempt === undefined) {
      res
        .status(existing.status === "pending" ? 202 : 200)
        .json({ data: existing });
      return;
    }
    if (
      input.retryAttempt !== undefined &&
      (!existing ||
        existing.status !== "failed" ||
        existing.attempt !== input.retryAttempt)
    )
      throw new HttpError(
        409,
        "AI_RETRY_CONFLICT",
        "Refresh analysis status before retrying",
      );
    if (!process.env.OPENAI_API_KEY)
      throw new HttpError(
        503,
        "AI_NOT_CONFIGURED",
        "AI analysis is not configured",
      );
    const budget = await consumeBudget(
      "ai-discovery",
      String(res.locals.userId),
      10,
      3600000,
    );
    if (!budget.allowed)
      throw new HttpError(
        429,
        "AI_RATE_LIMIT",
        "AI analysis limit reached; try later",
      );
    let record;
    try {
      record = existing
        ? await claimDiscoveryRetry(
            res.locals.projectId,
            existing.id,
            input.retryAttempt!,
          )
        : await AiDiscovery.create({
            ...filter,
            status: "pending",
            startedAt: new Date(),
          });
      if (!record)
        throw new HttpError(
          409,
          "AI_RETRY_CONFLICT",
          "Another request already retried this analysis",
        );
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      res.status(202).json({ data: await AiDiscovery.findOne(filter) });
      return;
    }
    try {
      const result = investigation
        ? await diagnoseWithAI(files, {
            text: investigation.text,
            sha: snapshot.sha,
            historicalTrace:
              (
                investigation.traceRevisionId ?? investigation.revisionId
              ).toString() !== snapshot.id,
          })
        : await discoverWithAI(files);
      const completed = await mongoose.connection.transaction(
        async (session) => {
          await assertAccess(String(res.locals.userId), generation, session);
          // Write the project in this transaction so archive/deletion racing this
          // completion conflicts instead of accepting a stale access check.
          const active = await Project.updateOne(
            {
              _id: res.locals.projectId,
              userId: res.locals.userId,
              archivedAt: null,
              deletingAt: null,
            },
            { $inc: { __v: 1 } },
            { session },
          );
          if (!active.matchedCount)
            throw new HttpError(
              409,
              "PROJECT_UNAVAILABLE",
              "Project access changed during analysis",
            );
          return AiDiscovery.findOneAndUpdate(
            { _id: record.id, status: "pending", attempt: record.attempt },
            {
              $set: {
                status: "completed",
                result: {
                  ...result,
                  kind: investigation ? "error-diagnosis" : "feature-discovery",
                  investigationId: investigation?.id,
                  sha: snapshot.sha,
                  limitations: [...snapshot.limitations, ...result.limitations],
                },
              },
            },
            { new: true, session },
          );
        },
      );
      if (!completed)
        throw new HttpError(
          409,
          "AI_REQUEST_EXPIRED",
          "This analysis expired; its late result was not accepted",
        );
      res.status(201).json({ data: completed });
    } catch (error) {
      await AiDiscovery.updateOne(
        { _id: record.id, status: "pending", attempt: record.attempt },
        { $set: { status: "failed", errorCode: "AI_ANALYSIS_FAILED" } },
      );
      throw error;
    }
  },
);

featureEvidence.get(
  "/projects/:projectId/ai-discoveries/:id",
  async (req, res) => {
    res.json({
      data: await getDiscovery(
        res.locals.projectId,
        objectId.parse(req.params.id),
      ),
    });
  },
);

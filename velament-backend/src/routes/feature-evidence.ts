import { Investigation } from "../models/Investigation.js";
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
  createAssessment,
  getAssessment,
  associateAssessmentRun,
} from "../services/assessment.service.js";
import { HttpError } from "../utils/errors.js";
export const featureEvidence = Router();
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

// Explicit request only: selected revision source is sent to OpenAI.
featureEvidence.post(
  [
    "/projects/:projectId/revisions/:revisionId/ai-discovery",
    "/projects/:projectId/revisions/:revisionId/investigations/:investigationId/ai-diagnosis",
  ],
  async (req, res) => {
    const input = z
      .object({
        paths: z.array(z.string().min(1)).min(1).max(40),
        allowSourceSharing: z.literal(true),
        retryAttempt: z.number().int().positive().optional(),
      })
      .strict()
      .parse(req.body);
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
    const paths = [...new Set(input.paths)].sort();
    const files = paths.map((path) => {
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
      scopeKey: createHash("sha256")
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
      const completed = await AiDiscovery.findOneAndUpdate(
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
        { new: true },
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

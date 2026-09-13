import { Project } from "../models/Project.js";
import { assertAccess } from "./access.service.js";
import mongoose from "mongoose";
import { testReportInput } from "@velament/shared";
import { Feature } from "../models/Feature.js";
import { FeatureAssessment } from "../models/FeatureAssessment.js";
import { TestRun } from "../models/TestRun.js";
import { revision } from "./project.service.js";
import { assessFeature } from "./feature-evidence.service.js";
import { HttpError } from "../utils/errors.js";
export async function createAssessment(
  projectId: string,
  featureId: string,
  revisionId: string,
  featureVersion: number,
) {
  const feature = await Feature.findOne({
    _id: featureId,
    projectId,
    archivedAt: null,
  });
  if (!feature)
    throw new HttpError(404, "NOT_FOUND", "Active feature not found");
  if (feature.version !== featureVersion)
    throw new HttpError(
      409,
      "FEATURE_CHANGED",
      "Reload the feature before assessing it",
    );
  const snapshot = await revision(projectId, revisionId);
  const evidence = assessFeature(feature, snapshot.files, snapshot.edges);
  evidence.limitations.push(...snapshot.limitations);
  evidence.prompt =
    "Repository revision: " +
    snapshot.sha +
    ". Check out this revision before using the source references.\n\n" +
    evidence.prompt +
    "\n\nSnapshot coverage limits:\n" +
    snapshot.limitations.join("\n");
  return FeatureAssessment.create({
    projectId,
    featureId,
    revisionId,
    sha: snapshot.sha,
    featureVersion,
    requirement: feature.requirement,
    evidence,
  });
}
export async function getAssessment(projectId: string, id: string) {
  const assessment = await FeatureAssessment.findOne({ _id: id, projectId });
  if (!assessment)
    throw new HttpError(404, "NOT_FOUND", "Assessment not found");
  const feature = await Feature.findOne({
    _id: assessment.featureId,
    projectId,
  });
  const run = assessment.testRunId
    ? await TestRun.findOne({
        _id: assessment.testRunId,
        projectId,
        sha: assessment.sha,
      })
    : null;
  const report = assessment.testReport;
  const reportRun = report
    ? await TestRun.findOne({
        _id: report.runId,
        projectId,
        sha: assessment.sha,
      })
    : null;
  const staleReasons: string[] = [];
  if (report) {
    if (!feature) staleReasons.push("feature-missing");
    else {
      if (feature.version !== assessment.featureVersion)
        staleReasons.push("feature-changed");
      if (feature.archivedAt) staleReasons.push("feature-archived");
    }
    if (!reportRun) staleReasons.push("run-missing");
    else {
      if (reportRun.runAttempt !== report.attempt)
        staleReasons.push("run-attempt-changed");
      if (reportRun.status !== "completed")
        staleReasons.push("run-not-completed");
    }
  }
  return {
    reportEvidence: report
      ? {
          report,
          stale: staleReasons.length > 0,
          staleReasons,
          featureVerification: "not-established",
        }
      : null,
    assessment,
    stale: !feature || feature.version !== assessment.featureVersion,
    archived: !!feature?.archivedAt,
    runEvidence: run
      ? {
          run,
          coverage: "user-associated",
          selectedAttempt: assessment.testRunAttempt ?? null,
          stale:
            assessment.testRunAttempt == null ||
            assessment.testRunAttempt !== (run.runAttempt ?? 1),
          featureVerification: "not-established",
        }
      : null,
  };
}
export async function associateAssessmentRun(
  projectId: string,
  id: string,
  runId: string,
) {
  const assessment = await FeatureAssessment.findOne({ _id: id, projectId });
  if (!assessment)
    throw new HttpError(404, "NOT_FOUND", "Assessment not found");
  const run = await TestRun.findOne({
    _id: runId,
    projectId,
    sha: assessment.sha,
  });
  if (!run)
    throw new HttpError(
      422,
      "EVIDENCE_MISMATCH",
      "Run must match this project and exact commit",
    );
  assessment.testRunId = run._id;
  assessment.testRunAttempt = run.runAttempt ?? 1;
  await assessment.save();
  return getAssessment(projectId, id);
}

export async function uploadTestReport(
  projectId: string,
  id: string,
  value: unknown,
  artifact?: { userId: string; generation: number; artifactId: number },
) {
  const input = testReportInput.parse(value);
  await mongoose.connection.transaction(async (session) => {
    if (artifact) {
      await assertAccess(artifact.userId, artifact.generation, session);
      const active = await Project.updateOne(
        {
          _id: projectId,
          userId: artifact.userId,
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
          "Project changed during import",
        );
    }
    const assessment = await FeatureAssessment.findOne({
      _id: id,
      projectId,
    }).session(session);
    if (!assessment)
      throw new HttpError(404, "NOT_FOUND", "Assessment not found");
    if (assessment.sha !== input.sha)
      throw new HttpError(
        422,
        "EVIDENCE_MISMATCH",
        "Report must match assessment commit",
      );
    const run = await TestRun.updateOne(
      {
        _id: input.runId,
        projectId,
        sha: input.sha,
        runAttempt: input.attempt,
        status: "completed",
      },
      { $inc: { __v: 1 } },
      { session },
    );
    if (!run.matchedCount)
      throw new HttpError(
        422,
        "EVIDENCE_MISMATCH",
        "Report must match a completed run and its current attempt",
      );
    await FeatureAssessment.updateOne(
      { _id: id, projectId },
      {
        $set: {
          testReport: {
            ...input,
            provenance: artifact ? "github-artifact" : "user-uploaded",
            artifactId: artifact?.artifactId,
            receivedAt: new Date(),
            outcome: input.tests.some((t) => t.outcome === "failed")
              ? "failed"
              : input.tests.every((t) => t.outcome === "passed")
                ? "passed"
                : "incomplete",
          },
        },
      },
      { session },
    );
  });
  return getAssessment(projectId, id);
}

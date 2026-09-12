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
  return {
    assessment,
    stale: !feature || feature.version !== assessment.featureVersion,
    archived: !!feature?.archivedAt,
    runEvidence: run
      ? {
          run,
          coverage: "user-associated",
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
  await assessment.save();
  return getAssessment(projectId, id);
}

import { Schema, model } from "mongoose";
export const FeatureAssessment = model(
  "FeatureAssessment",
  new Schema(
    {
      projectId: { type: Schema.Types.ObjectId, required: true, index: true },
      featureId: { type: Schema.Types.ObjectId, required: true, index: true },
      revisionId: { type: Schema.Types.ObjectId, required: true },
      sha: { type: String, required: true },
      featureVersion: { type: Number, required: true },
      requirement: { type: String, required: true },
      evidence: { type: Schema.Types.Mixed, required: true },
      testRunId: Schema.Types.ObjectId,
    },
    { timestamps: true },
  ),
);

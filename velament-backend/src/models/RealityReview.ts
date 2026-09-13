import { Schema, model } from "mongoose";
const schema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, required: true },
    revisionId: { type: Schema.Types.ObjectId, required: true },
    findingId: { type: String, required: true },
    reason: { type: String, required: true, maxlength: 2000 },
  },
  { timestamps: true },
);
schema.index({ projectId: 1, revisionId: 1, findingId: 1 }, { unique: true });
export const RealityReview = model("RealityReview", schema);

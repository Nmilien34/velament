import { Schema, model } from "mongoose";
export const Feature = model(
  "Feature",
  new Schema(
    {
      archivedAt: Date,
      projectId: { type: Schema.Types.ObjectId, required: true, index: true },
      title: { type: String, required: true },
      requirement: { type: String, required: true },
      kind: { type: String, enum: ["planned", "existing"], required: true },
      paths: [String],
      revisionId: { type: Schema.Types.ObjectId, required: true },
      version: { type: Number, default: 1 },
    },
    { timestamps: true },
  ),
);

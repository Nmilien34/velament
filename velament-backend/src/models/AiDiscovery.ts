import { Schema, model } from "mongoose";
const schema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, required: true },
    revisionId: { type: Schema.Types.ObjectId, required: true },
    scopeKey: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      required: true,
    },
    attempt: { type: Number, default: 1 },
    startedAt: Date,
    errorCode: String,
    result: Schema.Types.Mixed,
  },
  { timestamps: true },
);
schema.index({ projectId: 1, revisionId: 1, scopeKey: 1 }, { unique: true });
export const AiDiscovery = model("AiDiscovery", schema);

import { Schema, model } from "mongoose";
const schema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, index: true },
    kind: { type: String, enum: ["analysis", "webhook"], required: true },
    status: {
      type: String,
      enum: ["queued", "running", "completed", "failed", "cancelled"],
      default: "queued",
      index: true,
    },
    key: { type: String, required: true, unique: true },
    requestedBranch: String,
    payload: { type: Schema.Types.Mixed, default: {} },
    attempts: { type: Number, default: 0 },
    leaseUntil: Date,
    leaseToken: String,
    cancelRequested: { type: Boolean, default: false },
    resultId: String,
    errorCode: String,
    availableAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
schema.index({ status: 1, availableAt: 1 });
export const Job = model("Job", schema);

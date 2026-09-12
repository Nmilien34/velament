import { Schema, model } from "mongoose";
const schema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, required: true, index: true },
    key: { type: String, required: true },
    requestHash: String,
    workflowId: { type: String, required: true },
    ref: { type: String, required: true },
    sha: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "accepted", "unknown", "rejected"],
      default: "pending",
    },
    githubRunId: Number,
    errorCode: String,
  },
  { timestamps: true },
);
schema.index({ projectId: 1, key: 1 }, { unique: true });
export const Dispatch = model("Dispatch", schema);

import { Schema, model } from "mongoose";
const schema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    owner: { type: String, required: true },
    repo: { type: String, required: true },
    archivedAt: Date,
    connectionState: {
      type: String,
      enum: ["active", "unavailable"],
      default: "active",
    },
    installationId: Number,
    repositoryId: Number,
    branch: { type: String, required: true },
    analysisLockedUntil: Date,
    analysisLockToken: String,
  },
  { timestamps: true },
);
schema.index({ userId: 1, owner: 1, repo: 1 }, { unique: true });
export const Project = model("Project", schema);

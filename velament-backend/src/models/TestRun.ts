import { Schema, model } from "mongoose";
const schema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, required: true, index: true },
    githubRunId: { type: Number, required: true },
    sha: { type: String, required: true },
    name: { type: String, required: true },
    status: { type: String, required: true },
    conclusion: { type: String, default: null },
    url: { type: String, required: true },
    environment: { type: String, default: "unknown" },
    provenance: { type: String, default: "github-actions" },
    completedAt: Date,
    runAttempt: { type: Number, default: 1 },
    providerUpdatedAt: Date,
  },
  { timestamps: true },
);
schema.index({ projectId: 1, githubRunId: 1 }, { unique: true });
export const TestRun = model("TestRun", schema);

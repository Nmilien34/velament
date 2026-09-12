import { Schema, model } from "mongoose";
const schema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, required: true, index: true },
    sha: { type: String, required: true },
    branch: { type: String, required: true },
    state: {
      type: String,
      enum: ["ready", "partial", "empty"],
      required: true,
    },
    limitations: [String],
    files: [
      {
        _id: false,
        path: { type: String, required: true },
        content: { type: String, required: true },
        hash: { type: String, required: true },
      },
    ],
    edges: [
      {
        _id: false,
        from: { type: String, required: true },
        to: { type: String, required: true },
        kind: { type: String, enum: ["import"], required: true },
        line: { type: Number, required: true },
      },
    ],
  },
  { timestamps: true },
);
schema.index({ projectId: 1, sha: 1 }, { unique: true });
export const Revision = model("Revision", schema);

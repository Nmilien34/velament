import { Schema, model } from "mongoose";
export const Investigation = model(
  "Investigation",
  new Schema(
    {
      projectId: { type: Schema.Types.ObjectId, required: true, index: true },
      revisionId: { type: Schema.Types.ObjectId, required: true },
      parentId: { type: Schema.Types.ObjectId, index: true },
      traceRevisionId: Schema.Types.ObjectId,
      testRunId: { type: Schema.Types.ObjectId, ref: "TestRun" },
      text: { type: String, required: true },
      manualPath: String,
      frames: [
        {
          _id: false,
          path: String,
          line: Number,
          lineAvailable: Boolean,
          provenance: String,
        },
      ],
      prompt: { type: String, required: true },
      status: { type: String, enum: ["open", "closed"], default: "open" },
    },
    { timestamps: true },
  ),
);

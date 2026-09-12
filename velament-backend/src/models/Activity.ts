import { Schema, model } from "mongoose";
export const Activity = model(
  "Activity",
  new Schema(
    {
      projectId: { type: Schema.Types.ObjectId, required: true, index: true },
      kind: { type: String, required: true },
      message: { type: String, required: true },
      referenceId: String,
      eventKey: { type: String, unique: true, sparse: true },
      readAt: Date,
    },
    { timestamps: true },
  ),
);

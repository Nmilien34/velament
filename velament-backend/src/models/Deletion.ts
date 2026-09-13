import { Schema, model } from "mongoose";
export const Deletion = model(
  "Deletion",
  new Schema(
    {
      userId: { type: Schema.Types.ObjectId, required: true },
      projectId: Schema.Types.ObjectId,
      key: { type: String, required: true, unique: true },
      dueAt: { type: Date, required: true },
      completedAt: Date,
    },
    { timestamps: true },
  ),
);

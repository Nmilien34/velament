import { Schema, model } from "mongoose";
export const RequestBudget = model(
  "RequestBudget",
  new Schema(
    {
      _id: { type: String, required: true },
      count: { type: Number, required: true },
      expiresAt: { type: Date, required: true, index: { expires: 0 } },
    },
    { versionKey: false },
  ),
);

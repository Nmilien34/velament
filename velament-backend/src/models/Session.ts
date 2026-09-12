import { Schema, model } from "mongoose";
export const Session = model(
  "Session",
  new Schema(
    {
      userId: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: "User",
        index: true,
      },
      tokenHash: { type: String, required: true, unique: true, select: false },
      expiresAt: { type: Date, required: true, index: { expires: 0 } },
    },
    { timestamps: true },
  ),
);

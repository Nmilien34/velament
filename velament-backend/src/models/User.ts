import { Schema, model } from "mongoose";
const schema = new Schema(
  {
    deletingAt: Date,
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    name: { type: String, required: true },
    authProvider: { type: String, enum: ["google", "github"] },
    providerSubject: { type: String, select: false },
  },
  { timestamps: true },
);
schema.index(
  { authProvider: 1, providerSubject: 1 },
  {
    unique: true,
    partialFilterExpression: { providerSubject: { $type: "string" } },
  },
);
export const User = model("User", schema);

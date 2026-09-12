import { Schema, model } from "mongoose";
export const AuthState = model(
  "AuthState",
  new Schema(
    {
      provider: { type: String, enum: ["google", "github"], required: true },
      stateHash: { type: String, required: true, unique: true },
      browserHash: { type: String, required: true },
      verifier: { type: String, required: true, select: false },
      nonce: { type: String, required: true, select: false },
      expiresAt: { type: Date, required: true, index: { expires: 0 } },
    },
    { timestamps: true },
  ),
);

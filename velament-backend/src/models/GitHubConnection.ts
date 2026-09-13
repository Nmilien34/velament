import { Schema, model } from "mongoose";
export const GitHubConnection = model(
  "GitHubConnection",
  new Schema(
    {
      userId: { type: Schema.Types.ObjectId, required: true, unique: true },
      githubUserId: { type: Number, required: true },
      token: { type: String, required: true, select: false },
      refreshToken: { type: String, select: false },
      refreshExpiresAt: Date,
      refreshLockedUntil: Date,
      expiresAt: { type: Date, required: true },
    },
    { timestamps: true },
  ),
);
export const GitHubState = model(
  "GitHubState",
  new Schema({
    userId: { type: Schema.Types.ObjectId, required: true },
    generation: { type: Number, default: 0 },
    hash: { type: String, required: true, unique: true },
    verifier: { type: String, required: true },
    browserHash: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  }),
);

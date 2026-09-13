import { randomBytes, createHash } from "node:crypto";
import { User } from "../models/User.js";
import { Session } from "../models/Session.js";
import type { VerifiedIdentity } from "../types/auth.js";
import { HttpError } from "../utils/errors.js";
export const hashToken = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
export async function identityAccount(identity: VerifiedIdentity) {
  const key = {
    authProvider: identity.provider,
    providerSubject: identity.subject,
  };
  try {
    const user = await User.findOneAndUpdate(
      key,
      { $setOnInsert: { ...key, email: identity.email, name: identity.name } },
      { new: true, upsert: true, runValidators: true },
    );
    if (user?.deletingAt)
      throw new HttpError(
        403,
        "ACCOUNT_DELETING",
        "Account deletion is pending",
      );
    return user;
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    const concurrent = await User.findOne(key);
    if (concurrent) return concurrent;
    throw new HttpError(
      409,
      "ACCOUNT_EXISTS",
      "An account already uses this email. Sign in with its original provider",
    );
  }
}
export async function issueSession(userId: string, previousToken?: string) {
  const token = newToken(),
    expiresAt = new Date(Date.now() + 7 * 86400000);
  await Session.create({ userId, tokenHash: hashToken(token), expiresAt });
  if (previousToken)
    await Session.deleteOne({ tokenHash: hashToken(previousToken) });
  return { token, expiresAt };
}

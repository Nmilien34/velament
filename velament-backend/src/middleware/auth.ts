import { User } from "../models/User.js";
import type { RequestHandler } from "express";
import { createHash } from "node:crypto";
import { readCookie, sessionCookieName } from "../utils/cookies.js";
import { Session } from "../models/Session.js";
import { HttpError } from "../utils/errors.js";
export const authenticate: RequestHandler = async (req, res, next) => {
  const authorization = req.get("authorization");
  const token = authorization
    ? authorization.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1]
    : readCookie(req, sessionCookieName());
  if (
    !authorization &&
    token &&
    !["GET", "HEAD", "OPTIONS"].includes(req.method)
  ) {
    const origin = req.get("origin");
    if (
      !origin ||
      !(req.app.locals.allowedOrigins as Set<string> | undefined)?.has(origin)
    )
      throw new HttpError(
        403,
        "UNTRUSTED_ORIGIN",
        "Browser mutations require a trusted Origin",
      );
  }
  if (!token)
    throw new HttpError(401, "UNAUTHENTICATED", "A valid session is required");
  const session = await Session.findOne({
    tokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt: { $gt: new Date() },
  });
  if (!session)
    throw new HttpError(401, "UNAUTHENTICATED", "Session expired or revoked");
  if (await User.exists({ _id: session.userId, deletingAt: { $type: "date" } }))
    throw new HttpError(401, "ACCOUNT_DELETING", "Account deletion is pending");
  res.set("Cache-Control", "no-store");
  res.locals.userId = session.userId.toString();
  res.locals.sessionId = session.id;
  next();
};

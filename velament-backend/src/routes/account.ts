import { requestDeletion } from "../services/deletion.service.js";
import { z } from "zod";
import type { AccountProfile, SessionSummary } from "@velament/shared";
import { Router } from "express";
import { objectId } from "@velament/shared";
import { User } from "../models/User.js";
import { Session } from "../models/Session.js";
import { authenticate } from "../middleware/auth.js";
import { cookieOptions, sessionCookieName } from "../utils/cookies.js";
import { HttpError } from "../utils/errors.js";
export const account = Router();
account.use(["/me", "/logout", "/sessions"], authenticate);
account.get("/me", async (_req, res) => {
  const user = await User.findById(res.locals.userId).select(
    "email name createdAt",
  );
  if (!user) throw new HttpError(401, "UNAUTHENTICATED", "Account unavailable");
  const data: AccountProfile = {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt.toISOString(),
  };
  res.json({ data });
});
account.post("/logout", async (_req, res) => {
  await Session.deleteOne({ _id: res.locals.sessionId });
  res.clearCookie(sessionCookieName(), cookieOptions()).sendStatus(204);
});
account.get("/sessions", async (_req, res) => {
  const sessions = await Session.find({
    userId: res.locals.userId,
    expiresAt: { $gt: new Date() },
  })
    .sort({ createdAt: -1 })
    .limit(100);
  res.json({
    data: sessions.map((s): SessionSummary => ({
      id: s.id,
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      current: s.id === res.locals.sessionId,
    })),
  });
});
account.delete("/sessions/:id", async (req, res) => {
  const id = objectId.parse(req.params.id);
  const result = await Session.deleteOne({
    _id: id,
    userId: res.locals.userId,
  });
  if (!result.deletedCount)
    throw new HttpError(404, "NOT_FOUND", "Session not found");
  if (id === res.locals.sessionId)
    res.clearCookie(sessionCookieName(), cookieOptions());
  res.sendStatus(204);
});
account.post("/sessions/revoke-others", async (_req, res) => {
  await Session.deleteMany({
    userId: res.locals.userId,
    _id: { $ne: res.locals.sessionId },
  });
  res.sendStatus(204);
});

account.delete("/me", async (req, res) => {
  z.object({ confirm: z.literal("DELETE MY ACCOUNT") })
    .strict()
    .parse(req.body);
  const deletion = await requestDeletion(res.locals.userId);
  res
    .clearCookie(sessionCookieName(), cookieOptions())
    .status(202)
    .json({
      data: {
        id: deletion!.id,
        status: "deletion-pending",
        dueAt: deletion!.dueAt,
      },
    });
});

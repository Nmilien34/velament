import { rateLimit } from "../middleware/rate-limit.js";
import { Router } from "express";
import { z } from "zod";
import { authConfig } from "../config/auth.js";
import { AuthState } from "../models/AuthState.js";
import { exchangeIdentity } from "../services/identity-provider.service.js";
import {
  hashToken,
  newToken,
  identityAccount,
  issueSession,
} from "../services/session.service.js";
import {
  cookieOptions,
  readCookie,
  sessionCookieName,
} from "../utils/cookies.js";
import { HttpError } from "../utils/errors.js";
export const auth = Router();
const providerSchema = z.enum(["google", "github"]);
const flowCookie = (provider: string) =>
  (process.env.NODE_ENV === "production" ? "__Host-" : "") +
  "velament_oauth_" +
  provider;
auth.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
auth.get(
  "/:provider/start",
  rateLimit("oauth-start", 20, 600000),
  async (req, res) => {
    const provider = providerSchema.parse(req.params.provider),
      config = authConfig(provider);
    const state = newToken(),
      browser = newToken(),
      verifier = newToken(),
      nonce = newToken();
    const old = readCookie(req, flowCookie(provider));
    if (old)
      await AuthState.deleteMany({ provider, browserHash: hashToken(old) });
    await AuthState.create({
      provider,
      stateHash: hashToken(state),
      browserHash: hashToken(browser),
      verifier,
      nonce,
      expiresAt: new Date(Date.now() + 600000),
    });
    const url = new URL(
      provider === "google"
        ? "https://accounts.google.com/o/oauth2/v2/auth"
        : "https://github.com/login/oauth/authorize",
    );
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.callbackUrl,
      response_type: "code",
      scope:
        provider === "google" ? "openid email profile" : "read:user user:email",
      state,
      code_challenge: Buffer.from(hashToken(verifier), "hex").toString(
        "base64url",
      ),
      code_challenge_method: "S256",
      ...(provider === "google" ? { nonce } : {}),
    }).toString();
    res
      .cookie(flowCookie(provider), browser, {
        ...cookieOptions(),
        maxAge: 600000,
      })
      .redirect(url.toString());
  },
);
auth.get(
  "/:provider/callback",
  rateLimit("oauth-callback", 40, 600000),
  async (req, res) => {
    const provider = providerSchema.parse(req.params.provider),
      config = authConfig(provider);
    const input = z
      .object({
        state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        code: z.string().min(1).max(2000).optional(),
        error: z.string().max(200).optional(),
      })
      .parse(req.query);
    const browser = readCookie(req, flowCookie(provider));
    if (!browser)
      throw new HttpError(
        400,
        "INVALID_OAUTH_STATE",
        "Sign-in expired. Start again in this browser",
      );
    const state = await AuthState.findOneAndDelete({
      provider,
      stateHash: hashToken(input.state),
      browserHash: hashToken(browser),
      expiresAt: { $gt: new Date() },
    }).select("+verifier +nonce");
    if (!state)
      throw new HttpError(
        400,
        "INVALID_OAUTH_STATE",
        "Sign-in expired or already used. Start again",
      );
    res.clearCookie(flowCookie(provider), cookieOptions());
    if (input.error)
      throw new HttpError(
        400,
        "SIGN_IN_CANCELLED",
        "Sign-in was cancelled. You can try again",
      );
    if (!input.code)
      throw new HttpError(
        400,
        "INVALID_OAUTH_CODE",
        "Authorization code missing",
      );
    const identity = await exchangeIdentity(
      provider,
      input.code,
      state.verifier,
      state.nonce,
    );
    const user = await identityAccount(identity);
    const session = await issueSession(
      user!.id,
      readCookie(req, sessionCookieName()),
    );
    res
      .cookie(sessionCookieName(), session.token, {
        ...cookieOptions(),
        expires: session.expiresAt,
      })
      .redirect(config.appOrigin + "/auth/complete");
  },
);

import { rateLimit } from "../middleware/rate-limit.js";
import { cookieOptions, readCookie } from "../utils/cookies.js";
import { Router } from "express";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { authenticate } from "../middleware/auth.js";
import { GitHubConnection, GitHubState } from "../models/GitHubConnection.js";
import {
  appConfig,
  digest,
  encrypt,
  githubRequest,
  userToken,
  repositories,
} from "../services/github-app.service.js";
import { HttpError } from "../utils/errors.js";
export const github = Router();
const linkCookie = () =>
  (process.env.NODE_ENV === "production" ? "__Host-" : "") +
  "velament_github_link";
github.post(
  "/connect",
  authenticate,
  rateLimit("github-connect", 20, 600000),
  async (_req, res) => {
    const config = appConfig(),
      state = randomBytes(32).toString("base64url"),
      verifier = randomBytes(32).toString("base64url"),
      browser = randomBytes(32).toString("base64url");
    await GitHubState.create({
      userId: res.locals.userId,
      hash: digest(state),
      browserHash: digest(browser),
      verifier,
      expiresAt: new Date(Date.now() + 600000),
    });
    const url = new URL("https://github.com/login/oauth/authorize");
    url.search = new URLSearchParams({
      client_id: config.GITHUB_APP_CLIENT_ID,
      redirect_uri: config.GITHUB_APP_CALLBACK_URL,
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    }).toString();
    res.cookie(linkCookie(), browser, { ...cookieOptions(), maxAge: 600000 });
    res.json({ data: { authorizationUrl: url.toString() } });
  },
);
github.get("/callback", async (req, res) => {
  const input = z
    .object({ state: z.string().min(1), code: z.string().min(1) })
    .parse(req.query);
  const browser = readCookie(req, linkCookie());
  if (!browser)
    throw new HttpError(
      400,
      "INVALID_OAUTH_STATE",
      "Restart GitHub connection in this browser",
    );
  const state = await GitHubState.findOneAndDelete({
    hash: digest(input.state),
    browserHash: digest(browser),
    expiresAt: { $gt: new Date() },
  });
  if (!state)
    throw new HttpError(
      400,
      "INVALID_OAUTH_STATE",
      "Connection expired or already used. Start again",
    );
  res.clearCookie(linkCookie(), cookieOptions());
  const config = appConfig();
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.GITHUB_APP_CLIENT_ID,
      client_secret: config.GITHUB_APP_CLIENT_SECRET,
      redirect_uri: config.GITHUB_APP_CALLBACK_URL,
      code: input.code,
      code_verifier: state.verifier,
    }),
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  if (!response.ok)
    throw new HttpError(
      502,
      "OAUTH_EXCHANGE_FAILED",
      "Could not connect GitHub",
    );
  const token = z
    .object({
      access_token: z.string().min(1),
      expires_in: z.number().positive().optional(),
      refresh_token: z.string().optional(),
      refresh_token_expires_in: z.number().positive().optional(),
    })
    .safeParse(await response.json());
  if (!token.success)
    throw new HttpError(
      400,
      "OAUTH_EXCHANGE_FAILED",
      "Authorization failed. Start again",
    );
  const user = z
    .object({ id: z.number() })
    .parse(await githubRequest("/user", token.data.access_token));
  await GitHubConnection.findOneAndUpdate(
    { userId: state.userId },
    {
      $unset: {
        refreshLockedUntil: 1,
        ...(!token.data.refresh_token
          ? { refreshToken: 1, refreshExpiresAt: 1 }
          : {}),
      },
      $set: {
        githubUserId: user.id,
        ...(token.data.refresh_token
          ? {
              refreshToken: encrypt(token.data.refresh_token),
              refreshExpiresAt: new Date(
                Date.now() + (token.data.refresh_token_expires_in ?? 0) * 1000,
              ),
            }
          : {}),
        token: encrypt(token.data.access_token),
        expiresAt: new Date(
          Date.now() + (token.data.expires_in ?? 28800) * 1000,
        ),
      },
    },
    { upsert: true, runValidators: true },
  );
  res.set("Cache-Control", "no-store").json({
    data: {
      connected: true,
      next: "List installations, select authorized repository, then create project",
    },
  });
});
github.get("/installations", authenticate, async (req, res) => {
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(1)
    .parse(req.query.page);
  res.json({
    data: await githubRequest(
      "/user/installations?per_page=100&page=" + page,
      await userToken(res.locals.userId),
    ),
  });
});
github.get(
  "/installations/:id/repositories",
  authenticate,
  async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id),
      page = z.coerce
        .number()
        .int()
        .min(1)
        .max(100)
        .default(1)
        .parse(req.query.page);
    res.json({ data: await repositories(res.locals.userId, id, page) });
  },
);
github.delete("/connection", authenticate, async (_req, res) => {
  await GitHubConnection.deleteOne({ userId: res.locals.userId });
  await GitHubState.deleteMany({ userId: res.locals.userId });
  res.sendStatus(204);
});

github.get("/installation-url", authenticate, (_req, res) => {
  const slug = z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .safeParse(process.env.GITHUB_APP_SLUG);
  if (!slug.success)
    throw new HttpError(
      503,
      "GITHUB_NOT_CONFIGURED",
      "GitHub App slug is required",
    );
  res.json({
    data: {
      url: "https://github.com/apps/" + slug.data + "/installations/new",
    },
  });
});

import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  sign,
} from "node:crypto";
import { z } from "zod";
import { GitHubConnection } from "../models/GitHubConnection.js";
import { HttpError } from "../utils/errors.js";
export function appConfig() {
  const config = z
    .object({
      GITHUB_APP_ID: z.string().min(1),
      GITHUB_APP_CLIENT_ID: z.string().min(1),
      GITHUB_APP_CLIENT_SECRET: z.string().min(1),
      GITHUB_APP_PRIVATE_KEY: z.string().min(1),
      GITHUB_APP_CALLBACK_URL: z.string().url(),
      TOKEN_ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/i),
    })
    .safeParse(process.env);
  if (!config.success)
    throw new HttpError(
      503,
      "GITHUB_NOT_CONFIGURED",
      "GitHub App configuration is required",
    );
  return config.data;
}
export const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export function encrypt(text: string) {
  const key = Buffer.from(appConfig().TOKEN_ENCRYPTION_KEY, "hex"),
    iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  return Buffer.concat([
    iv,
    cipher.update(text, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64");
}
export function decrypt(value: string) {
  const data = Buffer.from(value, "base64"),
    cipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(appConfig().TOKEN_ENCRYPTION_KEY, "hex"),
      data.subarray(0, 12),
    );
  cipher.setAuthTag(data.subarray(-16));
  return Buffer.concat([
    cipher.update(data.subarray(12, -16)),
    cipher.final(),
  ]).toString("utf8");
}
export async function githubRequest(
  path: string,
  token: string,
  body?: unknown,
) {
  const response = await fetch("https://api.github.com" + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2026-03-10",
      "Content-Type": "application/json",
      "User-Agent": "Velament",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const error = new HttpError(
      response.status === 401
        ? 401
        : response.status === 404
          ? 404
          : response.status === 403 || response.status === 429
            ? 429
            : 502,
      "GITHUB_REQUEST_FAILED",
      response.status === 401
        ? "Reconnect your GitHub account"
        : response.status === 404
          ? "Repository or installation is not accessible"
          : "GitHub request unavailable; check permissions or retry after the rate-limit reset",
    );
    throw Object.assign(error, { providerStatus: response.status });
  }
  if (response.status === 204 || response.status === 202) return {};
  return response.json() as Promise<unknown>;
}
export async function userToken(userId: string) {
  const connection = await GitHubConnection.findOne({
    userId,
    expiresAt: { $gt: new Date() },
  }).select("+token");
  if (connection) return decrypt(connection.token);
  const locked = await GitHubConnection.findOneAndUpdate(
    {
      userId,
      expiresAt: { $lte: new Date() },
      refreshExpiresAt: { $gt: new Date() },
      $or: [
        { refreshLockedUntil: { $exists: false } },
        { refreshLockedUntil: { $lt: new Date() } },
      ],
    },
    { $set: { refreshLockedUntil: new Date(Date.now() + 60000) } },
    { new: true },
  ).select("+refreshToken");
  if (!locked?.refreshToken)
    throw new HttpError(
      401,
      "GITHUB_RECONNECT_REQUIRED",
      "Reconnect GitHub or retry when token refresh finishes",
    );
  const config = appConfig();
  try {
    const response = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: config.GITHUB_APP_CLIENT_ID,
          client_secret: config.GITHUB_APP_CLIENT_SECRET,
          grant_type: "refresh_token",
          refresh_token: decrypt(locked.refreshToken),
        }),
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      },
    );
    if (!response.ok) throw new Error("Refresh rejected");
    const next = z
      .object({
        access_token: z.string(),
        expires_in: z.number().positive(),
        refresh_token: z.string(),
        refresh_token_expires_in: z.number().positive(),
      })
      .parse(await response.json());
    const updated = await GitHubConnection.findOneAndUpdate(
      { _id: locked.id, refreshLockedUntil: locked.refreshLockedUntil },
      {
        $set: {
          token: encrypt(next.access_token),
          expiresAt: new Date(Date.now() + next.expires_in * 1000),
          refreshToken: encrypt(next.refresh_token),
          refreshExpiresAt: new Date(
            Date.now() + next.refresh_token_expires_in * 1000,
          ),
        },
        $unset: { refreshLockedUntil: 1 },
      },
    );
    if (!updated) throw new Error("Connection changed");
    return next.access_token;
  } catch {
    await GitHubConnection.deleteOne({
      _id: locked.id,
      refreshLockedUntil: locked.refreshLockedUntil,
    });
    throw new HttpError(
      401,
      "GITHUB_RECONNECT_REQUIRED",
      "Token refresh could not be confirmed. Reconnect GitHub",
    );
  }
}

export async function repositories(
  userId: string,
  installationId: number,
  page: number,
) {
  return githubRequest(
    "/user/installations/" +
      installationId +
      "/repositories?per_page=100&page=" +
      page,
    await userToken(userId),
  );
}
export async function repositoryToken(
  userId: string,
  installationId: number,
  repositoryId: number,
  actions: "read" | "write" = "read",
  checkpoint?: () => Promise<void>,
) {
  let found = false;
  for (let page = 1; page <= 100; page++) {
    await checkpoint?.();
    const result = z
      .object({ repositories: z.array(z.object({ id: z.number() })) })
      .parse(await repositories(userId, installationId, page));
    if (result.repositories.some((repo) => repo.id === repositoryId)) {
      found = true;
      break;
    }
    if (result.repositories.length < 100) break;
  }
  if (!found)
    throw new HttpError(
      403,
      "REPOSITORY_ACCESS_DENIED",
      "Repository is not accessible to this user and installation",
    );
  await checkpoint?.();
  const config = appConfig(),
    now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iat: now - 60,
      exp: now + 540,
      iss: config.GITHUB_APP_ID,
    }),
  ).toString("base64url");
  const unsigned = header + "." + payload;
  const jwt =
    unsigned +
    "." +
    sign(
      "RSA-SHA256",
      Buffer.from(unsigned),
      config.GITHUB_APP_PRIVATE_KEY.replaceAll("\\n", "\n"),
    ).toString("base64url");
  const token = z.object({ token: z.string(), expires_at: z.string() }).parse(
    await githubRequest(
      "/app/installations/" + installationId + "/access_tokens",
      jwt,
      {
        repository_ids: [repositoryId],
        permissions: { contents: "read", actions },
      },
    ),
  );
  return token.token;
}

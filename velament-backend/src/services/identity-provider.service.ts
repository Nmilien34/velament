import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { authConfig } from "../config/auth.js";
import type { AuthProvider, VerifiedIdentity } from "../types/auth.js";
import { HttpError } from "../utils/errors.js";
const google = new OAuth2Client();
async function json(url: string, options: RequestInit) {
  try {
    const response = await fetch(url, {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("Provider response rejected");
    return (await response.json()) as unknown;
  } catch {
    throw new HttpError(
      502,
      "AUTH_PROVIDER_UNAVAILABLE",
      "Sign-in failed. Please start again",
    );
  }
}
export async function exchangeIdentity(
  provider: AuthProvider,
  code: string,
  verifier: string,
  nonce: string,
): Promise<VerifiedIdentity> {
  const config = authConfig(provider);
  const endpoint =
    provider === "google"
      ? "https://oauth2.googleapis.com/token"
      : "https://github.com/login/oauth/access_token";
  const tokens = await json(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      code_verifier: verifier,
      redirect_uri: config.callbackUrl,
      grant_type: "authorization_code",
    }).toString(),
  });
  if (provider === "google") {
    try {
      const { id_token } = z
        .object({ id_token: z.string().min(1) })
        .parse(tokens);
      const ticket = await google.verifyIdToken({
        idToken: id_token,
        audience: config.clientId,
      });
      const claims = z
        .object({
          sub: z.string().min(1),
          email: z.email(),
          email_verified: z.literal(true),
          nonce: z.literal(nonce),
          name: z.string().max(200).optional(),
        })
        .parse(ticket.getPayload());
      return {
        provider,
        subject: claims.sub,
        email: claims.email,
        name: claims.name || claims.email.split("@")[0]!,
      };
    } catch {
      throw new HttpError(
        401,
        "INVALID_IDENTITY",
        "Google identity could not be verified",
      );
    }
  }
  const token = z.object({ access_token: z.string().min(1) }).safeParse(tokens);
  if (!token.success)
    throw new HttpError(
      401,
      "INVALID_IDENTITY",
      "GitHub authorization could not be verified",
    );
  const headers = {
    Authorization: "Bearer " + token.data.access_token,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2026-03-10",
    "User-Agent": "Velament",
  };
  const user = z
    .object({
      id: z.number().int().positive(),
      login: z.string(),
      name: z.string().nullable().optional(),
    })
    .parse(await json("https://api.github.com/user", { headers }));
  const emails = z
    .array(
      z.object({
        email: z.email(),
        verified: z.boolean(),
        primary: z.boolean(),
      }),
    )
    .parse(await json("https://api.github.com/user/emails", { headers }));
  const email = emails.find((e) => e.primary && e.verified);
  if (!email)
    throw new HttpError(
      401,
      "EMAIL_NOT_VERIFIED",
      "Verify your primary GitHub email before signing in",
    );
  return {
    provider,
    subject: String(user.id),
    email: email.email,
    name: (user.name || user.login).slice(0, 200),
  };
}

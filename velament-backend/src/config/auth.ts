import { z } from "zod";
import type { AuthProvider } from "../types/auth.js";
import { HttpError } from "../utils/errors.js";
const origin = z
  .string()
  .url()
  .refine((s) => {
    const u = new URL(s);
    return (
      u.origin === s &&
      (u.protocol === "https:" ||
        (process.env.NODE_ENV !== "production" && u.protocol === "http:"))
    );
  });
export function authConfig(provider: AuthProvider) {
  const prefix = provider === "google" ? "GOOGLE" : "GITHUB_OAUTH";
  const value = z
    .object({
      apiOrigin: origin,
      appOrigin: origin,
      clientId: z.string().min(1),
      clientSecret: z.string().min(1),
    })
    .safeParse({
      apiOrigin: process.env.AUTH_API_ORIGIN,
      appOrigin: process.env.AUTH_APP_ORIGIN,
      clientId: process.env[prefix + "_CLIENT_ID"],
      clientSecret: process.env[prefix + "_CLIENT_SECRET"],
    });
  if (!value.success)
    throw new HttpError(
      503,
      "AUTH_NOT_CONFIGURED",
      "Sign-in provider is not configured",
    );
  return {
    ...value.data,
    callbackUrl: value.data.apiOrigin + "/api/auth/" + provider + "/callback",
  };
}

import type { CookieOptions, Request } from "express";
export const sessionCookieName = () =>
  process.env.NODE_ENV === "production"
    ? "__Host-velament_session"
    : "velament_session";
export function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  };
}
export function readCookie(req: Request, name: string) {
  const values = (req.get("cookie") || "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(name + "="));
  if (values.length !== 1) return undefined;
  const value = values[0]!.slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}

import type { CorsOptions } from "cors";
export function corsOptions(origins: string): CorsOptions {
  const allowed = new Set(
    origins.split(",").map((value) => new URL(value.trim()).origin),
  );
  return {
    credentials: true,
    origin(origin, callback) {
      callback(null, !origin || allowed.has(origin));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Idempotency-Key",
      "If-Match",
    ],
    exposedHeaders: ["X-Request-Id"],
    maxAge: 600,
  };
}

export interface HealthResponse {
  status: "ok";
  service: "velament-api";
}
export interface ApiError {
  error: { code: string; message: string };
}
export interface ReadinessResponse {
  status: "ready" | "not-ready";
  service: "velament-api";
}

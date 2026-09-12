import type { HealthResponse } from "@velament/shared";
const base = import.meta.env.VITE_API_URL || "http://localhost:4000";
export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch(`${base}/api/health`, signal ? { signal } : {});
  if (!response.ok) throw new Error(`API request failed: ${response.status}`);
  return response.json() as Promise<HealthResponse>;
}

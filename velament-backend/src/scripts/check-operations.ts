import { config } from "dotenv";
config({ path: ".env", quiet: true });
const base = process.env.OPERATIONS_URL,
  token = process.env.OPERATIONS_TOKEN;
if (!base || !token) throw new Error("Set OPERATIONS_URL and OPERATIONS_TOKEN");
const url = new URL(base);
if (
  url.protocol !== "https:" &&
  !["localhost", "127.0.0.1"].includes(url.hostname)
)
  throw new Error("Monitoring requires HTTPS");
try {
  const response = await fetch(new URL("/internal/metrics", url), {
    headers: { Authorization: "Bearer " + token },
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
  if (!response.ok) throw new Error("Metrics unavailable");
  const metrics = (await response.json()) as {
    data: {
      deletions: { pending: number; overdue: number };
      queue: {
        failed: number;
        expiredLeases: number;
        oldestReadyAgeSeconds: number;
      };
      stalePendingDispatches: number;
      worker: {
        started: boolean;
        heartbeatAgeSeconds: number | null;
        pollingFailures: number;
      };
      unknownDispatches: number;
    };
  };
  const q = metrics.data.queue;
  if (
    q.failed > 0 ||
    !metrics.data.deletions ||
    metrics.data.deletions.overdue > 0 ||
    !metrics.data.worker?.started ||
    metrics.data.worker.heartbeatAgeSeconds === null ||
    metrics.data.worker.heartbeatAgeSeconds > 30 ||
    metrics.data.worker.pollingFailures > 0 ||
    metrics.data.stalePendingDispatches > 0 ||
    q.expiredLeases > 0 ||
    q.oldestReadyAgeSeconds > 300 ||
    metrics.data.unknownDispatches > 0
  )
    throw new Error("Queue requires attention");
  const ready = await fetch(new URL("/api/ready", url), {
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
  if (!ready.ok) throw new Error("Backend not ready");
  console.log("Backend operational checks passed");
} catch {
  console.error(
    "Backend operational alert: readiness, queue delay, expired lease, overdue deletion, or uncertain dispatch. Inspect protected metrics.",
  );
  process.exitCode = 1;
}

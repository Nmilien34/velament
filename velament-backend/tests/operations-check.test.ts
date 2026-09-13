import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("dotenv", () => ({ config: vi.fn() }));
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("OPERATIONS_URL", "https://example.com");
  vi.stubEnv("OPERATIONS_TOKEN", "test-token");
  vi.stubEnv("OPERATIONS_EXPECTED_COMMIT", "a".repeat(40));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  process.exitCode = 0;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it.each([undefined, -1, "invalid"])(
  "rejects malformed counters: %s",
  async (failed) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            deployment: { commit: "a".repeat(40) },
            deletions: { pending: 0, overdue: 0 },
            queue: { failed, expiredLeases: 0, oldestReadyAgeSeconds: 0 },
            worker: {
              started: true,
              heartbeatAgeSeconds: 1,
              pollingFailures: 0,
            },
            unknownDispatches: 0,
            stalePendingDispatches: 0,
          },
        }),
      }),
    );
    await import("../src/scripts/check-operations.js");
    expect(process.exitCode).toBe(1);
  },
);
it.each(["a".repeat(40), "b".repeat(40), null])(
  "verifies deployed commit %s",
  async (commit) => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          deployment: { commit },
          deletions: { pending: 0, overdue: 0 },
          queue: { failed: 0, expiredLeases: 0, oldestReadyAgeSeconds: 0 },
          worker: { started: true, heartbeatAgeSeconds: 1, pollingFailures: 0 },
          unknownDispatches: 0,
          stalePendingDispatches: 0,
        },
      }),
    });
    vi.stubGlobal("fetch", fetch);
    await import("../src/scripts/check-operations.js");
    expect(Number(process.exitCode || 0)).toBe(
      commit === "a".repeat(40) ? 0 : 1,
    );
  },
);

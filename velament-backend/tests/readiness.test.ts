import { expect, it, vi } from "vitest";
import { checkReadiness } from "../src/services/readiness.service.js";
it("pings MongoDB with a bounded deadline", async () => {
  const command = vi.fn().mockResolvedValue({ ok: 1 });
  await expect(
    checkReadiness({ readyState: 1, db: { command } } as never),
  ).resolves.toEqual({ status: "ready", service: "velament-api" });
  expect(command).toHaveBeenCalledWith({ ping: 1 }, { timeoutMS: 1000 });
});
it("does not expose database errors in the health response", async () => {
  const command = vi
    .fn()
    .mockRejectedValue(new Error("private database host detail"));
  const result = await checkReadiness({
    readyState: 1,
    db: { command },
  } as never);
  expect(result).toEqual({ status: "not-ready", service: "velament-api" });
});
it("does not query a disconnected database", async () => {
  const command = vi.fn();
  expect(
    (await checkReadiness({ readyState: 0, db: { command } } as never)).status,
  ).toBe("not-ready");
  expect(command).not.toHaveBeenCalled();
});

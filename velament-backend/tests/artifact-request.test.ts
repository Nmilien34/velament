import { afterEach, expect, it, vi } from "vitest";
import { artifactRequest } from "../src/services/artifact-request.service.js";
afterEach(() => vi.unstubAllGlobals());
it("normalizes network failures without exposing upstream details", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("secret signed URL")),
  );
  await expect(
    artifactRequest("https://example.test", { redirect: "error" }),
  ).rejects.toMatchObject({
    status: 502,
    code: "ARTIFACT_UNAVAILABLE",
    message: "Artifact request failed; retry later",
  });
});
it("preserves request options and response for caller validation", async () => {
  const response = new Response(null, { status: 302 });
  const fetcher = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetcher);
  const options = { redirect: "manual" as const };
  expect(await artifactRequest("https://example.test", options)).toBe(response);
  expect(fetcher).toHaveBeenCalledWith("https://example.test", options);
});

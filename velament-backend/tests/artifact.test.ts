import { expect, it } from "vitest";
import { parseArtifacts } from "../src/services/artifact.service.js";
it("exposes metadata and bounded pagination without trusting download URLs", () => {
  const result = parseArtifacts(
    {
      total_count: 101,
      artifacts: [
        {
          id: 1,
          name: "report",
          size_in_bytes: 123,
          expired: true,
          created_at: "today",
          expires_at: "tomorrow",
          archive_download_url: "https://untrusted.invalid",
        },
      ],
    },
    1,
  );
  expect(result.nextPage).toBe(2);
  expect(result.artifacts[0]?.expired).toBe(true);
  expect(result.artifacts[0]).not.toHaveProperty("archive_download_url");
  expect(result.attemptVerification).toBe("not-established");
  expect(
    parseArtifacts({ total_count: 10001, artifacts: [] }, 100).truncated,
  ).toBe(true);
});
it("rejects malformed provider metadata", () =>
  expect(() =>
    parseArtifacts({ total_count: 1, artifacts: [{ id: 1 }] }, 1),
  ).toThrow());

import { expect, it } from "vitest";
import { artifactDownloadUrl } from "../src/services/artifact-url.service.js";
it("accepts only supported HTTPS artifact storage URLs", () => {
  expect(
    artifactDownloadUrl(
      "https://storage.blob.core.windows.net/archive?sig=test",
    ).hostname,
  ).toBe("storage.blob.core.windows.net");
});
it.each([
  null,
  "",
  "broken",
  "/relative",
  "http://storage.blob.core.windows.net/a",
  "https://user:secret@storage.blob.core.windows.net/a",
  "https://storage.blob.core.windows.net:8080/a",
  "https://storage.blob.core.windows.net.evil.example/a",
])("rejects unsafe or malformed redirects: %s", (value) => {
  expect(() => artifactDownloadUrl(value)).toThrowError(
    expect.objectContaining({ status: 502, code: "ARTIFACT_UNAVAILABLE" }),
  );
});

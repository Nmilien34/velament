import { expect, it } from "vitest";
import {
  readArtifactReport,
  boundedBody,
} from "../src/services/artifact-report.service.js";
const fixtures = {
  valid:
    "UEsDBBQAAAAIAGyzLF3XMWV6ZQAAAKIAAAAZAAAAdmVsYW1lbnQtdGVzdC1yZXBvcnQuanNvbo2MMQ6AIAxFr2I6u7g6eg3D0ECjxNASW1wMdxf0Anb6//283oBmlLLBPEzjALpjS4A/D5pCfMVTOBH3J+Bjh0n8QWGRwgHPSNqW1TVupPaWGxgTdUHjxiV3SYp5+WBGVQpQXX0AUEsBAhQDFAAAAAgAbLMsXdcxZXplAAAAogAAABkAAAAAAAAAAAAAAIABAAAAAHZlbGFtZW50LXRlc3QtcmVwb3J0Lmpzb25QSwUGAAAAAAEAAQBHAAAAnAAAAAAA",
  missing:
    "UEsDBBQAAAAIAGyzLF1Dv6ajBAAAAAIAAAAKAAAAb3RoZXIuanNvbquuBQBQSwECFAMUAAAACABssyxdQ7+mowQAAAACAAAACgAAAAAAAAAAAAAAgAEAAAAAb3RoZXIuanNvblBLBQYAAAAAAQABADgAAAAsAAAAAAA=",
  oversize:
    "UEsDBBQAAAAIAGyzLF3EsdpmCQEAAAHoAwAZAAAAdmVsYW1lbnQtdGVzdC1yZXBvcnQuanNvbu3BMQEAAADCoNqLbwhfoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAATgNQSwECFAMUAAAACABssyxdxLHaZgkBAAAB6AMAGQAAAAAAAAAAAAAAgAEAAAAAdmVsYW1lbnQtdGVzdC1yZXBvcnQuanNvblBLBQYAAAAAAQABAEcAAABAAQAAAAA=",
  duplicate:
    "UEsDBBQAAAAIAGyzLF3XMWV6ZQAAAKIAAAAZAAAAdmVsYW1lbnQtdGVzdC1yZXBvcnQuanNvbo2MMQ6AIAxFr2I6u7g6eg3D0ECjxNASW1wMdxf0Anb6//283oBmlLLBPEzjALpjS4A/D5pCfMVTOBH3J+Bjh0n8QWGRwgHPSNqW1TVupPaWGxgTdUHjxiV3SYp5+WBGVQpQXX0AUEsDBBQAAAAIAGyzLF3XMWV6ZQAAAKIAAAAZAAAAdmVsYW1lbnQtdGVzdC1yZXBvcnQuanNvbo2MMQ6AIAxFr2I6u7g6eg3D0ECjxNASW1wMdxf0Anb6//283oBmlLLBPEzjALpjS4A/D5pCfMVTOBH3J+Bjh0n8QWGRwgHPSNqW1TVupPaWGxgTdUHjxiV3SYp5+WBGVQpQXX0AUEsBAhQDFAAAAAgAbLMsXdcxZXplAAAAogAAABkAAAAAAAAAAAAAAIABAAAAAHZlbGFtZW50LXRlc3QtcmVwb3J0Lmpzb25QSwECFAMUAAAACABssyxd1zFlemUAAACiAAAAGQAAAAAAAAAAAAAAgAGcAAAAdmVsYW1lbnQtdGVzdC1yZXBvcnQuanNvblBLBQYAAAAAAgACAI4AAAA4AQAAAAA=",
};
it("parses bounded reports with a backend-owned run ID", async () => {
  const report = await readArtifactReport(
    Buffer.from(fixtures.valid, "base64"),
    "a".repeat(24),
  );
  expect(report.runId).toBe("a".repeat(24));
  expect(report.tests[0]?.name).toBe("signup");
});
it.each(["missing", "oversize", "duplicate"] as const)(
  "rejects %s archives",
  async (key) => {
    await expect(
      readArtifactReport(Buffer.from(fixtures[key], "base64"), "a".repeat(24)),
    ).rejects.toThrow();
  },
);
it("limits downloaded bytes", async () => {
  await expect(
    boundedBody(new Response(new Uint8Array(2000001))),
  ).rejects.toThrow();
});
it("returns actionable errors for invalid archives and failed downloads", async () => {
  await expect(
    readArtifactReport(Buffer.from("invalid"), "a".repeat(24)),
  ).rejects.toMatchObject({ status: 422, code: "INVALID_ARTIFACT_REPORT" });
  await expect(
    readArtifactReport(Buffer.from(fixtures.missing, "base64"), "a".repeat(24)),
  ).rejects.toMatchObject({ status: 422, code: "INVALID_ARTIFACT_REPORT" });
  await expect(
    boundedBody(new Response(null, { status: 503 })),
  ).rejects.toMatchObject({ status: 502, code: "ARTIFACT_UNAVAILABLE" });
  await expect(
    boundedBody(new Response(new Uint8Array(2000001))),
  ).rejects.toMatchObject({ status: 422, code: "ARTIFACT_TOO_LARGE" });
});
it("normalizes interrupted downloads and releases the reader lock", async () => {
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(new Error("private upstream detail"));
    },
  });
  await expect(boundedBody(new Response(stream))).rejects.toMatchObject({
    status: 502,
    code: "ARTIFACT_UNAVAILABLE",
  });
  expect(stream.locked).toBe(false);
});
it("preserves the size error when cancellation itself fails", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(2000001));
    },
    cancel() {
      throw new Error("cleanup failed");
    },
  });
  await expect(boundedBody(new Response(stream))).rejects.toMatchObject({
    status: 422,
    code: "ARTIFACT_TOO_LARGE",
  });
  expect(stream.locked).toBe(false);
});

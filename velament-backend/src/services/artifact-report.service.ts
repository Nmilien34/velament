import { fromBuffer } from "yauzl";
import { testReportInput } from "@velament/shared";
import { HttpError } from "../utils/errors.js";
export async function readArtifactReport(zip: Buffer, runId: string) {
  if (zip.length > 2_000_000)
    throw new HttpError(422, "ARTIFACT_TOO_LARGE", "Artifact exceeds 2 MB");
  const text = await new Promise<string>((resolve, reject) => {
    fromBuffer(
      zip,
      { lazyEntries: true, validateEntrySizes: true },
      (error, archive) => {
        if (error || !archive)
          return reject(error ?? new Error("Invalid archive"));
        let report: string | undefined,
          count = 0;
        const fail = (error: Error) => {
          archive.close();
          reject(error);
        };
        archive.on("error", fail);
        archive.on("end", () =>
          report === undefined
            ? reject(new Error("Missing report"))
            : resolve(report),
        );
        archive.on("entry", (entry) => {
          if (++count > 100) return fail(new Error("Too many archive entries"));
          if (entry.fileName !== "velament-test-report.json")
            return archive.readEntry();
          if (report !== undefined || entry.uncompressedSize > 256_000)
            return fail(new Error("Duplicate or oversized report"));
          archive.openReadStream(entry, (error, stream) => {
            if (error || !stream)
              return fail(error ?? new Error("Invalid report"));
            const chunks: Buffer[] = [];
            let size = 0;
            stream.on("error", fail);
            stream.on("data", (chunk) => {
              size += chunk.length;
              if (size > 256_000) {
                stream.destroy();
                fail(new Error("Report exceeds limit"));
              } else chunks.push(chunk);
            });
            stream.on("end", () => {
              report = Buffer.concat(chunks).toString("utf8");
              archive.readEntry();
            });
          });
        });
        archive.readEntry();
      },
    );
  });
  return testReportInput.parse({ ...JSON.parse(text), runId });
}
export async function boundedBody(response: Response) {
  if (!response.ok || !response.body)
    throw new Error("Artifact download failed");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2_000_000) throw new Error("Artifact exceeds limit");
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel();
  }
}

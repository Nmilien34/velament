import { batchSource, type SourceRange } from "./discovery-source.js";
import { createHash } from "node:crypto";
import type { SourceFile } from "@velament/shared";
import { validateDiscovery } from "./ai-discovery.service.js";

type Candidate = ReturnType<typeof validateDiscovery>["features"][number];
// Name groups are presentation aids, never a semantic merge or saved feature ID.
export function summarizeDiscovery(
  batches: {
    id: string;
    paths: string[];
    ranges?: SourceRange[];
    status: string;
    result: unknown;
  }[],
  files: SourceFile[],
) {
  const groups = new Map<
    string,
    {
      id: string;
      title: string;
      verification: "unverified";
      candidates: (Candidate & { batchId: string })[];
    }
  >();
  const rejectedBatchIds: string[] = [];
  for (const batch of batches) {
    if (batch.status !== "completed") continue;
    let result: ReturnType<typeof validateDiscovery>;
    try {
      result = validateDiscovery(batch.result, batchSource(files, batch));
      if (result.features.some((f) => !f.title.trim()))
        throw new Error("Empty title");
    } catch {
      rejectedBatchIds.push(batch.id);
      continue;
    }
    for (const candidate of result.features) {
      const key = candidate.title
        .normalize("NFKC")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
      let group = groups.get(key);
      if (!group) {
        group = {
          id: createHash("sha256").update(key).digest("hex"),
          title: candidate.title.trim(),
          verification: "unverified",
          candidates: [],
        };
        groups.set(key, group);
      }
      group.candidates.push({ ...candidate, batchId: batch.id });
    }
  }
  return { groups: [...groups.values()], rejectedBatchIds };
}

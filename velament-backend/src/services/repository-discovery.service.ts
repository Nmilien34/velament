import type { SourceRange } from "./discovery-source.js";
import { summarizeDiscovery } from "./discovery-summary.service.js";
import { createHash } from "node:crypto";
import type { SourceFile } from "@velament/shared";
import { AiDiscovery } from "../models/AiDiscovery.js";
import { getDiscovery } from "./ai-recovery.service.js";

// Stable ordering and the same scope key as selected-file discovery allow reuse.
export function planRepositoryDiscovery(files: SourceFile[]) {
  const batches: { id: string; paths: string[]; ranges?: SourceRange[] }[] = [];
  const skipped: { path: string; reason: string }[] = [];
  let current: SourceFile[] = [];
  const flush = () => {
    if (!current.length) return;
    const paths = current.map((f) => f.path);
    batches.push({
      id: createHash("sha256").update(JSON.stringify(paths)).digest("hex"),
      paths,
    });
    current = [];
  };
  for (const file of [...files].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  )) {
    const source = { path: file.path, content: file.content, hash: file.hash };
    if (Buffer.byteLength(JSON.stringify([source])) > 80000) {
      flush();
      const lines = file.content.split("\n");
      const ranges: SourceRange[] = [];
      let start = 0;
      while (start < lines.length) {
        let low = start,
          high = lines.length;
        while (low < high) {
          const end = Math.ceil((low + high) / 2);
          const part = {
            ...source,
            content: lines.slice(start, end).join("\n"),
            startLine: start + 1,
          };
          if (Buffer.byteLength(JSON.stringify([part])) <= 80000) low = end;
          else high = end - 1;
        }
        if (low === start) break;
        ranges.push({ path: file.path, startLine: start + 1, endLine: low });
        start = low;
      }
      if (start < lines.length)
        skipped.push({ path: file.path, reason: "file-exceeds-batch-limit" });
      else
        for (const range of ranges)
          batches.push({
            id: createHash("sha256")
              .update(JSON.stringify(["lines-v1", range]))
              .digest("hex"),
            paths: [file.path],
            ranges: [range],
          });
      continue;
    }
    if (
      current.length === 40 ||
      Buffer.byteLength(JSON.stringify([...current, source])) > 80000
    )
      flush();
    current.push(source);
  }
  flush();
  return { batches, skipped };
}

export async function repositoryDiscoveryProgress(
  projectId: string,
  revisionId: string,
  files: SourceFile[],
) {
  const plan = planRepositoryDiscovery(files);
  const records = await AiDiscovery.find({
    projectId,
    revisionId,
    scopeKey: { $in: plan.batches.map((b) => b.id) },
  });
  const current = new Map<string, Awaited<ReturnType<typeof getDiscovery>>>();
  for (const record of records)
    current.set(record.scopeKey, await getDiscovery(projectId, record.id));
  const batches = plan.batches.map((batch) => {
    const record = current.get(batch.id);
    return {
      ...batch,
      status: record?.status ?? "not-started",
      discoveryId: record?.id ?? null,
      attempt: record?.attempt ?? null,
      errorCode: record?.errorCode ?? null,
      result: record?.status === "completed" ? record.result : null,
    };
  });
  return {
    batches,
    summary: summarizeDiscovery(batches, files),
    skipped: plan.skipped,
    snapshotFiles: files.length,
    analyzedFiles: files.filter((f) => {
      const parts = batches.filter((b) => b.paths.includes(f.path));
      return parts.length > 0 && parts.every((b) => b.status === "completed");
    }).length,
    complete:
      batches.length > 0 && batches.every((b) => b.status === "completed"),
    nextBatchId: batches.find((b) => b.status !== "completed")?.id ?? null,
    verification: "unverified" as const,
    limitations: [
      "Coverage refers only to stored snapshot files, not the entire GitHub repository.",
      "Matching candidate names are grouped for display only; descriptions and references remain independent hypotheses, not semantic merges or runtime verification.",
      "Each batch requires an explicit request. Failed or interrupted batches require explicit retry; no source is automatically resent.",
    ],
  };
}

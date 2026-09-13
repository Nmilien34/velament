import { createHash } from "node:crypto";
import type { SourceFile } from "@velament/shared";
import { AiDiscovery } from "../models/AiDiscovery.js";
import { getDiscovery } from "./ai-recovery.service.js";

// Stable ordering and the same scope key as selected-file discovery allow reuse.
export function planRepositoryDiscovery(files: SourceFile[]) {
  const batches: { id: string; paths: string[] }[] = [];
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
      skipped.push({ path: file.path, reason: "file-exceeds-batch-limit" });
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
    skipped: plan.skipped,
    snapshotFiles: files.length,
    analyzedFiles: batches
      .filter((b) => b.status === "completed")
      .reduce((n, b) => n + b.paths.length, 0),
    complete:
      batches.length > 0 && batches.every((b) => b.status === "completed"),
    nextBatchId: batches.find((b) => b.status !== "completed")?.id ?? null,
    verification: "unverified" as const,
    limitations: [
      "Coverage refers only to stored snapshot files, not the entire GitHub repository.",
      "Candidates are batch-local hypotheses; cross-batch features are not merged or runtime verified.",
      "Each batch requires an explicit request. Failed or interrupted batches require explicit retry; no source is automatically resent.",
    ],
  };
}

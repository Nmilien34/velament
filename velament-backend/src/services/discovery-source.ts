import type { SourceFile } from "@velament/shared";
export type DiscoverySource = SourceFile & { startLine?: number };
export type SourceRange = { path: string; startLine: number; endLine: number };
export function batchSource(
  files: SourceFile[],
  batch: { paths: string[]; ranges?: SourceRange[] },
): DiscoverySource[] {
  return batch.paths.map((path) => {
    const file = files.find((f) => f.path === path)!;
    const range = batch.ranges?.find((r) => r.path === path);
    return range
      ? {
          path,
          hash: file.hash,
          content: file.content
            .split("\n")
            .slice(range.startLine - 1, range.endLine)
            .join("\n"),
          startLine: range.startLine,
        }
      : { path, hash: file.hash, content: file.content };
  });
}

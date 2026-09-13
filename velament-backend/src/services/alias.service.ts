import ts from "typescript";
import path from "node:path";
import { z } from "zod";
import type { SourceFile } from "@velament/shared";
const configSchema = z.object({
  extends: z.unknown().optional(),
  compilerOptions: z
    .object({
      baseUrl: z.string().optional(),
      paths: z.record(z.string(), z.array(z.string())).optional(),
    })
    .optional(),
});
export function aliasResolver(files: SourceFile[]) {
  const configs = files
    .filter((f) => /(^|\/)(tsconfig|jsconfig)\.json$/.test(f.path))
    .map((f) => ({
      file: f,
      dir: path.posix.dirname(f.path),
      parsed: ts.parseConfigFileTextToJson(f.path, f.content),
    }));
  return (importer: string, spec: string): string[] => {
    const config = configs
      .filter((c) => c.dir === "." || importer.startsWith(c.dir + "/"))
      .sort(
        (a, b) =>
          b.dir.length - a.dir.length ||
          (a.file.path.includes("tsconfig") ? -1 : 1),
      )[0];
    if (!config || config.parsed.error) return [];
    const parsed = configSchema.safeParse(config.parsed.config);
    if (!parsed.success || parsed.data.extends !== undefined) return [];
    const opts = parsed.data.compilerOptions;
    const mapping = Object.entries(opts?.paths ?? {})
      .filter(([key]) => {
        const parts = key.split("*");
        return parts.length === 1
          ? key === spec
          : parts.length === 2 &&
              spec.startsWith(parts[0]!) &&
              spec.endsWith(parts[1]!) &&
              spec.length >= key.length - 1;
      })
      .sort(
        ([a], [b]) =>
          Number(b === spec) - Number(a === spec) ||
          b.split("*")[0]!.length - a.split("*")[0]!.length,
      )[0];
    if (!mapping) return [];
    const [key, targets] = mapping,
      [prefix, suffix] = key.split("*");
    const capture =
      suffix === undefined
        ? ""
        : spec.slice(prefix!.length, spec.length - suffix.length);
    return targets
      .filter((t) => t.split("*").length <= 2 && !path.posix.isAbsolute(t))
      .map((t) =>
        path.posix.normalize(
          path.posix.join(
            config.dir,
            opts?.baseUrl ?? ".",
            t.replace("*", capture),
          ),
        ),
      )
      .filter(
        (p) => p !== ".." && !p.startsWith("../") && !path.posix.isAbsolute(p),
      );
  };
}

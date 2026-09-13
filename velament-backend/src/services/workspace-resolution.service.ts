import { isBuiltin } from "node:module";
import path from "node:path";
import type { SourceFile } from "@velament/shared";

type Manifest = Record<string, unknown>;
const object = (value: unknown): value is Manifest =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// Resolve only explicit, captured workspace links. This is not a package installer.
export function workspaceResolver(files: SourceFile[]) {
  const manifests = files
    .filter((f) => /(^|\/)package\.json$/.test(f.path))
    .map((f) => {
      let data: Manifest = {};
      try {
        const parsed: unknown = JSON.parse(f.content);
        if (object(parsed)) data = parsed;
      } catch {
        /* Invalid manifests establish no links. */
      }
      return { dir: path.posix.dirname(f.path), data };
    });
  const root = manifests.find((m) => m.dir === ".");
  const patterns = Array.isArray(root?.data.workspaces)
    ? root.data.workspaces
    : [];
  const members = manifests.filter(
    (m) =>
      m.dir !== "." &&
      patterns.some((pattern) => {
        if (typeof pattern !== "string") return false;
        // Exact paths and a single whole directory wildcard cover common layouts.
        const parts = pattern
          .replace(/^\.\//, "")
          .replace(/\/$/, "")
          .split("/");
        const actual = m.dir.split("/");
        return (
          parts.length === actual.length &&
          parts.every((part, i) => part === "*" || part === actual[i])
        );
      }),
  );
  return (importer: string, spec: string): string[] => {
    if (isBuiltin(spec) || spec.startsWith("node:")) return [];
    const match = spec.match(/^(@[^/]+\/[^/]+|[^@./][^/]*)(?:\/(.+))?$/);
    if (!match) return [];
    const name = match[1]!,
      subpath = match[2] ? "./" + match[2] : ".";
    const candidates = members.filter((m) => m.data.name === name);
    if (candidates.length !== 1) return [];
    const target = candidates[0]!;
    const owner = manifests
      .filter((m) => m.dir === "." || importer.startsWith(m.dir + "/"))
      .sort((a, b) => b.dir.length - a.dir.length)[0];
    if (!owner) return [];
    const declarations = [
      owner.data.dependencies,
      owner.data.devDependencies,
      owner.data.optionalDependencies,
    ];
    const versions = declarations
      .filter(object)
      .filter((d) => Object.hasOwn(d, name))
      .map((d) => d[name]);
    if (
      owner !== target &&
      !versions.some(
        (v) =>
          v === "*" ||
          v === "workspace:*" ||
          v === "workspace:^" ||
          v === "workspace:~" ||
          (typeof target.data.version === "string" &&
            v === target.data.version),
      )
    )
      return [];
    let entry: unknown;
    if (Object.hasOwn(target.data, "exports")) {
      const exports = target.data.exports;
      entry =
        typeof exports === "string" && subpath === "."
          ? exports
          : object(exports) &&
              Object.keys(exports).every((k) => k.startsWith(".")) &&
              Object.hasOwn(exports, subpath)
            ? exports[subpath]
            : undefined;
      if (typeof entry !== "string" || !entry.startsWith("./")) return [];
    } else {
      // Legacy deep imports and implicit index entry points remain unresolved.
      if (subpath !== ".") return [];
      entry = target.data.main;
    }
    if (
      typeof entry !== "string" ||
      path.posix.isAbsolute(entry) ||
      entry.includes("\\") ||
      entry.includes("%") ||
      entry.includes("*") ||
      entry.split("/").some((p) => p === ".." || p === "node_modules")
    )
      return [];
    return [path.posix.join(target.dir, entry)];
  };
}

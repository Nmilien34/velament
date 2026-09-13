import { it, expect, vi, afterEach } from "vitest";
vi.mock("../src/services/github-app.service.js", () => ({
  githubRequest: vi.fn(),
}));
import { githubRequest } from "../src/services/github-app.service.js";
import { readRepository } from "../src/services/github.service.js";
afterEach(() => vi.resetAllMocks());
it("indexes beyond forty files at the captured commit", async () => {
  vi.mocked(githubRequest).mockImplementation(async (path) => {
    if (path.includes("/commits/"))
      return { sha: "a".repeat(40), commit: { tree: { sha: "root" } } };
    if (path.includes("/trees/"))
      return {
        truncated: false,
        tree: Array.from({ length: 75 }, (_, i) => ({
          path: `src/file${i}.ts`,
          type: "blob",
          sha: `blob${i}`,
          size: 10,
        })),
      };
    return {
      content: Buffer.from("export {}").toString("base64"),
      encoding: "base64",
    };
  });
  const result = await readRepository("a", "b", "main", "token");
  expect(result.files).toHaveLength(75);
  expect(result.sha).toBe("a".repeat(40));
  expect(result.limitations.join(" ")).not.toContain("Some files");
});
it("recovers a truncated recursive tree using subtrees", async () => {
  vi.mocked(githubRequest).mockImplementation(async (path) => {
    if (path.includes("/commits/"))
      return { sha: "a".repeat(40), commit: { tree: { sha: "root" } } };
    if (path.endsWith("?recursive=1")) return { truncated: true, tree: [] };
    if (path.endsWith("/trees/root"))
      return {
        truncated: false,
        tree: [{ path: "src", type: "tree", sha: "child" }],
      };
    if (path.endsWith("/trees/child"))
      return {
        truncated: false,
        tree: [{ path: "index.ts", type: "blob", sha: "blob", size: 10 }],
      };
    return {
      content: Buffer.from("export {}").toString("base64"),
      encoding: "base64",
    };
  });
  const result = await readRepository("a", "b", "main", "token");
  expect(result.files[0]?.path).toBe("src/index.ts");
  expect(result.limitations).not.toContain("GitHub tree was truncated.");
});
it("rejects a blob whose real size exceeds the per-file budget", async () => {
  vi.mocked(githubRequest).mockImplementation(async (path) => {
    if (path.includes("/commits/"))
      return { sha: "a".repeat(40), commit: { tree: { sha: "root" } } };
    if (path.includes("/trees/"))
      return {
        truncated: false,
        tree: [{ path: "index.ts", type: "blob", sha: "blob", size: 10 }],
      };
    return {
      content: Buffer.alloc(100001).toString("base64"),
      encoding: "base64",
    };
  });
  const result = await readRepository("a", "b", "main", "token");
  expect(result.files).toHaveLength(0);
  expect(result.limitations.join(" ")).toContain("Some files");
});
it("captures workspace manifests while excluding dependency and build manifests", async () => {
  vi.mocked(githubRequest).mockImplementation(async (path) => {
    if (path.includes("/commits/"))
      return { sha: "a".repeat(40), commit: { tree: { sha: "root" } } };
    if (path.includes("/trees/"))
      return {
        truncated: false,
        tree: [
          "package.json",
          "packages/core/package.json",
          "node_modules/core/package.json",
          "dist/package.json",
        ].map((path) => ({ path, type: "blob", sha: path, size: 2 })),
      };
    return {
      content: Buffer.from("{}").toString("base64"),
      encoding: "base64",
    };
  });
  expect(
    (await readRepository("a", "b", "main", "token")).files.map((f) => f.path),
  ).toEqual(["package.json", "packages/core/package.json"]);
});

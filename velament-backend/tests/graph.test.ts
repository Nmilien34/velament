import { expect, it } from "vitest";
import { buildEdges, locateTrace } from "../src/services/graph.service.js";
const files = [
  {
    path: "src/a.ts",
    content: "import { b } from './b.js';\nexport const a = b;",
    hash: "a",
  },
  { path: "src/b.ts", content: "export const b = 1;", hash: "b" },
];
it("maps literal dynamic imports and CommonJS references without inventing variable targets", () => {
  const result = buildEdges([
    {
      path: "main.ts",
      hash: "a",
      content:
        "import('./lazy.mjs');\nconst x = require('./legacy.cjs');\nimport(variable);",
    },
    { path: "lazy.mts", hash: "b", content: "export {};" },
    { path: "legacy.cts", hash: "c", content: "export {};" },
  ]);
  expect(result.map((e) => [e.to, e.line])).toEqual([
    ["lazy.mts", 1],
    ["legacy.cts", 2],
  ]);
});
it("resolves relative TypeScript imports with source lines", () =>
  expect(buildEdges(files)).toEqual([
    { from: "src/a.ts", to: "src/b.ts", kind: "import", line: 1 },
  ]));
it("preserves repeated stack frames and invalid line evidence", () => {
  const frames = locateTrace(
    "at /app/src/a.ts:2:1\nat /app/src/a.ts:99:1",
    files,
  );
  expect(frames).toHaveLength(2);
  expect(frames[0]?.lineAvailable).toBe(true);
  expect(frames[1]?.lineAvailable).toBe(false);
});
it("keeps manual context distinct from trace evidence", () =>
  expect(locateTrace("unmatched", files, "src/b.ts")[0]?.provenance).toBe(
    "manual",
  ));
it("does not treat suffix filenames as exact matches", () =>
  expect(locateTrace("at /app/not-src/a.ts:2:1", files)).toEqual([]));
it("resolves configured aliases against captured source", () => {
  const source = [
    {
      path: "tsconfig.json",
      hash: "c",
      content: '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}',
    },
    { path: "src/a.ts", hash: "a", content: "import '@/b';" },
    { path: "src/b.ts", hash: "b", content: "export {};" },
  ];
  expect(buildEdges(source)).toEqual([
    { from: "src/a.ts", to: "src/b.ts", kind: "import", line: 1 },
  ]);
  expect(
    buildEdges([
      {
        ...source[0]!,
        content:
          '{"extends":"./base.json","compilerOptions":{"paths":{"@/*":["src/*"]}}}',
      },
      ...source.slice(1),
    ]),
  ).toEqual([]);
});
it("uses the closest config and rejects targets outside the snapshot root", () => {
  const files = [
    {
      path: "tsconfig.json",
      hash: "1",
      content: '{"compilerOptions":{"paths":{"@/*":["root/*"]}}}',
    },
    {
      path: "app/tsconfig.json",
      hash: "2",
      content:
        '{"compilerOptions":{"paths":{"@/*":["src/*"],"bad":["../../escape"]}}}',
    },
    { path: "app/main.ts", hash: "3", content: "import '@/x'; import 'bad';" },
    { path: "app/src/x.ts", hash: "4", content: "export {};" },
    { path: "root/x.ts", hash: "5", content: "export {};" },
  ];
  expect(buildEdges(files).map((e) => e.to)).toEqual(["app/src/x.ts"]);
});
it("resolves relative config inheritance and refuses cycles", () => {
  const config = {
    path: "app/tsconfig.json",
    hash: "c",
    content: '{"extends":"../tsconfig.base.json"}',
  };
  const base = {
    path: "tsconfig.base.json",
    hash: "b",
    content: '{"compilerOptions":{"paths":{"@/*":["src/*"]}}}',
  };
  const files = [
    config,
    base,
    { path: "app/main.ts", hash: "m", content: "import '@/x';" },
    { path: "src/x.ts", hash: "x", content: "export {};" },
  ];
  expect(buildEdges(files).map((e) => e.to)).toEqual(["src/x.ts"]);
  expect(
    buildEdges([
      config,
      { ...base, content: '{"extends":"./app/tsconfig.json"}' },
      ...files.slice(2),
    ]),
  ).toEqual([]);
});
it("resolves baseUrl imports without explicit aliases", () => {
  const files = [
    {
      path: "tsconfig.json",
      hash: "c",
      content: '{"compilerOptions":{"baseUrl":"src"}}',
    },
    { path: "main.ts", hash: "m", content: "import 'utils';" },
    { path: "src/utils.ts", hash: "u", content: "export {};" },
  ];
  expect(buildEdges(files).map((e) => e.to)).toEqual(["src/utils.ts"]);
  expect(
    buildEdges([
      { ...files[0]!, content: '{"compilerOptions":{"baseUrl":"../outside"}}' },
      ...files.slice(1),
    ]),
  ).toEqual([]);
});

const workspaceFiles = (
  exports: unknown = { ".": "./src/index.ts", "./utils": "./src/utils.ts" },
) => [
  {
    path: "package.json",
    hash: "r",
    content: JSON.stringify({
      workspaces: ["packages/*"],
      dependencies: { "@app/core": "*" },
    }),
  },
  {
    path: "packages/core/package.json",
    hash: "p",
    content: JSON.stringify({ name: "@app/core", exports }),
  },
  {
    path: "main.ts",
    hash: "m",
    content:
      "import '@app/core'; import '@app/core/utils'; import '@app/core/private';",
  },
  { path: "packages/core/src/index.ts", hash: "i", content: "export {};" },
  { path: "packages/core/src/utils.ts", hash: "u", content: "export {};" },
  { path: "packages/core/private.ts", hash: "x", content: "export {};" },
];
it("connects declared workspace exports without exposing private subpaths", () => {
  expect(buildEdges(workspaceFiles()).map((e) => e.to)).toEqual([
    "packages/core/src/index.ts",
    "packages/core/src/utils.ts",
  ]);
});
it("does not guess conditional, escaping, missing or duplicate workspace targets", () => {
  for (const exports of [
    { browser: "./src/index.ts" },
    "../main.ts",
    "./missing.ts",
    null,
  ]) {
    expect(buildEdges(workspaceFiles(exports))).toEqual([]);
  }
  const files = workspaceFiles();
  expect(
    buildEdges([
      ...files,
      { ...files[1]!, path: "packages/duplicate/package.json" },
    ]),
  ).toEqual([]);
  expect(
    buildEdges([
      { ...files[0]!, content: '{"workspaces":["packages/*"]}' },
      ...files.slice(1),
    ]),
  ).toEqual([]);
});
it("uses a declared workspace main when exports is absent", () => {
  const files = workspaceFiles();
  files[1] = {
    ...files[1]!,
    content: '{"name":"@app/core","main":"./src/index.js"}',
  };
  expect(buildEdges(files).map((e) => e.to)).toEqual([
    "packages/core/src/index.ts",
  ]);
});
it("requires workspace membership and uses the importing package dependency declaration", () => {
  const files = workspaceFiles();
  expect(
    buildEdges([
      { ...files[0]!, content: '{"dependencies":{"@app/core":"*"}}' },
      ...files.slice(1),
    ]),
  ).toEqual([]);
  expect(
    buildEdges([
      ...files.filter((f) => f.path !== "main.ts"),
      {
        path: "app/package.json",
        hash: "a",
        content: '{"dependencies":{"@app/core":"^99.0.0"}}',
      },
      { ...files[2]!, path: "app/main.ts" },
    ]),
  ).toEqual([]);
});
it("does not replace Node builtins with same-named workspace packages", () => {
  const files = workspaceFiles();
  files[0] = {
    ...files[0]!,
    content: '{"workspaces":["packages/*"],"dependencies":{"fs":"*"}}',
  };
  files[1] = { ...files[1]!, content: '{"name":"fs","main":"./src/index.ts"}' };
  files[2] = { ...files[2]!, content: "import 'fs';" };
  expect(buildEdges(files)).toEqual([]);
});
it("resolves workspace export patterns while preserving exact blocks", () => {
  const files = workspaceFiles({ "./*": "./src/*.ts", "./private": null });
  expect(buildEdges(files).map((e) => e.to)).toEqual([
    "packages/core/src/utils.ts",
  ]);
});
it("chooses the most specific workspace export pattern and rejects traversal", () => {
  const files = workspaceFiles({
    "./*": "./*.ts",
    "./u*": "./src/u*.ts",
  });
  files[2] = {
    ...files[2]!,
    content: "import '@app/core/utils'; import '@app/core/../main';",
  };
  expect(buildEdges(files).map((e) => e.to)).toEqual([
    "packages/core/src/utils.ts",
  ]);
});
it("selects conditional workspace exports by import syntax", () => {
  const files = workspaceFiles({
    import: "./src/index.ts",
    require: "./src/utils.ts",
  });
  files[2] = {
    ...files[2]!,
    content: "import '@app/core'; require('@app/core'); import('@app/core');",
  };
  expect(buildEdges(files).map((e) => e.to)).toEqual([
    "packages/core/src/index.ts",
    "packages/core/src/utils.ts",
    "packages/core/src/index.ts",
  ]);
});
it("keeps unknown conditions unresolved and respects an earlier default", () => {
  const files = workspaceFiles({
    default: "./src/utils.ts",
    import: "./src/index.ts",
  });
  expect(buildEdges(files).map((e) => e.to)).toEqual([
    "packages/core/src/utils.ts",
  ]);
});
it("resolves nested export conditions and never falls through explicit blocks", () => {
  const files = workspaceFiles({
    ".": { import: { default: "./src/index.ts" }, default: "./src/utils.ts" },
  });
  expect(buildEdges(files).map((e) => e.to)).toEqual([
    "packages/core/src/index.ts",
  ]);
  expect(
    buildEdges(workspaceFiles({ import: null, default: "./src/index.ts" })),
  ).toEqual([]);
  expect(
    buildEdges(
      workspaceFiles({ browser: "./src/utils.ts", default: "./src/index.ts" }),
    ),
  ).toEqual([]);
});

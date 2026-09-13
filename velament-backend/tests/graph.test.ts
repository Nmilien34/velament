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

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

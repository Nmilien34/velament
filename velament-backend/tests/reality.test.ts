import { expect, it } from "vitest";
import { inspectReality } from "../src/services/reality.service.js";
it("reports anchored signals without treating comments or constants as runtime proof", () => {
  const result = inspectReality([
    {
      path: "src/a.ts",
      hash: "a",
      content:
        "const timeout = 3600000;\nconst data = await request.json();\nvi.mock('./mail');\nthrow new Error('Not implemented');\n// fetch('/fake')",
    },
  ]);
  expect(result.findings.map((f) => f.kind)).toEqual([
    "hardcoded",
    "dynamic",
    "mocked",
    "placeholder",
  ]);
  expect(result.findings.map((f) => f.line)).toEqual([1, 2, 3, 4]);
  expect(result.verification).toBe("not-established");
  expect(
    inspectReality([
      { path: "empty.ts", hash: "b", content: "export function f() {}" },
    ]).findings,
  ).toEqual([]);
});
it("keeps IDs stable for the same evidence and changes them with source", () => {
  const file = { path: "a.ts", hash: "a", content: "const n = 1;" };
  expect(inspectReality([file])).toEqual(inspectReality([file]));
  expect(inspectReality([file]).findings[0]?.id).not.toBe(
    inspectReality([{ ...file, hash: "b" }]).findings[0]?.id,
  );
});

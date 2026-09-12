import { expect, it } from "vitest";
import {
  discoverCandidates,
  assessFeature,
} from "../src/services/feature-evidence.service.js";
const files = [
  {
    path: "src/signup.ts",
    content: "export function signup() { return true; }",
    hash: "one",
  },
  {
    path: "src/app.ts",
    content: "import { signup } from './signup';",
    hash: "two",
  },
];
it("finds source candidates without claiming verified product features", () => {
  const result = discoverCandidates(files);
  expect(result).toEqual([
    expect.objectContaining({
      title: "signup",
      path: "src/signup.ts",
      line: 1,
      provenance: "static-export",
      verification: "unverified",
    }),
  ]);
});
it("keeps implementation, connection and proof separate", () => {
  const report = assessFeature(
    { paths: ["src/signup.ts"], requirement: "Users can sign up" },
    files,
    [{ from: "src/app.ts", to: "src/signup.ts", kind: "import", line: 1 }],
  );
  expect(report.implementation).toBe("source-present");
  expect(report.connection).toBe("incoming-imports-found");
  expect(report.proof).toBe("not-established");
});
it("treats absent source as unavailable, not a confirmed missing feature", () => {
  const report = assessFeature(
    { paths: ["missing.ts"], requirement: "Reset password" },
    files,
    [],
  );
  expect(report.implementation).toBe("source-unavailable");
  expect(report.missingPaths).toEqual(["missing.ts"]);
  expect(report.prompt).toContain(
    "Do not assume unavailable source is missing from the full repository",
  );
});
it("does not mistake internal edges for external feature wiring", () => {
  const report = assessFeature(
    { paths: ["src/signup.ts", "src/app.ts"], requirement: "Signup works" },
    files,
    [{ from: "src/app.ts", to: "src/signup.ts", kind: "import", line: 1 }],
  );
  expect(report.connection).toBe("no-incoming-imports-observed");
  expect(report.limitations.join(" ")).toContain("entry points");
});
it("makes empty scope explicitly unmapped", () => {
  expect(
    assessFeature({ paths: [], requirement: "Signup works" }, files, [])
      .implementation,
  ).toBe("unmapped");
});

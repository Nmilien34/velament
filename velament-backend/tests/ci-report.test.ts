import { expect, it } from "vitest";
import { createCiReport } from "../src/services/ci-report.service.js";
it("creates conservative file summaries tied to commit and attempt", () => {
  const report = createCiReport(
    {
      success: false,
      testResults: [
        {
          name: "/repo/tests/a.test.ts",
          status: "passed",
          assertionResults: [{ status: "passed" }],
        },
        {
          name: "/repo/tests/b.test.ts",
          status: "passed",
          assertionResults: [{ status: "pending" }],
        },
        {
          name: "/repo/tests/c.test.ts",
          status: "failed",
          assertionResults: [],
        },
      ],
    },
    "a".repeat(40),
    2,
  );
  expect(report.attempt).toBe(2);
  expect(report.tests.map((t) => t.outcome)).toEqual([
    "passed",
    "skipped",
    "failed",
  ]);
  expect(report.tests[0]?.name).toBe("Test file: a.test.ts");
});
it("rejects invalid reports instead of publishing success", () => {
  expect(() => createCiReport({}, "a".repeat(40), 1)).toThrow();
  expect(() =>
    createCiReport({ testResults: [] }, "a".repeat(40), 1),
  ).toThrow();
});

it("rejects run-level failures even when all file results passed", () => {
  expect(() =>
    createCiReport(
      {
        success: false,
        testResults: [
          {
            name: "a.test.ts",
            status: "passed",
            assertionResults: [{ status: "passed" }],
          },
        ],
      },
      "a".repeat(40),
      1,
    ),
  ).toThrow();
});

it("keeps duplicate basenames distinct using repository-relative paths", () => {
  const report = createCiReport(
    {
      success: true,
      testResults: ["unit/auth.test.ts", "integration/auth.test.ts"].map(
        (name) => ({
          name: "/repo/" + name,
          status: "passed",
          assertionResults: [{ status: "passed" }],
        }),
      ),
    },
    "a".repeat(40),
    1,
    "/repo",
  );
  expect(report.tests.map((t) => t.name)).toEqual([
    "Test file: unit/auth.test.ts",
    "Test file: integration/auth.test.ts",
  ]);
});
it("rejects test paths outside the selected repository", () => {
  expect(() =>
    createCiReport(
      {
        success: true,
        testResults: [
          {
            name: "/outside/auth.test.ts",
            status: "passed",
            assertionResults: [],
          },
        ],
      },
      "a".repeat(40),
      1,
      "/repo",
    ),
  ).toThrow();
});

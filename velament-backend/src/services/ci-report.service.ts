import path from "node:path";
import { z } from "zod";
import { testReportInput } from "@velament/shared";
const resultsSchema = z.object({
  success: z.boolean(),
  testResults: z
    .array(
      z.object({
        name: z.string(),
        status: z.enum(["passed", "failed", "pending", "todo", "skipped"]),
        assertionResults: z.array(
          z.object({
            status: z.enum([
              "passed",
              "failed",
              "pending",
              "todo",
              "skipped",
              "disabled",
            ]),
          }),
        ),
      }),
    )
    .min(1)
    .max(100),
});
export function createCiReport(
  value: unknown,
  sha: string,
  attempt: number,
  repositoryRoot?: string,
) {
  const results = resultsSchema.parse(value);
  const fileLabel = (name: string) => {
    if (!repositoryRoot) return path.basename(name);
    const relative = path.relative(
      repositoryRoot,
      path.resolve(repositoryRoot, name),
    );
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(".." + path.sep) ||
      path.isAbsolute(relative)
    )
      throw new Error("Test file is outside the report repository root");
    return relative.split(path.sep).join("/");
  };
  const { runId: _runId, ...report } = testReportInput.parse({
    runId: "0".repeat(24),
    sha,
    attempt,
    environment: "github-actions",
    mockedBoundaries: [
      "Suite-level summary; tests may mock external providers. No feature coverage is established.",
    ],
    tests: results.testResults.map((result) => ({
      name: "Test file: " + fileLabel(result.name),
      outcome:
        result.status === "failed" ||
        result.assertionResults.some((t) => t.status === "failed")
          ? "failed"
          : result.status === "passed" &&
              result.assertionResults.length > 0 &&
              result.assertionResults.every((t) => t.status === "passed")
            ? "passed"
            : "skipped",
    })),
  });
  if (
    !results.success &&
    !report.tests.some((test) => test.outcome === "failed")
  )
    throw new Error(
      "Run-level failure is not represented by test-file outcomes; no evidence report was generated",
    );
  return report;
}

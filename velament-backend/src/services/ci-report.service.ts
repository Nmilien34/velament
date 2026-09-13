import path from "node:path";
import { z } from "zod";
import { testReportInput } from "@velament/shared";
const resultsSchema = z.object({
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
export function createCiReport(value: unknown, sha: string, attempt: number) {
  const results = resultsSchema.parse(value);
  const { runId: _runId, ...report } = testReportInput.parse({
    runId: "0".repeat(24),
    sha,
    attempt,
    environment: "github-actions",
    mockedBoundaries: [
      "Suite-level summary; tests may mock external providers. No feature coverage is established.",
    ],
    tests: results.testResults.map((result) => ({
      name: "Test file: " + path.basename(result.name),
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
  return report;
}

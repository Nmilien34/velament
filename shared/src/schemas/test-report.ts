import { z } from "zod";
export const testReportInput = z
  .object({
    runId: z.string().regex(/^[a-f0-9]{24}$/i),
    attempt: z.number().int().positive(),
    sha: z.string().regex(/^[a-f0-9]{40}$/),
    environment: z.string().trim().min(1).max(100),
    mockedBoundaries: z.array(z.string().trim().min(1).max(300)).max(50),
    tests: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(300),
            outcome: z.enum(["passed", "failed", "skipped"]),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine(
    (v) => new Set(v.tests.map((t) => t.name)).size === v.tests.length,
    "Test names must be unique",
  );
export type TestReportInput = z.infer<typeof testReportInput>;

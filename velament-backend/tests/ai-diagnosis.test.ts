import { describe, it, expect } from "vitest";
import { validateDiagnosis } from "../src/services/ai-diagnosis.service.js";
const files = [{ path: "user.ts", content: "return user.email;", hash: "a" }];
const report = {
  causes: [
    {
      title: "Missing user",
      description: "The lookup may return null",
      references: [{ path: "user.ts", line: 1, quote: "user.email" }],
    },
  ],
  nextSteps: ["Reproduce with a missing user"],
  limitations: ["No execution evidence"],
};
describe("AI diagnosis grounding", () => {
  it("accepts cited hypotheses", () => {
    expect(validateDiagnosis(report, files).causes).toHaveLength(1);
  });
  it("rejects fabricated locations", () => {
    expect(() =>
      validateDiagnosis(
        {
          ...report,
          causes: [
            {
              ...report.causes[0],
              references: [{ path: "other.ts", line: 1, quote: "user.email" }],
            },
          ],
        },
        files,
      ),
    ).toThrow();
  });
  it("allows insufficient evidence without inventing a cause", () => {
    expect(validateDiagnosis({ ...report, causes: [] }, files).causes).toEqual(
      [],
    );
  });
});

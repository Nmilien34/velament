import { describe, it, expect } from "vitest";
import {
  validateDiscovery,
  prepareSource,
} from "../src/services/ai-discovery.service.js";
const files = [
  { path: "src/signup.ts", content: "export function signup() {}", hash: "a" },
];
const finding = {
  features: [
    {
      title: "Signup",
      description: "Creates an account",
      references: [
        {
          path: "src/signup.ts",
          line: 1,
          quote: "export function signup() {}",
        },
      ],
    },
  ],
  limitations: [],
};
describe("AI source grounding", () => {
  it("accepts exact references but never assigns runtime proof", () => {
    expect(validateDiscovery(finding, files).features).toHaveLength(1);
  });
  it("rejects invented files, lines and quotations", () => {
    for (const reference of [
      { path: "fake.ts", line: 1, quote: "x" },
      { path: "src/signup.ts", line: 9, quote: "x" },
      { path: "src/signup.ts", line: 1, quote: "made up" },
    ])
      expect(() =>
        validateDiscovery(
          {
            ...finding,
            features: [{ ...finding.features[0], references: [reference] }],
          },
          files,
        ),
      ).toThrow();
  });
  it("rejects empty and oversized input before contacting a provider", () => {
    expect(() => prepareSource([])).toThrow();
    expect(() =>
      prepareSource([{ ...files[0]!, content: "x".repeat(80001) }]),
    ).toThrow();
  });
});

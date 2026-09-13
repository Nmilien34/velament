import { expect, it } from "vitest";
import { summarizeDiscovery } from "../src/services/discovery-summary.service.js";
const files = [
  { path: "a.ts", content: "signup();", hash: "a" },
  { path: "b.ts", content: "register();", hash: "b" },
];
const batch = (id: string, path: string, title: string, quote: string) => ({
  id,
  paths: [path],
  status: "completed",
  result: {
    features: [
      { title, description: id, references: [{ path, line: 1, quote }] },
    ],
    limitations: [],
  },
});
it("groups matching names while retaining independent evidence and descriptions", () => {
  const result = summarizeDiscovery(
    [
      batch("one", "a.ts", "Sign up", "signup();"),
      batch("two", "b.ts", " sign   UP ", "register();"),
    ],
    files,
  );
  expect(result.groups).toHaveLength(1);
  expect(result.groups[0]?.candidates.map((c) => c.batchId)).toEqual([
    "one",
    "two",
  ]);
  expect(result.groups[0]?.candidates.map((c) => c.description)).toEqual([
    "one",
    "two",
  ]);
  expect(result.groups[0]?.verification).toBe("unverified");
});
it("rejects invalid evidence and excludes unfinished batches", () => {
  const result = summarizeDiscovery(
    [
      batch("bad", "a.ts", "Signup", "invented"),
      {
        ...batch("pending", "b.ts", "Signup", "register();"),
        status: "pending",
      },
    ],
    files,
  );
  expect(result.groups).toEqual([]);
  expect(result.rejectedBatchIds).toEqual(["bad"]);
});
it("does not accept citations outside the originating batch", () => {
  const value = batch("one", "a.ts", "Signup", "register();");
  value.result.features[0]!.references[0]!.path = "b.ts";
  expect(summarizeDiscovery([value], files).rejectedBatchIds).toEqual(["one"]);
});
it("keeps differently named hypotheses separate", () => {
  expect(
    summarizeDiscovery(
      [
        batch("one", "a.ts", "Signup", "signup();"),
        batch("two", "b.ts", "Registration", "register();"),
      ],
      files,
    ).groups,
  ).toHaveLength(2);
});

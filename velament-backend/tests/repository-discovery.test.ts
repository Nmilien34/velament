import { expect, it } from "vitest";
import { planRepositoryDiscovery } from "../src/services/repository-discovery.service.js";
import { prepareSource } from "../src/services/ai-discovery.service.js";
const file = (path: string, content = "export {};") => ({
  path,
  content,
  hash: path,
});
it("covers snapshots larger than 40 files in deterministic bounded batches", () => {
  const files = Array.from({ length: 95 }, (_, i) => file(`src/${i}.ts`));
  const plan = planRepositoryDiscovery(files);
  expect(plan.batches).toHaveLength(3);
  expect(plan.batches.flatMap((b) => b.paths).sort()).toEqual(
    files.map((f) => f.path).sort(),
  );
  expect(planRepositoryDiscovery([...files].reverse())).toEqual(plan);
  for (const batch of plan.batches)
    expect(() =>
      prepareSource(files.filter((f) => batch.paths.includes(f.path))),
    ).not.toThrow();
});
it("reports oversized files and never silently truncates their source", () => {
  const plan = planRepositoryDiscovery([
    file("large.ts", "x".repeat(80001)),
    file("ok.ts"),
  ]);
  expect(plan.skipped).toEqual([
    { path: "large.ts", reason: "file-exceeds-batch-limit" },
  ]);
  expect(plan.batches[0]?.paths).toEqual(["ok.ts"]);
});
it("honors byte limits for multibyte text", () => {
  const files = Array.from({ length: 4 }, (_, i) =>
    file(`${i}.ts`, "🙂".repeat(10000)),
  );
  const plan = planRepositoryDiscovery(files);
  expect(plan.batches).toHaveLength(4);
});
it("handles empty snapshots without suggesting an analysis", () => {
  expect(planRepositoryDiscovery([])).toEqual({ batches: [], skipped: [] });
});

it("splits large files without losing lines or resetting citations", async () => {
  const { batchSource } = await import("../src/services/discovery-source.js");
  const { validateDiscovery } =
    await import("../src/services/ai-discovery.service.js");
  const files = [
    file(
      "big.ts",
      Array.from(
        { length: 1000 },
        (_, i) => `line${i} ${"x".repeat(100)}`,
      ).join("\n"),
    ),
  ];
  const plan = planRepositoryDiscovery(files);
  expect(plan.skipped).toEqual([]);
  expect(plan.batches.length).toBeGreaterThan(1);
  const parts = plan.batches.map((b) => batchSource(files, b)[0]!);
  expect(parts.map((p) => p.content).join("\n")).toBe(files[0]!.content);
  for (const part of parts) {
    expect(prepareSource([part])[0]?.lines[0]?.line).toBe(part.startLine);
    const result = {
      features: [
        {
          title: "Test",
          description: "Test",
          references: [
            {
              path: part.path,
              line: part.startLine!,
              quote: part.content.split("\n")[0]!,
            },
          ],
        },
      ],
      limitations: [],
    };
    expect(() => validateDiscovery(result, [part])).not.toThrow();
  }
  const last = parts.at(-1)!;
  expect(() =>
    validateDiscovery(
      {
        features: [
          {
            title: "Test",
            description: "Test",
            references: [{ path: last.path, line: 1, quote: "line0" }],
          },
        ],
        limitations: [],
      },
      [last],
    ),
  ).toThrow();
});

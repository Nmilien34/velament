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

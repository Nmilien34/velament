import { readFile, writeFile } from "node:fs/promises";
import { createCiReport } from "../services/ci-report.service.js";
const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw new Error("Expected input and output report paths");
const report = createCiReport(
  JSON.parse(await readFile(input, "utf8")),
  process.env.GITHUB_SHA ?? "",
  Number(process.env.GITHUB_RUN_ATTEMPT),
  process.cwd(),
);
await writeFile(output, JSON.stringify(report, null, 2));

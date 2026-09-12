import { config } from "dotenv";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, mkdir, rm, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
config({ path: ".env", quiet: true });
const uri = process.env.MONGODB_URI,
  directory = process.env.BACKUP_DIRECTORY;
if (!uri || !directory || !path.isAbsolute(directory))
  throw new Error("Set MONGODB_URI and absolute BACKUP_DIRECTORY");
process.umask(0o077);
await mkdir(directory, { recursive: true, mode: 0o700 });
const temporary = await mkdtemp(path.join(tmpdir(), "velament-backup-"));
const output = path.join(
  directory,
  "velament-" + new Date().toISOString().replaceAll(":", "-") + ".archive.gz",
);
try {
  const settings = path.join(temporary, "config.yml");
  await writeFile(settings, "uri: " + JSON.stringify(uri) + "\n", {
    mode: 0o600,
  });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "mongodump",
      ["--config", settings, "--archive=" + output + ".partial", "--gzip"],
      { stdio: "ignore" },
    );
    child.once("error", () => reject(new Error("mongodump could not start")));
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              "Backup failed; inspect database connectivity and permissions",
            ),
          ),
    );
  });
  await rename(output + ".partial", output);
  console.log("Backup completed: " + path.basename(output));
} finally {
  await rm(temporary, { recursive: true, force: true });
  await rm(output + ".partial", { force: true });
}

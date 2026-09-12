import { githubRequest } from "./github-app.service.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { SourceFile } from "@velament/shared";
import { HttpError } from "../utils/errors.js";
export async function githubGet(endpoint: string, token?: string) {
  if (token) return githubRequest(endpoint, token);
  const response = await fetch("https://api.github.com" + endpoint, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Velament",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  if (!response.ok)
    throw new HttpError(
      response.status === 404 ? 404 : 502,
      "GITHUB_UNAVAILABLE",
      response.status === 404
        ? "Public repository or branch not found"
        : "GitHub request failed or rate limit reached; retry later",
    );
  return response.json() as Promise<unknown>;
}
export async function readRepository(
  owner: string,
  repo: string,
  branch: string,
  token: string,
) {
  const base =
    "/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo);
  const commit = z
    .object({
      sha: z.string(),
      commit: z.object({ tree: z.object({ sha: z.string() }) }),
    })
    .parse(
      await githubGet(base + "/commits/" + encodeURIComponent(branch), token),
    );
  const tree = z
    .object({
      truncated: z.boolean(),
      tree: z.array(
        z.object({
          path: z.string(),
          type: z.string(),
          sha: z.string(),
          size: z.number().optional(),
        }),
      ),
    })
    .parse(
      await githubGet(
        base + "/git/trees/" + commit.commit.tree.sha + "?recursive=1",
        token,
      ),
    );
  const candidates = tree.tree.filter(
    (f) =>
      f.type === "blob" &&
      /\.(tsx?|jsx?|mts|cts)$/.test(f.path) &&
      !/(^|\/)(node_modules|dist|build|vendor)\//.test(f.path),
  );
  const selected = candidates
    .filter((f) => (f.size ?? Infinity) <= 50000)
    .slice(0, 40);
  const files: SourceFile[] = [];
  let bytes = 0;
  for (const entry of selected) {
    const blob = z
      .object({ content: z.string(), encoding: z.literal("base64") })
      .parse(await githubGet(base + "/git/blobs/" + entry.sha, token));
    const content = Buffer.from(blob.content, "base64").toString("utf8");
    bytes += Buffer.byteLength(content);
    if (bytes > 2000000) break;
    files.push({
      path: entry.path,
      content,
      hash: createHash("sha256").update(content).digest("hex"),
    });
  }
  const limitations = [
    "Static relative import graph only. No runtime execution, call tracing, alias resolution, or AI inference.",
    "Only TypeScript and JavaScript source is analyzed.",
  ];
  if (tree.truncated) limitations.push("GitHub tree was truncated.");
  if (candidates.length > files.length)
    limitations.push(
      "Some files exceeded the 40-file / 50 KB per-file / 2 MB snapshot limits.",
    );
  return {
    sha: commit.sha,
    files,
    limitations,
    state: files.length ? ("partial" as const) : ("empty" as const),
  };
}

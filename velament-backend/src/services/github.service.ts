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
  control?: { checkpoint: () => Promise<void> },
) {
  const get = async (endpoint: string, credential: string) => {
    await control?.checkpoint();
    return githubGet(endpoint, credential);
  };
  const base =
    "/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo);
  const commit = z
    .object({
      sha: z.string(),
      commit: z.object({ tree: z.object({ sha: z.string() }) }),
    })
    .parse(await get(base + "/commits/" + encodeURIComponent(branch), token));
  let tree = z
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
      await get(
        base + "/git/trees/" + commit.commit.tree.sha + "?recursive=1",
        token,
      ),
    );
  if (tree.truncated) {
    // GitHub recommends fetching individual subtrees when recursion truncates.
    const pending = [{ sha: commit.commit.tree.sha, prefix: "" }];
    const entries: typeof tree.tree = [];
    let requests = 0;
    let incomplete = false;
    while (pending.length && requests < 200 && entries.length < 100000) {
      const current = pending.shift()!;
      const subtree = z
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
        .parse(await get(base + "/git/trees/" + current.sha, token));
      requests++;
      incomplete ||= subtree.truncated;
      for (const entry of subtree.tree) {
        const path = current.prefix + entry.path;
        if (/(^|\/)(node_modules|dist|build|vendor)(\/|$)/.test(path)) continue;
        if (entry.type === "tree")
          pending.push({ sha: entry.sha, prefix: path + "/" });
        else entries.push({ ...entry, path });
      }
    }
    tree = { tree: entries, truncated: incomplete || pending.length > 0 };
  }
  const candidates = tree.tree.filter(
    (f) =>
      f.type === "blob" &&
      (/\.(tsx?|jsx?|mts|cts|mjs|cjs)$/.test(f.path) ||
        /(^|\/)(tsconfig|jsconfig)(\.[^/]+)?\.json$/.test(f.path)) &&
      !/(^|\/)(node_modules|dist|build|vendor)\//.test(f.path),
  );
  const selected = candidates
    .filter((f) => (f.size ?? Infinity) <= 100000)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .slice(0, 500);
  const files: SourceFile[] = [];
  let bytes = 0;
  for (const entry of selected) {
    const blob = z
      .object({ content: z.string(), encoding: z.literal("base64") })
      .parse(await get(base + "/git/blobs/" + entry.sha, token));
    const content = Buffer.from(blob.content, "base64").toString("utf8");
    const size = Buffer.byteLength(content);
    if (size > 100000 || bytes + size > 4000000) continue;
    bytes += size;
    files.push({
      path: entry.path,
      content,
      hash: createHash("sha256").update(content).digest("hex"),
    });
  }
  const limitations = [
    "Static relative import graph only. No runtime execution, call tracing, alias resolution, or AI inference.",
    "Only TypeScript and JavaScript source is analyzed.",
    "Literal relative dynamic imports and require calls are mapped as static references; runtime execution and require symbol binding are not verified.",
  ];
  if (tree.truncated) limitations.push("GitHub tree was truncated.");
  if (candidates.length > files.length)
    limitations.push(
      "Some files exceeded the 500-file / 100 KB per-file / 4 MB snapshot limits.",
    );
  return {
    sha: commit.sha,
    files,
    limitations,
    state: files.length ? ("partial" as const) : ("empty" as const),
  };
}

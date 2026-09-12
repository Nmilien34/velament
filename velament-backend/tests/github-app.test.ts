import { afterEach, it, expect, vi } from "vitest";
import {
  encrypt,
  decrypt,
  githubRequest,
  repositoryToken,
} from "../src/services/github-app.service.js";
import { GitHubConnection } from "../src/models/GitHubConnection.js";
function configure() {
  for (const [key, value] of Object.entries({
    GITHUB_APP_ID: "1",
    GITHUB_APP_CLIENT_ID: "client",
    GITHUB_APP_CLIENT_SECRET: "secret",
    GITHUB_APP_PRIVATE_KEY: "test",
    GITHUB_APP_CALLBACK_URL: "http://localhost/callback",
    TOKEN_ENCRYPTION_KEY: "a".repeat(64),
  }))
    vi.stubEnv(key, value);
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("encrypts with randomized authenticated encryption", () => {
  configure();
  const a = encrypt("secret-token"),
    b = encrypt("secret-token");
  expect(a).not.toBe(b);
  expect(decrypt(a)).toBe("secret-token");
  const damaged = Buffer.from(a, "base64");
  damaged[15] = damaged[15]! ^ 1;
  expect(() => decrypt(damaged.toString("base64"))).toThrow();
});
it("sends credentials only to the fixed GitHub API host", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ id: 1 }) });
  vi.stubGlobal("fetch", fetcher);
  await githubRequest("/user", "secret");
  expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.github.com/user");
  expect(fetcher.mock.calls[0]?.[1].redirect).toBe("error");
});
it("does not issue installation tokens without user repository access", async () => {
  configure();
  vi.spyOn(GitHubConnection, "findOne").mockReturnValue({
    select: async () => ({ token: encrypt("user-token") }),
  } as never);
  const fetcher = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ repositories: [{ id: 12 }] }),
  });
  vi.stubGlobal("fetch", fetcher);
  vi.spyOn(GitHubConnection, "findOneAndUpdate").mockReturnValue({
    select: async () => null,
  } as never);
  await expect(repositoryToken("user", 1, 99)).rejects.toMatchObject({
    status: 403,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("requires reconnect when stored authorization has expired", async () => {
  vi.spyOn(GitHubConnection, "findOne").mockReturnValue({
    select: async () => null,
  } as never);
  vi.spyOn(GitHubConnection, "findOneAndUpdate").mockReturnValue({
    select: async () => null,
  } as never);
  await expect(repositoryToken("user", 1, 99)).rejects.toMatchObject({
    code: "GITHUB_RECONNECT_REQUIRED",
  });
});

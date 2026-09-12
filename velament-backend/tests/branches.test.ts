import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../src/models/Project.js", () => ({
  Project: { findOne: vi.fn(), updateOne: vi.fn() },
}));
vi.mock("../src/services/github-app.service.js", () => ({
  repositoryToken: vi.fn(),
  githubRequest: vi.fn(),
}));
import { Project } from "../src/models/Project.js";
import {
  repositoryToken,
  githubRequest,
} from "../src/services/github-app.service.js";
import {
  listBranches,
  refreshProjectConnection,
} from "../src/services/project-status.service.js";
beforeEach(() => vi.resetAllMocks());
it("revalidates repository access and returns a bounded branch page", async () => {
  vi.mocked(Project.findOne).mockResolvedValue({
    userId: "user",
    owner: "acme",
    repo: "app",
    installationId: 1,
    repositoryId: 2,
  } as never);
  vi.mocked(repositoryToken).mockResolvedValue("token");
  vi.mocked(githubRequest).mockResolvedValue([
    {
      name: "feature/signup",
      protected: false,
      commit: { sha: "a".repeat(40) },
    },
  ]);
  const result = await listBranches("project", 2);
  expect(repositoryToken).toHaveBeenCalledWith("user", 1, 2);
  expect(githubRequest).toHaveBeenCalledWith(
    "/repos/acme/app/branches?per_page=100&page=2",
    "token",
  );
  expect(result.branches[0]!.name).toBe("feature/signup");
  expect(result.mayHaveMore).toBe(false);
});
it("does not call GitHub for an unavailable connection", async () => {
  vi.mocked(Project.findOne).mockResolvedValue({
    connectionState: "unavailable",
    installationId: 1,
    repositoryId: 2,
  } as never);
  await expect(listBranches("project", 1)).rejects.toMatchObject({
    status: 409,
  });
  expect(repositoryToken).not.toHaveBeenCalled();
});

it("restores access only after GitHub confirms the repository identity", async () => {
  vi.mocked(Project.findOne).mockResolvedValue({
    userId: "user",
    owner: "acme",
    repo: "app",
    installationId: 1,
    repositoryId: 2,
    connectionState: "unavailable",
  } as never);
  vi.mocked(repositoryToken).mockResolvedValue("token");
  vi.mocked(githubRequest).mockResolvedValue({ id: 2 });
  vi.mocked(Project.updateOne).mockResolvedValue({ matchedCount: 1 } as never);
  expect((await refreshProjectConnection("project")).connection).toBe(
    "verified",
  );
  expect(Project.updateOne).toHaveBeenCalled();
});
it("does not restore a renamed or replaced repository identity", async () => {
  vi.mocked(Project.findOne).mockResolvedValue({
    userId: "user",
    owner: "acme",
    repo: "app",
    installationId: 1,
    repositoryId: 2,
  } as never);
  vi.mocked(repositoryToken).mockResolvedValue("token");
  vi.mocked(githubRequest).mockResolvedValue({ id: 3 });
  await expect(refreshProjectConnection("project")).rejects.toMatchObject({
    status: 409,
  });
  expect(Project.updateOne).not.toHaveBeenCalled();
});

it("rejects a project changed during remote verification", async () => {
  vi.mocked(Project.findOne).mockResolvedValue({
    userId: "user",
    owner: "acme",
    repo: "app",
    installationId: 1,
    repositoryId: 2,
  } as never);
  vi.mocked(repositoryToken).mockResolvedValue("token");
  vi.mocked(githubRequest).mockResolvedValue({ id: 2 });
  vi.mocked(Project.updateOne).mockResolvedValue({ matchedCount: 0 } as never);
  await expect(refreshProjectConnection("project")).rejects.toMatchObject({
    status: 409,
    code: "PROJECT_CHANGED",
  });
});

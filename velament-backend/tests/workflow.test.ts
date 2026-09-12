import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../src/models/Project.js", () => ({ Project: { findOne: vi.fn() } }));
vi.mock("../src/services/github-app.service.js", () => ({
  githubRequest: vi.fn(),
  repositoryToken: vi.fn(),
  userToken: vi.fn(),
}));
import { Project } from "../src/models/Project.js";
import {
  githubRequest,
  repositoryToken,
  userToken,
} from "../src/services/github-app.service.js";
import { cancelWorkflow } from "../src/services/workflow.service.js";
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(Project.findOne).mockResolvedValue({
    userId: "user",
    installationId: 1,
    repositoryId: 2,
    owner: "acme",
    repo: "app",
  } as never);
  vi.mocked(userToken).mockResolvedValue("user-token");
  vi.mocked(repositoryToken).mockResolvedValue("installation-token");
});
it("refuses workflow mutation without user write permission", async () => {
  vi.mocked(githubRequest).mockResolvedValue({ permissions: { push: false } });
  await expect(cancelWorkflow("project", 123)).rejects.toMatchObject({
    status: 403,
  });
  expect(repositoryToken).not.toHaveBeenCalled();
});
it("does not cancel a completed run", async () => {
  vi.mocked(githubRequest)
    .mockResolvedValueOnce({ permissions: { push: true } })
    .mockResolvedValueOnce({ status: "completed" });
  await expect(cancelWorkflow("project", 123)).rejects.toMatchObject({
    status: 409,
  });
  expect(githubRequest).toHaveBeenCalledTimes(2);
});
it("reports cancellation requested without inventing a final result", async () => {
  vi.mocked(githubRequest)
    .mockResolvedValueOnce({ permissions: { push: true } })
    .mockResolvedValueOnce({ status: "in_progress" })
    .mockResolvedValueOnce({});
  await expect(cancelWorkflow("project", 123)).resolves.toEqual({
    status: "cancellation_requested",
  });
  expect(githubRequest).toHaveBeenLastCalledWith(
    "/repos/acme/app/actions/runs/123/cancel",
    "installation-token",
    {},
  );
});

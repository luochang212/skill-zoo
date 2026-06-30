import "@/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RepoDetail } from "@/components/skills/RepoDetail";
import type { DiscoverRepo } from "@/types/skills";

const mocks = vi.hoisted(() => ({
  installMutate: vi.fn(),
  removeMutate: vi.fn(),
  refreshMutate: vi.fn(),
  repoSkillsError: null as unknown,
}));

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock("@/hooks/useSkills", () => ({
  useRepoSkills: () => ({
    data: mocks.repoSkillsError
      ? undefined
      : {
          total: 3,
          skills: [
            {
              key: "available",
              name: "Available Skill",
              directory: "available",
              repoOwner: "owner",
              repoName: "repo",
              installStatus: "available",
            },
            {
              key: "conflict",
              name: "Conflict Skill",
              directory: "conflict",
              repoOwner: "owner",
              repoName: "repo",
              installStatus: "conflict",
            },
            {
              key: "installed",
              name: "Installed Skill",
              directory: "installed",
              repoOwner: "owner",
              repoName: "repo",
              installStatus: "installed",
              installedSkillId: "repo:owner/repo:installed",
            },
          ],
        },
    isLoading: false,
    isError: !!mocks.repoSkillsError,
    error: mocks.repoSkillsError,
  }),
  useRefreshRepoSkills: () => ({ mutate: mocks.refreshMutate, isPending: false }),
  useRepoMetadata: () => ({ data: undefined }),
  useInstallSkills: () => ({ mutate: mocks.installMutate, isPending: false }),
  useRemoveSkill: () => ({ mutate: mocks.removeMutate, isPending: false }),
  useSkillPreview: () => ({ data: undefined, isLoading: false, isError: false }),
}));

vi.mock("@/components/skills/SkillInstallDialog", () => ({
  SkillInstallDialog: ({
    onInstall,
  }: {
    onInstall: (skillNames: string[], agents: string[]) => void;
  }) => <button onClick={() => onInstall(["available"], ["codex"])}>Confirm install test</button>,
}));

vi.mock("@/hooks/useRepoLoadStage", () => ({
  useRepoLoadProgress: () => null,
}));

function renderDetail(repo: DiscoverRepo = { owner: "owner", name: "repo", branch: "main" }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RepoDetail repo={repo} onBack={vi.fn()} />
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

describe("RepoDetail discover status", () => {
  beforeEach(() => {
    globalThis.ResizeObserver = ResizeObserverMock;
    mocks.installMutate.mockReset();
    mocks.removeMutate.mockReset();
    mocks.refreshMutate.mockReset();
    mocks.repoSkillsError = null;
  });

  it("blocks conflicting skills and uninstalls only by the backend-provided skill id", async () => {
    const { queryClient } = renderDetail();
    const setQueryData = vi.spyOn(queryClient, "setQueryData");

    expect(screen.getByText("Name conflict")).toHaveAttribute(
      "title",
      "A different skill already uses this folder name. Resolve it in Local Skills before installing.",
    );
    expect(screen.getByRole("checkbox", { name: "Name conflict" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Uninstall" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(mocks.removeMutate).toHaveBeenCalledWith(
      "repo:owner/repo:installed",
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(setQueryData).not.toHaveBeenCalled();
  });

  it("leaves discover status to the backend after installation", async () => {
    const { queryClient } = renderDetail();
    const setQueryData = vi.spyOn(queryClient, "setQueryData");

    await userEvent.click(screen.getByRole("button", { name: "Install" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm install test" }));

    expect(mocks.installMutate).toHaveBeenCalledWith(
      {
        repoUrl: "https://github.com/owner/repo/tree/main",
        skillNames: ["available"],
        agents: ["codex"],
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(setQueryData).not.toHaveBeenCalled();
  });

  it("installs the repository default branch without pinning metadata as an explicit branch", async () => {
    const { queryClient } = renderDetail({
      owner: "owner",
      name: "repo",
      defaultBranch: "master",
    });
    const setQueryData = vi.spyOn(queryClient, "setQueryData");

    await userEvent.click(screen.getByRole("button", { name: "Install" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm install test" }));

    expect(mocks.installMutate).toHaveBeenCalledWith(
      {
        repoUrl: "https://github.com/owner/repo",
        skillNames: ["available"],
        agents: ["codex"],
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(setQueryData).not.toHaveBeenCalled();
  });

  it("shows a localized download error when repository loading fails", () => {
    mocks.repoSkillsError = {
      code: "downloadNetwork",
      message: "Download failed for owner/repo",
      repo: "owner/repo",
    };

    renderDetail();

    expect(
      screen.getByText(
        "Failed to download owner/repo. Check your internet connection and try again.",
      ),
    ).toBeInTheDocument();
  });
});

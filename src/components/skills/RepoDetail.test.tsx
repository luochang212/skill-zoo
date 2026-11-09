import "@/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RepoDetail } from "@/components/skills/RepoDetail";
import type { DiscoverRepo } from "@/types/skills";

const mocks = vi.hoisted(() => ({
  installMutate: vi.fn(),
  removeMutate: vi.fn(),
  refreshMutate: vi.fn(),
  repoSkillsError: null as unknown,
  repoSkillsStaleData: null as unknown,
  repoSkillsFetching: false,
  repoSelectedKeys: new Set<string>(),
}));

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock("@/hooks/useSkills", () => ({
  useRepoMetadata: () => ({ data: undefined }),
  useInstallSkills: () => ({ mutate: mocks.installMutate, isPending: false }),
  useRemoveSkill: () => ({ mutate: mocks.removeMutate, isPending: false }),
  useSkillPreview: () => ({ data: undefined, isLoading: false, isError: false }),
}));

vi.mock("@/components/skills/SkillInstallDialog", () => ({
  SkillInstallDialog: ({
    skills,
    onInstall,
  }: {
    skills: Array<{ key: string }>;
    onInstall: (skillNames: string[], agents: string[]) => void;
  }) => (
    <button
      onClick={() =>
        onInstall(
          skills.map((skill) => skill.key),
          ["codex"],
        )
      }
    >
      Confirm install test
    </button>
  ),
}));

vi.mock("@/hooks/useRepoTasks", () => ({
  useRepoTask: () => ({
    // A refetch failure retains the previous results, so error and data can
    // coexist — exactly the cancelled-refresh state.
    data: mocks.repoSkillsError
      ? mocks.repoSkillsStaleData
      : {
          total: 3,
          skills: [
            {
              key: ".agents/skills/available",
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
    isFetching: mocks.repoSkillsFetching,
    progress: null,
    selectedKeys: mocks.repoSelectedKeys,
    setSelectedKeys: vi.fn(),
    refresh: mocks.refreshMutate,
    isLoading: false,
    isError: !!mocks.repoSkillsError,
    error: mocks.repoSkillsError,
  }),
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
    mocks.repoSkillsStaleData = null;
    mocks.repoSkillsFetching = false;
    mocks.repoSelectedKeys = new Set();
  });

  it("blocks stale install actions and does not display a discovery README", async () => {
    mocks.repoSkillsFetching = true;
    renderDetail();
    expect(screen.getByRole("button", { name: "Install selected (0)" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Select Available Skill" })).toBeDisabled();
    expect(screen.queryByText("README")).not.toBeInTheDocument();
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
    mocks.repoSelectedKeys = new Set([".agents/skills/available"]);
    const { queryClient } = renderDetail();
    const setQueryData = vi.spyOn(queryClient, "setQueryData");

    await userEvent.click(screen.getByRole("button", { name: "Install selected (1)" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm install test" }));

    expect(mocks.installMutate).toHaveBeenCalledWith(
      {
        repoUrl: "https://github.com/owner/repo/tree/main",
        skillNames: [".agents/skills/available"],
        agents: ["codex"],
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(setQueryData).not.toHaveBeenCalled();
  });

  it("installs the repository default branch without pinning metadata as an explicit branch", async () => {
    mocks.repoSelectedKeys = new Set([".agents/skills/available"]);
    const { queryClient } = renderDetail({
      owner: "owner",
      name: "repo",
      defaultBranch: "master",
    });
    const setQueryData = vi.spyOn(queryClient, "setQueryData");

    await userEvent.click(screen.getByRole("button", { name: "Install selected (1)" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm install test" }));

    expect(mocks.installMutate).toHaveBeenCalledWith(
      {
        repoUrl: "https://github.com/owner/repo",
        skillNames: [".agents/skills/available"],
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

  it("shows a quiet cancelled state with an explicit reload instead of error styling", () => {
    mocks.repoSkillsError = { code: "cancelled", message: "Load cancelled" };

    renderDetail();

    expect(screen.getByText("Loading cancelled")).toBeInTheDocument();
    expect(screen.queryByText("Load cancelled")).not.toBeInTheDocument();
    expect(screen.queryByText(/Failed to download/)).not.toBeInTheDocument();
    const state = screen.getByText("Loading cancelled").parentElement!;
    expect(within(state).getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("returns to the loading skeleton while a cancelled load is being retried", () => {
    // During the refetch of an errored query the error persists, data stays
    // undefined and fetching turns true — the skeleton must win over both.
    mocks.repoSkillsError = { code: "cancelled", message: "Load cancelled" };
    mocks.repoSkillsFetching = true;

    renderDetail();

    expect(screen.getByRole("status", { name: "Loading..." })).toBeInTheDocument();
    expect(screen.queryByText("Loading cancelled")).not.toBeInTheDocument();
    expect(screen.queryByText(/Failed to download/)).not.toBeInTheDocument();
  });

  it("keeps previously loaded skills visible when a refresh is cancelled", () => {
    mocks.repoSkillsError = { code: "cancelled", message: "Load cancelled" };
    mocks.repoSkillsStaleData = {
      total: 1,
      skills: [
        {
          key: "kept",
          name: "Kept Skill",
          directory: "kept",
          repoOwner: "owner",
          repoName: "repo",
          installStatus: "available",
        },
      ],
    };

    renderDetail();

    expect(screen.getByText("Kept Skill")).toBeInTheDocument();
    expect(screen.queryByText("Loading cancelled")).not.toBeInTheDocument();
  });

  it("keeps a compact bulk bar visible with the install action disabled until selection", () => {
    renderDetail();

    expect(screen.getByText("0 selected")).toBeInTheDocument();
    expect(screen.getByText("1 total")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install selected (0)" })).toBeDisabled();
  });

  it("enables bulk install with a live count once skills are selected", async () => {
    const user = userEvent.setup();
    mocks.repoSelectedKeys = new Set([".agents/skills/available"]);

    renderDetail();

    const bulk = screen.getByRole("button", { name: "Install selected (1)" });
    expect(bulk).toBeEnabled();
    await user.click(bulk);
    await user.click(screen.getByRole("button", { name: "Confirm install test" }));
    expect(mocks.installMutate).toHaveBeenCalledWith(
      {
        repoUrl: "https://github.com/owner/repo/tree/main",
        skillNames: [".agents/skills/available"],
        agents: ["codex"],
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});

describe("skill preview install", () => {
  it("previews from the skill list and installs only after confirmation", async () => {
    const user = userEvent.setup();
    mocks.repoSkillsError = null;
    mocks.repoSkillsFetching = false;
    mocks.installMutate.mockReset();
    renderDetail();
    await user.click(await screen.findByRole("button", { name: "Available Skill" }));
    expect(mocks.installMutate).not.toHaveBeenCalled();
    // Row-level install buttons are gone; the preview panel's footer button is
    // the only per-skill install control left.
    const panelInstall = screen
      .getAllByRole("button", { name: "Install" })
      .find((button) => !button.hasAttribute("disabled"));
    expect(panelInstall).toBeTruthy();
    await user.click(panelInstall!);
    await user.click(screen.getByRole("button", { name: "Confirm install test" }));
    expect(mocks.installMutate).toHaveBeenCalledWith(
      {
        repoUrl: "https://github.com/owner/repo/tree/main",
        skillNames: [".agents/skills/available"],
        agents: ["codex"],
      },
      expect.any(Object),
    );
  });
});

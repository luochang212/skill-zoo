import i18n from "@/i18n";
import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrowseSkills } from "@/components/skills/BrowseSkills";
import type { DiscoverRepo } from "@/types/skills";

vi.mock("@/components/skills/CommunitySkills", () => ({
  CommunitySkills: ({
    onOpen,
  }: {
    onOpen: (skill: { source: string; skillId: string; name: string }) => void;
  }) => (
    <button
      type="button"
      data-testid="stub-community-card"
      onClick={() => onOpen({ source: "owner/repo", skillId: "skill-key", name: "Example Skill" })}
    >
      stub community card
    </button>
  ),
}));

vi.mock("@/components/skills/RepoDetail", () => ({
  RepoDetail: ({ repo }: { repo: { name?: string } | null }) => (
    <div>repo-detail-stub:{repo?.name ?? ""}</div>
  ),
}));

const mocks = vi.hoisted(() => ({
  refetchRepoSearch: vi.fn(),
  refetchSkillsSearch: vi.fn(),
  searchRepo: vi.fn(),
  repoResult: undefined as
    | {
        owner: string;
        name: string;
        branch?: string;
        defaultBranch?: string;
        description?: string;
      }
    | undefined,
  repoSearchLoading: false,
  skillsSearchLoading: false,
  skillsSearchQueries: [] as Array<string | null | undefined>,
  recommendedLoading: false,
  recommendedRepos: [] as Array<{
    owner: string;
    name: string;
    branch?: string;
    defaultBranch?: string;
    description?: string;
  }>,
  repoSkills: undefined as
    | undefined
    | {
        skills: Array<{
          key: string;
          name: string;
          directory: string;
          repoOwner: string;
          repoName: string;
          installStatus: "available";
        }>;
      },
  skillsResults: [] as Array<{
    key: string;
    name: string;
    directory: string;
    repoOwner: string;
    repoName: string;
    installStatus: "available";
  }>,
  skillsSearchError: false,
}));

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock("@/hooks/useSkills", () => ({
  useBanners: () => ({ data: [] }),
  useRepoSkillList: () => ({ data: mocks.repoSkills }),
  useInstallSkills: () => ({ mutate: vi.fn(), isPending: false }),
  useSkillPreview: () => ({ data: undefined, isLoading: false, isError: false }),
  useRecommendedRepos: () => ({
    data: mocks.recommendedRepos,
    isLoading: mocks.recommendedLoading,
    isError: false,
    refetch: vi.fn(),
  }),
  useSearchRepo: () => ({
    data: mocks.repoResult,
    isLoading: mocks.repoSearchLoading,
    isError: false,
    refetch: mocks.refetchRepoSearch,
  }),
  useSearchSkillsSh: (query: string | null) => {
    mocks.skillsSearchQueries.push(query);
    return {
      data: mocks.skillsResults,
      isLoading: mocks.skillsSearchLoading,
      isError: mocks.skillsSearchError,
      refetch: mocks.refetchSkillsSearch,
    };
  },
}));

vi.mock("@/hooks/useRecentlyViewed", () => ({
  useRecentlyViewed: () => ({ items: [], add: vi.fn(), clear: vi.fn() }),
}));

vi.mock("@/lib/api/skills", () => ({
  skillsApi: { searchRepo: mocks.searchRepo },
}));

// Same wiring as App.tsx: the selected repo swaps the discover view for the
// repo detail page, which unmounts the preview panel outright.
function Harness() {
  const [selectedRepo, setSelectedRepo] = useState<DiscoverRepo | null>(null);
  return <BrowseSkills selectedRepo={selectedRepo} onSelectRepo={setSelectedRepo} />;
}

describe("BrowseSkills", () => {
  beforeEach(() => {
    globalThis.ResizeObserver = ResizeObserverMock;
    vi.useRealTimers();
    mocks.recommendedRepos = [];
    mocks.recommendedLoading = false;
    mocks.repoSkills = undefined;
    mocks.skillsResults = [];
    mocks.repoResult = undefined;
    mocks.repoSearchLoading = false;
    mocks.skillsSearchLoading = false;
    mocks.skillsSearchError = false;
    mocks.skillsSearchQueries = [];
    mocks.refetchRepoSearch.mockReset();
    mocks.refetchSkillsSearch.mockReset();
    mocks.searchRepo.mockReset();
  });

  it("waits for local recommendations without skeletons or a false empty state", () => {
    mocks.recommendedLoading = true;
    const { container, rerender } = render(
      <BrowseSkills selectedRepo={null} onSelectRepo={vi.fn()} />,
    );
    expect(container.querySelector(".skeleton")).toBeNull();
    expect(screen.queryByText(i18n.t("browse.noRepos"))).toBeNull();
    mocks.recommendedLoading = false;
    mocks.recommendedRepos = [{ owner: "owner", name: "repo" }];
    rerender(<BrowseSkills selectedRepo={null} onSelectRepo={vi.fn()} />);
    expect(screen.getByRole("button", { name: "owner/repo" })).toBeInTheDocument();
  });

  it("renders repository cards as keyboard-operable buttons", async () => {
    mocks.recommendedRepos = [{ owner: "owner", name: "repo", branch: "main" }];
    const onSelectRepo = vi.fn();
    render(<BrowseSkills selectedRepo={null} onSelectRepo={onSelectRepo} />);

    const card = screen.getByRole("button", { name: "owner/repo" });
    card.focus();
    await userEvent.keyboard("{Enter}");

    expect(onSelectRepo).toHaveBeenCalledWith(mocks.recommendedRepos[0]);
  });

  it("distinguishes a failed search from an empty search", async () => {
    vi.useFakeTimers();
    mocks.skillsSearchError = true;
    render(<BrowseSkills selectedRepo={null} onSelectRepo={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("Search skills or GitHub repo..."), {
      target: { value: "skill" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(screen.getByText("Search failed.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.refetchSkillsSearch).toHaveBeenCalled();
  });

  it("keeps a repository default branch separate when opening a skills.sh result", async () => {
    vi.useFakeTimers();
    mocks.skillsResults = [
      {
        key: "skill-key",
        name: "Example Skill",
        directory: "example",
        repoOwner: "owner",
        repoName: "repo",
        installStatus: "available",
      },
    ];
    mocks.searchRepo.mockResolvedValue({ owner: "owner", name: "repo", defaultBranch: "master" });
    const onSelectRepo = vi.fn();
    render(<BrowseSkills selectedRepo={null} onSelectRepo={onSelectRepo} />);

    fireEvent.change(screen.getByPlaceholderText("Search skills or GitHub repo..."), {
      target: { value: "example" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    vi.useRealTimers();
    await userEvent.click(screen.getByRole("button", { name: /Example Skill/ }));

    expect(mocks.searchRepo).toHaveBeenCalledWith("owner/repo");
    expect(onSelectRepo).toHaveBeenCalledWith({
      owner: "owner",
      name: "repo",
      defaultBranch: "master",
    });
  });

  it("routes owner/repo input to repository search without waiting on skills.sh", async () => {
    vi.useFakeTimers();
    mocks.repoResult = { owner: "hugmouse", name: "skills" };
    mocks.skillsSearchLoading = true;
    render(<BrowseSkills selectedRepo={null} onSelectRepo={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("Search skills or GitHub repo..."), {
      target: { value: "hugmouse/skills" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(mocks.skillsSearchQueries).not.toContain("hugmouse/skills");
    expect(screen.queryByText("Searching...")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hugmouse\/skills/ })).toBeInTheDocument();
  });

  it("opens a skills.sh result even when repository metadata is unavailable", async () => {
    vi.useFakeTimers();
    mocks.skillsResults = [
      {
        key: "skill-key",
        name: "Example Skill",
        directory: "example",
        repoOwner: "owner",
        repoName: "repo",
        installStatus: "available",
      },
    ];
    mocks.searchRepo.mockRejectedValue(new Error("Network error fetching repo metadata"));
    const onSelectRepo = vi.fn();
    render(<BrowseSkills selectedRepo={null} onSelectRepo={onSelectRepo} />);

    fireEvent.change(screen.getByPlaceholderText("Search skills or GitHub repo..."), {
      target: { value: "example" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    vi.useRealTimers();
    await userEvent.click(screen.getByRole("button", { name: /Example Skill/ }));

    expect(mocks.searchRepo).toHaveBeenCalledWith("owner/repo");
    expect(onSelectRepo).toHaveBeenCalledWith({
      owner: "owner",
      name: "repo",
      description: undefined,
    });
  });

  it("does not navigate while an IME composition is being confirmed", async () => {
    vi.useFakeTimers();
    mocks.repoResult = { owner: "hugmouse", name: "skills" };
    const onSelectRepo = vi.fn();
    render(<BrowseSkills selectedRepo={null} onSelectRepo={onSelectRepo} />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "hugmouse/skills" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(screen.getByRole("button", { name: /hugmouse\/skills/ })).toBeInTheDocument();

    // WebKit reports isComposing === false for the Enter that confirms a candidate,
    // so the keyCode 229 path is the one that actually protects WKWebView.
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(onSelectRepo).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(onSelectRepo).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelectRepo).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("still navigates on a plain Enter after composition ends", async () => {
    vi.useFakeTimers();
    mocks.repoResult = { owner: "hugmouse", name: "skills" };
    const onSelectRepo = vi.fn();
    render(<BrowseSkills selectedRepo={null} onSelectRepo={onSelectRepo} />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "hugmouse/skills" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    fireEvent.keyDown(input, { key: "Enter", isComposing: false });

    expect(onSelectRepo).toHaveBeenCalledWith(mocks.repoResult);
    vi.useRealTimers();
  });

  it("jumps to the repo detail page from the community preview footer", async () => {
    mocks.repoSkills = {
      skills: [
        {
          key: "skill-key",
          name: "Example Skill",
          directory: "example",
          repoOwner: "owner",
          repoName: "repo",
          installStatus: "available",
        },
      ],
    };
    mocks.searchRepo.mockResolvedValue({ owner: "owner", name: "repo", defaultBranch: "master" });
    render(<Harness />);

    await userEvent.click(screen.getByTestId("stub-community-card"));

    // The preview footer identifies the repo, not the skill the user just clicked.
    const repoButton = screen.getByRole("button", { name: "owner/repo" });
    expect(screen.queryByRole("button", { name: "Example Skill" })).toBeNull();
    await userEvent.click(repoButton);

    expect(mocks.searchRepo).toHaveBeenCalledWith("owner/repo");
    expect(screen.getByText("repo-detail-stub:repo")).toBeInTheDocument();
    // The preview is closed, not carried over into the repo detail page.
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
  });
});

import "@/i18n";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrowseSkills } from "@/components/skills/BrowseSkills";

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
  recommendedRepos: [] as Array<{
    owner: string;
    name: string;
    branch?: string;
    defaultBranch?: string;
    description?: string;
  }>,
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
  useRecommendedRepos: () => ({
    data: mocks.recommendedRepos,
    isLoading: false,
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

describe("BrowseSkills", () => {
  beforeEach(() => {
    globalThis.ResizeObserver = ResizeObserverMock;
    vi.useRealTimers();
    mocks.recommendedRepos = [];
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
});

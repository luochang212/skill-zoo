import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  useBanners,
  useRecommendedRepos,
  useSearchRepo,
  useSearchSkillsSh,
} from "@/hooks/useSkills";
import { useRecentlyViewed } from "@/hooks/useRecentlyViewed";
import { skillsApi } from "@/lib/api/skills";
import { BannerCarousel } from "@/components/skills/BannerCarousel";
import { Input } from "@/components/ui/input";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RepoDetail } from "@/components/skills/RepoDetail";
import type { DiscoverRepo } from "@/types/skills";
import { Search, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface RepoCardProps {
  repo: DiscoverRepo;
  onClick: () => void;
  hideDescription?: boolean;
}

function RepoCard({ repo, onClick, hideDescription }: RepoCardProps) {
  const handleClick = () => {
    // Skip navigation if the user just finished selecting text
    const sel = window.getSelection();
    if (sel && sel.toString().length > 0) return;
    onClick();
  };
  return (
    <button
      type="button"
      className="group w-full text-left rounded-xl border bg-card text-card-foreground shadow-sm dark:shadow-[0_2px_8px_rgba(0,0,0,0.4),0_0_0_1px_rgba(255,255,255,0.05)] hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
      onClick={handleClick}
      data-selectable
    >
      <CardHeader className="px-4 pt-4 pb-1">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-[13px] font-medium leading-tight truncate">
            {repo.owner}/{repo.name}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-0">
        {repo.description && !hideDescription && (
          <p className="text-[13px] text-muted-foreground/80 line-clamp-2 mb-2 leading-relaxed">
            {repo.description}
          </p>
        )}
      </CardContent>
    </button>
  );
}

function formatInstalls(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return n.toString();
}

interface BrowseSkillsProps {
  selectedRepo: DiscoverRepo | null;
  onSelectRepo: (repo: DiscoverRepo | null) => void;
}

export function BrowseSkills({ selectedRepo, onSelectRepo }: BrowseSkillsProps) {
  const { t } = useTranslation();
  const { data: banners } = useBanners();
  const {
    data: recommendedRepos,
    isLoading: loadingRepos,
    isError: reposError,
    refetch: refetchRepos,
  } = useRecommendedRepos();
  const { items: recentItems, add: addRecent, clear: clearRecent } = useRecentlyViewed();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const repos = recommendedRepos ?? [];

  // Dedup recently viewed against recommended list
  const recommendedKeys = useMemo(() => new Set(repos.map((r) => `${r.owner}/${r.name}`)), [repos]);
  const recentToDisplay = useMemo(
    () => recentItems.filter((r) => !recommendedKeys.has(`${r.owner}/${r.name}`)),
    [recentItems, recommendedKeys],
  );

  // Debounce search input
  useEffect(() => {
    const trimmed = search.trim();
    if (!trimmed) {
      setDebouncedSearch(null);
      setDropdownOpen(false);
      return;
    }
    const timer = setTimeout(() => {
      setDebouncedSearch(trimmed);
      setDropdownOpen(true);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  // Route repository-shaped queries directly to GitHub repo lookup.
  const isRepoQuery = useMemo(
    () =>
      /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(debouncedSearch ?? "") ||
      /^https?:\/\/github\.com\//.test(debouncedSearch ?? ""),
    [debouncedSearch],
  );
  const {
    data: repoResult,
    isLoading: searchingRepo,
    isError: repoSearchError,
    refetch: refetchRepoSearch,
  } = useSearchRepo(isRepoQuery ? debouncedSearch : null);
  const {
    data: skillsShResults,
    isLoading: searchingSkillsSh,
    isError: skillsShSearchError,
    refetch: refetchSkillsShSearch,
  } = useSearchSkillsSh(isRepoQuery ? null : debouncedSearch);

  const isSearching = !repoResult && (searchingRepo || searchingSkillsSh);
  const skillsList = skillsShResults ?? [];
  const hasResults = !!repoResult || skillsList.length > 0;
  const searchFailed = skillsShSearchError || (isRepoQuery && repoSearchError);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Clear search state and navigate to a repo
  const navigateToRepo = useCallback(
    (repo: DiscoverRepo) => {
      setDropdownOpen(false);
      setSearch("");
      setDebouncedSearch(null);
      if (!recommendedKeys.has(`${repo.owner}/${repo.name}`)) {
        addRecent(repo);
      }
      onSelectRepo(repo);
    },
    [onSelectRepo, addRecent, recommendedKeys],
  );

  const handleBannerClick = useCallback(
    async (owner: string, name: string, branch?: string) => {
      const found = repos.find((r) => r.owner === owner && r.name === name);
      if (found) {
        navigateToRepo(found);
        return;
      }
      try {
        const repo = await skillsApi.searchRepo(`${owner}/${name}`);
        navigateToRepo({ ...repo, branch: branch ?? repo.branch });
      } catch {
        // ignore — repo not found or network error
      }
    },
    [repos, navigateToRepo],
  );

  const handleSkillSearchResult = useCallback(
    async (owner: string, name: string) => {
      let repo: DiscoverRepo = { owner, name, description: undefined };
      try {
        repo = await skillsApi.searchRepo(`${owner}/${name}`);
      } catch {
        // Metadata only enriches the detail page. It should not block opening a search result.
      }
      navigateToRepo(repo);
    },
    [navigateToRepo],
  );

  const handleBackFromRepo = useCallback(() => {
    onSelectRepo(null);
  }, [onSelectRepo]);

  // Keyboard handler for the search input
  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        setDropdownOpen(false);
      } else if (e.key === "Enter" && repoResult && dropdownOpen && isRepoQuery) {
        e.preventDefault();
        navigateToRepo(repoResult);
      }
    },
    [repoResult, dropdownOpen, isRepoQuery, navigateToRepo],
  );

  // If user selected a repo, show RepoDetail
  if (selectedRepo) {
    return (
      <div className="flex flex-col h-full">
        <RepoDetail
          key={selectedRepo.owner + "/" + selectedRepo.name}
          repo={selectedRepo}
          onBack={handleBackFromRepo}
        />
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col min-h-full p-6">
        {/* Search bar with dropdown */}
        <div className="flex items-center gap-3 mb-6 shrink-0">
          <div className="relative max-w-md flex-1" ref={searchRef}>
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground z-10" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => {
                if (debouncedSearch && search.trim()) {
                  setDropdownOpen(true);
                }
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder={t("browse.searchRepoPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              className="h-9 text-[13px] pl-8"
            />

            {/* Search dropdown with two sections */}
            {dropdownOpen && search.trim() && (
              <div className="absolute top-full left-0 right-0 mt-1 z-50">
                <ScrollArea className="max-h-[300px] bg-popover border border-border rounded-lg shadow-lg">
                  {isSearching ? (
                    <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>{t("browse.searching")}</span>
                    </div>
                  ) : !hasResults && searchFailed ? (
                    <div className="flex items-center justify-between gap-3 px-4 py-3">
                      <span className="text-sm text-destructive">{t("browse.searchFailed")}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => {
                          if (!isRepoQuery) void refetchSkillsShSearch();
                          if (isRepoQuery) void refetchRepoSearch();
                        }}
                      >
                        {t("error.retry")}
                      </Button>
                    </div>
                  ) : !hasResults ? (
                    <div className="px-4 py-3 text-sm text-muted-foreground">
                      {t("browse.noSearchResult")}
                    </div>
                  ) : (
                    <>
                      {/* Repository section — only when exact owner/name match found */}
                      {repoResult && (
                        <>
                          <button
                            className="w-full text-left px-4 py-2.5 hover:bg-accent/50 transition-colors flex items-center justify-between gap-3"
                            onClick={() => navigateToRepo(repoResult)}
                          >
                            <div className="min-w-0">
                              <p className="text-[11px] text-muted-foreground/60 uppercase tracking-wider mb-0.5">
                                Repository
                              </p>
                              <p className="text-[13px] font-medium truncate">
                                {repoResult.owner}/{repoResult.name}
                              </p>
                            </div>
                            <span className="text-[11px] text-muted-foreground shrink-0">
                              {t("browse.viewRepo")}
                            </span>
                          </button>
                          <div className="border-t border-border/60" />
                        </>
                      )}

                      {/* Skills section — skills.sh fuzzy search results */}
                      {skillsList.map((skill) => (
                        <button
                          key={skill.key}
                          className="w-full text-left px-4 py-2.5 hover:bg-accent/50 transition-colors flex items-center justify-between gap-3"
                          onClick={() =>
                            void handleSkillSearchResult(skill.repoOwner, skill.repoName)
                          }
                        >
                          <div className="min-w-0">
                            <p className="text-[13px] font-medium truncate">{skill.name}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[11px] text-muted-foreground/70 truncate">
                                {skill.repoOwner}/{skill.repoName}
                              </span>
                              {skill.installs != null && (
                                <span className="text-[10px] text-muted-foreground/50 shrink-0">
                                  {formatInstalls(skill.installs)} {t("browse.installs")}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      ))}
                    </>
                  )}
                </ScrollArea>
              </div>
            )}
          </div>
        </div>

        {/* Banner carousel */}
        {banners && banners.length > 0 && (
          <div className="shrink-0">
            <BannerCarousel banners={banners} onBannerClick={handleBannerClick} />
          </div>
        )}

        {/* Recently viewed repos */}
        {recentToDisplay.length > 0 && (
          <div className="shrink-0 pt-1 pb-2">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {t("browse.recentlyViewed")}
              </h2>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[11px] text-muted-foreground hover:text-foreground px-2"
                onClick={clearRecent}
              >
                {t("browse.clearHistory")}
              </Button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {recentToDisplay.map((entry) => (
                <RepoCard
                  key={`${entry.owner}/${entry.name}`}
                  repo={entry}
                  onClick={() => navigateToRepo(entry)}
                  hideDescription
                />
              ))}
            </div>
          </div>
        )}

        {/* Recommended repos */}
        {loadingRepos ? (
          <div className="flex-1">
            <Skeleton className="h-3 w-24 mb-3" />
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-xl border bg-card p-4 space-y-3">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-4/5" />
                </div>
              ))}
            </div>
          </div>
        ) : reposError ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <AlertTriangle className="h-8 w-8 text-destructive/60" />
            <p className="text-sm text-destructive">{t("error.generic")}</p>
            <Button size="sm" variant="outline" onClick={() => refetchRepos()}>
              {t("error.retry")}
            </Button>
          </div>
        ) : repos.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-muted-foreground">{t("browse.noRepos")}</p>
          </div>
        ) : (
          <div className="pt-1">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              {t("browse.recommended")}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {repos.map((repo) => (
                <RepoCard
                  key={`${repo.owner}/${repo.name}`}
                  repo={repo}
                  onClick={() => navigateToRepo(repo)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

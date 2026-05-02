import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useBanners, useRecommendedRepos, useSearchRepo, useSearchSkillsSh } from "@/hooks/useSkills";
import { useRecentlyViewed } from "@/hooks/useRecentlyViewed";
import { skillsApi } from "@/lib/api/skills";
import { BannerCarousel } from "@/components/skills/BannerCarousel";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RepoDetail } from "@/components/skills/RepoDetail";
import type { DiscoverRepo } from "@/types/skills";
import { Search, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface RepoCardProps {
  repo: DiscoverRepo;
  onClick: () => void;
}

function RepoCard({ repo, onClick }: RepoCardProps) {
  return (
    <Card
      className="group rounded-xl hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
      onClick={onClick}
    >
      <CardHeader className="px-4 pt-4 pb-1">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-[13px] font-medium leading-tight truncate">
            {repo.owner}/{repo.name}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-0">
        {repo.description && (
          <p className="text-[13px] text-muted-foreground/80 line-clamp-2 mb-2 leading-relaxed">
            {repo.description}
          </p>
        )}
      </CardContent>
    </Card>
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
  const { data: recommendedRepos, isLoading: loadingRepos, isError: reposError, refetch: refetchRepos } = useRecommendedRepos();
  const { items: recentItems, add: addRecent, clear: clearRecent } = useRecentlyViewed();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const repos = recommendedRepos ?? [];

  // Dedup recently viewed against recommended list
  const recommendedKeys = useMemo(
    () => new Set(repos.map((r) => `${r.owner}/${r.name}`)),
    [repos],
  );
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

  // Parallel search: skills.sh always, GitHub repo for owner/name or github.com URL
  const isRepoQuery = useMemo(
    () => /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(debouncedSearch ?? "") || /^https?:\/\/github\.com\//.test(debouncedSearch ?? ""),
    [debouncedSearch],
  );
  const { data: repoResult, isLoading: searchingRepo } = useSearchRepo(isRepoQuery ? debouncedSearch : null);
  const { data: skillsShResults, isLoading: searchingSkillsSh } = useSearchSkillsSh(debouncedSearch);

  const isSearching = searchingRepo || searchingSkillsSh;
  const skillsList = skillsShResults ?? [];
  const hasResults = !!repoResult || skillsList.length > 0;

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
  const navigateToRepo = useCallback((repo: DiscoverRepo) => {
    setDropdownOpen(false);
    setSearch("");
    setDebouncedSearch(null);
    addRecent(repo);
    onSelectRepo(repo);
  }, [onSelectRepo, addRecent]);

  const handleSearchSelect = useCallback((repo: DiscoverRepo) => {
    navigateToRepo(repo);
  }, [navigateToRepo]);

  const handleBannerClick = useCallback(
    async (owner: string, name: string) => {
      const found = repos.find((r) => r.owner === owner && r.name === name);
      if (found) {
        navigateToRepo(found);
        return;
      }
      try {
        const repo = await skillsApi.searchRepo(`${owner}/${name}`);
        navigateToRepo(repo);
      } catch {
        // ignore — repo not found or network error
      }
    },
    [repos, navigateToRepo],
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
        handleSearchSelect(repoResult);
      }
    },
    [repoResult, dropdownOpen, isRepoQuery, handleSearchSelect],
  );

  // If user selected a repo, show RepoDetail
  if (selectedRepo) {
    return (
      <div className="flex flex-col h-full">
        <RepoDetail
          key={selectedRepo.owner + '/' + selectedRepo.name}
          repo={selectedRepo}
          onBack={handleBackFromRepo}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-6 overflow-auto">
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
            <div className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-lg z-50 overflow-hidden max-h-[300px] overflow-y-auto overscroll-contain">
              {isSearching ? (
                <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>{t("browse.searching")}</span>
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
                        onClick={() => handleSearchSelect(repoResult)}
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
                      onClick={() => navigateToRepo({
                        owner: skill.repoOwner,
                        name: skill.repoName,
                        branch: "main",
                        description: undefined,
                      })}
                    >
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium truncate">
                          {skill.name}
                        </p>
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
        <div className="pt-1 pr-1">
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
  );
}

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  useBanners,
  useInstallSkills,
  useRecommendedRepos,
  useRepoSkillList,
  useSearchRepo,
  useSearchSkillsSh,
  useSkillPreview,
} from "@/hooks/useSkills";
import { useRecentlyViewed } from "@/hooks/useRecentlyViewed";
import { skillsApi } from "@/lib/api/skills";
import { CommunitySkills } from "@/components/skills/CommunitySkills";
import { SkillInstallDialog } from "@/components/skills/SkillInstallDialog";
import { SkillPreviewPanel } from "@/components/skills/SkillPreviewPanel";
import { resolveCatalogSkill } from "@/components/skills/resolveCatalogSkill";
import { BannerCarousel } from "@/components/skills/BannerCarousel";
import { Input } from "@/components/ui/input";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RepoDetail } from "@/components/skills/RepoDetail";
import type { CatalogSkill, DiscoverableSkill, DiscoverRepo } from "@/types/skills";
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
      className="group h-full w-full text-left rounded-xl border border-border/70 bg-card text-card-foreground hover:bg-accent/40 hover:border-primary/30 transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
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
          <p className="text-xs text-muted-foreground line-clamp-2 mb-2 leading-relaxed">
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

  const [previewTarget, setPreviewTarget] = useState<CatalogSkill | null>(null);
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

  // Community card preview: resolve the catalog slug against the real repo
  // skill list, then show the SKILL.md in the shared side panel.
  const [previewOwner, previewRepoName] = previewTarget
    ? previewTarget.source.split("/")
    : [undefined, undefined];
  const { data: previewRepoSkills } = useRepoSkillList(
    previewOwner ?? null,
    previewRepoName ?? null,
  );
  const matchedSkill =
    previewTarget && previewRepoSkills
      ? resolveCatalogSkill(previewRepoSkills.skills, previewTarget.skillId)
      : undefined;
  // When resolution fails the panel lists the repo's skills; the picked one
  // takes over the preview directly.
  const [manualSkill, setManualSkill] = useState<DiscoverableSkill | null>(null);
  useEffect(() => {
    setManualSkill(null);
  }, [previewTarget]);
  const previewSkill = manualSkill ?? matchedSkill;
  const previewMissing = !!previewTarget && !!previewRepoSkills && !previewSkill;
  const installMutation = useInstallSkills();
  const [installSkill, setInstallSkill] = useState<DiscoverableSkill | null>(null);
  useEffect(() => {
    setInstallSkill(null);
  }, [previewTarget]);
  const handlePanelInstall = (skillNames: string[], agents: string[]) => {
    if (!installSkill) return;
    installMutation.mutate(
      {
        repoUrl: `https://github.com/${installSkill.repoOwner}/${installSkill.repoName}`,
        skillNames,
        agents,
      },
      { onSuccess: () => setInstallSkill(null) },
    );
  };
  const {
    data: panelContent,
    isLoading: panelContentLoading,
    isError: panelContentError,
  } = useSkillPreview(
    previewSkill?.repoOwner ?? null,
    previewSkill?.repoName ?? null,
    undefined,
    previewSkill?.key ?? null,
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
        // ignore because the repo was not found or the network failed
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
      // IME guard: the Enter that confirms a candidate must not navigate. WebKit
      // reports isComposing === false by then, so keyCode 229 is the check that
      // actually holds on WKWebView / WebKitGTK.
      if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;

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
          key={JSON.stringify([selectedRepo.owner, selectedRepo.name, selectedRepo.branch])}
          repo={selectedRepo}
          onBack={handleBackFromRepo}
        />
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <ScrollArea
        className={
          loadingRepos ? "h-full [&_[data-radix-scroll-area-viewport]>div]:h-full" : "h-full"
        }
      >
        <div className="mx-auto flex min-h-full max-w-6xl flex-col p-6 pb-10">
          {/* Search bar with dropdown */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="relative max-w-xl flex-1" ref={searchRef}>
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground z-10" />
              <Input
                aria-label={t("browse.searchRepoPlaceholder")}
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
                        {/* Repository section. Only shown when an exact owner/name match is found */}
                        {repoResult && (
                          <>
                            <button
                              className="w-full text-left px-4 py-2.5 hover:bg-accent/50 transition-colors flex items-center justify-between gap-3"
                              onClick={() => navigateToRepo(repoResult)}
                            >
                              <div className="min-w-0">
                                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-0.5">
                                  {t("browse.repository")}
                                </p>
                                <p className="text-[13px] font-medium truncate">
                                  {repoResult.owner}/{repoResult.name}
                                </p>
                              </div>
                              <span className="text-xs text-muted-foreground shrink-0">
                                {t("browse.viewRepo")}
                              </span>
                            </button>
                            <div className="border-t border-border/60" />
                          </>
                        )}

                        {/* Skills section. skills.sh fuzzy search results */}
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
                                <span className="text-xs text-muted-foreground truncate">
                                  {skill.repoOwner}/{skill.repoName}
                                </span>
                                {skill.installs != null && (
                                  <span className="text-xs text-muted-foreground shrink-0">
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
            <div className="mt-6 shrink-0">
              <BannerCarousel banners={banners} onBannerClick={handleBannerClick} />
            </div>
          )}

          {/* Recently viewed repos */}
          {recentToDisplay.length > 0 && (
            <div className="mt-6 shrink-0">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold">{t("browse.recentlyViewed")}</h2>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={clearRecent}>
                  {t("browse.clearHistory")}
                </Button>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-3">
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
            <div
              className="mt-6 flex-1 min-h-0 overflow-clip"
              role="status"
              aria-label={t("common.loading")}
            >
              <Skeleton className="h-3 w-24 mb-3" />
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="rounded-xl border bg-card p-4 space-y-3">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-4/5" />
                  </div>
                ))}
              </div>
            </div>
          ) : reposError ? (
            <div className="mt-6 flex-1 flex flex-col items-center justify-center gap-3">
              <AlertTriangle className="h-8 w-8 text-destructive/60" />
              <p className="text-sm text-destructive">{t("error.generic")}</p>
              <Button size="sm" variant="outline" onClick={() => refetchRepos()}>
                {t("error.retry")}
              </Button>
            </div>
          ) : repos.length === 0 ? (
            <div className="mt-6 flex-1 flex items-center justify-center">
              <p className="text-sm text-muted-foreground">{t("browse.noRepos")}</p>
            </div>
          ) : (
            <div className="mt-6">
              <h2 className="text-sm font-semibold mb-3">{t("browse.recommended")}</h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-3">
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
          <CommunitySkills onOpen={setPreviewTarget} />
        </div>
      </ScrollArea>
      <SkillPreviewPanel
        open={!!previewTarget}
        loading={!!previewTarget && (!previewRepoSkills || panelContentLoading)}
        error={
          previewMissing
            ? t("browse.catalogSkillMissing", { name: previewTarget?.skillId })
            : panelContentError
              ? null
              : undefined
        }
        content={panelContent}
        installStatus={previewSkill?.installStatus}
        installPending={installMutation.isPending}
        onInstall={() => {
          if (previewSkill) setInstallSkill(previewSkill);
        }}
        fallbackSkills={previewMissing ? previewRepoSkills?.skills : undefined}
        onPickFallback={setManualSkill}
        onClose={() => setPreviewTarget(null)}
      />
      {installSkill && (
        <SkillInstallDialog
          open={!!installSkill}
          onOpenChange={(open) => {
            if (!open) setInstallSkill(null);
          }}
          skills={[installSkill]}
          repoOwner={installSkill.repoOwner}
          repoName={installSkill.repoName}
          onInstall={handlePanelInstall}
          isPending={installMutation.isPending}
        />
      )}
    </div>
  );
}

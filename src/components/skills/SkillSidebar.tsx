import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Archive,
  User,
  Star,
  Import,
  Folder,
  Layers,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { InstalledSkill } from "@/types/skills";
import type { SidebarCategory } from "@/hooks/useSidebarFilter";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useStarSkillDropTarget } from "@/components/skills/SkillDndLayer";

function CountBadge({ count }: { count: number }) {
  return (
    <span className="shrink-0 ml-2 text-[11px] text-muted-foreground bg-muted/70 px-2 py-0.5 rounded-full min-w-[1.75rem] text-center">
      {count}
    </span>
  );
}

interface SkillSidebarProps {
  skills: InstalledSkill[];
  countSkills?: InstalledSkill[];
  archivedCount?: number;
  countArchivedCount?: number;
  consistencyCount?: number;
  category: SidebarCategory;
  onSelectCategory: (cat: SidebarCategory) => void;
  draggedSkill?: InstalledSkill | null;
}

export function SkillSidebar({
  skills,
  countSkills = skills,
  archivedCount = 0,
  countArchivedCount = archivedCount,
  consistencyCount = 0,
  category,
  onSelectCategory,
  draggedSkill,
}: SkillSidebarProps) {
  const { t } = useTranslation();
  const [reposExpanded, setReposExpanded] = useState(true);
  const { ref: starDropRef, isDropTarget: starDropActive } = useStarSkillDropTarget();

  const countSkillIds = useMemo(() => new Set(countSkills.map((s) => s.id)), [countSkills]);

  const {
    starredCount,
    filteredStarredCount,
    importedCount,
    filteredImportedCount,
    mineCount,
    filteredMineCount,
    repos,
  } = useMemo(() => {
    const repoMap = new Map<string, { owner: string; name: string; maxUpdatedAt: number }>();
    let nextStarredCount = 0;
    let nextFilteredStarredCount = 0;
    let nextImportedCount = 0;
    let nextFilteredImportedCount = 0;
    let nextMineCount = 0;
    let nextFilteredMineCount = 0;

    for (const s of skills) {
      const countsTowardFilter = countSkillIds.has(s.id);
      if (s.starred) {
        nextStarredCount++;
        if (countsTowardFilter) nextFilteredStarredCount++;
      }
      if (s.origin === "external") {
        nextImportedCount++;
        if (countsTowardFilter) nextFilteredImportedCount++;
      }
      if (s.isMine) {
        nextMineCount++;
        if (countsTowardFilter) nextFilteredMineCount++;
      }

      if (s.repoOwner && s.repoName) {
        const key = `${s.repoOwner.toLowerCase()}/${s.repoName.toLowerCase()}`;
        const existing = repoMap.get(key);
        if (existing) {
          if (s.updatedAt && s.updatedAt > existing.maxUpdatedAt) {
            existing.maxUpdatedAt = s.updatedAt;
          }
        } else {
          repoMap.set(key, {
            owner: s.repoOwner,
            name: s.repoName,
            maxUpdatedAt: s.updatedAt,
          });
        }
      }
    }

    const nextRepos = Array.from(repoMap.values()).toSorted((a, b) => {
      // Missing time → end
      if (!a.maxUpdatedAt && !b.maxUpdatedAt)
        return a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name);
      if (!a.maxUpdatedAt) return 1;
      if (!b.maxUpdatedAt) return -1;
      // Descending by maxUpdatedAt
      if (b.maxUpdatedAt !== a.maxUpdatedAt) return b.maxUpdatedAt - a.maxUpdatedAt;
      // Tiebreak: alphabetical
      return a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name);
    });

    return {
      starredCount: nextStarredCount,
      filteredStarredCount: nextFilteredStarredCount,
      importedCount: nextImportedCount,
      filteredImportedCount: nextFilteredImportedCount,
      mineCount: nextMineCount,
      filteredMineCount: nextFilteredMineCount,
      repos: nextRepos,
    };
  }, [countSkillIds, skills]);

  const isActive = (cat: SidebarCategory) =>
    category.type === cat.type && JSON.stringify(category) === JSON.stringify(cat);

  const allCount = isActive({ type: "all" }) ? countSkills.length : skills.length;
  const starCount = isActive({ type: "starred" }) ? filteredStarredCount : starredCount;
  const importCount = isActive({ type: "import" }) ? filteredImportedCount : importedCount;
  const mySkillsCount = isActive({ type: "mine" }) ? filteredMineCount : mineCount;
  const archiveCount = isActive({ type: "archived" }) ? countArchivedCount : archivedCount;
  const canDropStar = !!draggedSkill && !draggedSkill.starred;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="w-[220px] h-full shrink-0 border-r border-border/60 bg-sidebar flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-4">
          <span className="text-sm font-medium tracking-wide uppercase text-muted-foreground">
            {t("sidebar.title")}
          </span>
        </div>

        <ScrollArea className="flex-1">
          {/* All */}
          <button
            onClick={() => onSelectCategory({ type: "all" })}
            className={cn(
              "w-full px-4 py-2.5 flex items-center text-[13px] transition-colors",
              isActive({ type: "all" })
                ? "bg-primary/5 text-foreground border-l-2 border-l-primary"
                : "text-foreground/70 hover:bg-accent/50 hover:text-foreground",
            )}
          >
            <span className="flex items-center gap-2.5 min-w-0 flex-1">
              <Layers className="h-4 w-4 shrink-0" />
              <span>{t("sidebar.all")}</span>
            </span>
            <CountBadge count={allCount} />
          </button>

          {/* Star */}
          <button
            ref={starDropRef}
            onClick={() => onSelectCategory({ type: "starred" })}
            className={cn(
              "w-full px-4 py-2.5 flex items-center text-[13px] transition-all",
              draggedSkill
                ? "bg-primary/5 text-foreground border-l-2 border-l-primary ring-1 ring-inset ring-primary/25"
                : isActive({ type: "starred" })
                  ? "bg-primary/5 text-foreground border-l-2 border-l-primary"
                  : "text-foreground/70 hover:bg-accent/50 hover:text-foreground",
              starDropActive && canDropStar && "bg-primary/10 ring-primary/60",
            )}
          >
            <span className="flex items-center gap-2.5 min-w-0 flex-1">
              <Star className={cn("h-4 w-4 shrink-0", draggedSkill && "fill-current")} />
              <span>
                {draggedSkill
                  ? t(draggedSkill.starred ? "sidebar.alreadyStarred" : "sidebar.dropToStar")
                  : t("sidebar.star")}
              </span>
            </span>
            {!draggedSkill && <CountBadge count={starCount} />}
          </button>

          {/* Import */}
          {importedCount > 0 && (
            <button
              onClick={() => onSelectCategory({ type: "import" })}
              className={cn(
                "w-full px-4 py-2.5 flex items-center text-[13px] transition-colors",
                isActive({ type: "import" })
                  ? "bg-primary/5 text-foreground border-l-2 border-l-primary"
                  : "text-foreground/70 hover:bg-accent/50 hover:text-foreground",
              )}
            >
              <span className="flex items-center gap-2.5 min-w-0 flex-1">
                <Import className="h-4 w-4 shrink-0" />
                <span>{t("sidebar.import")}</span>
              </span>
              <CountBadge count={importCount} />
            </button>
          )}

          {/* My Skills */}
          <button
            onClick={() => onSelectCategory({ type: "mine" })}
            className={cn(
              "w-full px-4 py-2.5 flex items-center text-[13px] transition-colors",
              isActive({ type: "mine" })
                ? "bg-primary/5 text-foreground border-l-2 border-l-primary"
                : "text-foreground/70 hover:bg-accent/50 hover:text-foreground",
            )}
          >
            <span className="flex items-center gap-2.5 min-w-0 flex-1">
              <User className="h-4 w-4 shrink-0" />
              <span>{t("sidebar.mySkills")}</span>
            </span>
            <CountBadge count={mySkillsCount} />
          </button>

          {/* Consistency */}
          {consistencyCount > 0 && (
            <button
              onClick={() => onSelectCategory({ type: "consistency" })}
              className={cn(
                "w-full px-4 py-2.5 flex items-center text-[13px] transition-colors",
                isActive({ type: "consistency" })
                  ? "bg-primary/5 text-foreground border-l-2 border-l-primary"
                  : "text-foreground/70 hover:bg-accent/50 hover:text-foreground",
              )}
            >
              <span className="flex items-center gap-2.5 min-w-0 flex-1">
                <ShieldCheck className="h-4 w-4 shrink-0" />
                <span>{t("sidebar.consistency")}</span>
              </span>
              <CountBadge count={consistencyCount} />
            </button>
          )}

          {/* Archive */}
          <button
            onClick={() => onSelectCategory({ type: "archived" })}
            className={cn(
              "w-full px-4 py-2.5 flex items-center text-[13px] transition-colors",
              isActive({ type: "archived" })
                ? "bg-primary/5 text-foreground border-l-2 border-l-primary"
                : "text-foreground/70 hover:bg-accent/50 hover:text-foreground",
            )}
          >
            <span className="flex items-center gap-2.5 min-w-0 flex-1">
              <Archive className="h-4 w-4 shrink-0" />
              <span>{t("sidebar.archive")}</span>
            </span>
            <CountBadge count={archiveCount} />
          </button>

          {/* Repos */}
          <div>
            <button
              onClick={() => setReposExpanded((v) => !v)}
              className={cn(
                "w-full px-4 py-2.5 flex items-center text-[13px] transition-colors text-left",
                "text-foreground/70 hover:bg-accent/50 hover:text-foreground",
              )}
            >
              <span className="flex items-center gap-2.5 min-w-0 flex-1">
                <Folder className="h-4 w-4 shrink-0" />
                <span>{t("sidebar.repos")}</span>
              </span>
              {reposExpanded ? (
                <ChevronUp className="h-4 w-4 shrink-0 ml-1 mr-1.5" />
              ) : (
                <ChevronDown className="h-4 w-4 shrink-0 ml-1 mr-1.5" />
              )}
            </button>
            <div
              className={cn(
                "overflow-hidden transition-all duration-200 ease-in-out",
                reposExpanded ? "max-h-[1000px] opacity-100" : "max-h-0 opacity-0",
              )}
            >
              {repos.map((repo) => (
                <Tooltip key={`${repo.owner}/${repo.name}`}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() =>
                        onSelectCategory({ type: "repo", owner: repo.owner, name: repo.name })
                      }
                      className={cn(
                        "w-full px-4 py-2 flex items-center text-[13px] transition-colors pl-8",
                        isActive({ type: "repo", owner: repo.owner, name: repo.name })
                          ? "bg-primary/5 text-foreground border-l-2 border-l-primary"
                          : "text-foreground/70 hover:bg-accent/50 hover:text-foreground",
                      )}
                    >
                      <span className="flex items-center min-w-0 flex-1">
                        <span className="truncate">
                          {repo.owner}/{repo.name}
                        </span>
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="text-xs" data-selectable>
                    {repo.owner}/{repo.name}
                  </TooltipContent>
                </Tooltip>
              ))}
              <button
                onClick={() => onSelectCategory({ type: "unassigned" })}
                className={cn(
                  "w-full px-4 py-2 flex items-center text-[13px] transition-colors pl-8",
                  isActive({ type: "unassigned" })
                    ? "bg-primary/5 text-foreground border-l-2 border-l-primary"
                    : "text-foreground/70 hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <span className="flex items-center min-w-0 flex-1">
                  <span className="truncate">{t("sidebar.unassigned")}</span>
                </span>
              </button>
            </div>
          </div>
        </ScrollArea>
      </div>
    </TooltipProvider>
  );
}

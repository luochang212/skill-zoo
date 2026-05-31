import { useState } from "react";
import { useTranslation } from "react-i18next";
import { User, Star, Folder, Layers, ShieldCheck, ChevronDown, ChevronUp } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { InstalledSkill } from "@/types/skills";
import type { SidebarCategory } from "@/hooks/useSidebarFilter";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface SkillSidebarProps {
  skills: InstalledSkill[];
  consistencyCount?: number;
  category: SidebarCategory;
  onSelectCategory: (cat: SidebarCategory) => void;
}

export function SkillSidebar({
  skills,
  consistencyCount = 0,
  category,
  onSelectCategory,
}: SkillSidebarProps) {
  const { t } = useTranslation();
  const [reposExpanded, setReposExpanded] = useState(true);

  const starredCount = skills.filter((s) => s.starred).length;
  const mineCount = skills.filter((s) => s.isMine).length;

  // Aggregate repos with counts and max updatedAt
  const repoMap = new Map<string, { owner: string; name: string; count: number; maxUpdatedAt: number }>();
  for (const s of skills) {
    if (s.repoOwner && s.repoName) {
      const key = `${s.repoOwner}/${s.repoName}`;
      const existing = repoMap.get(key);
      if (existing) {
        existing.count++;
        if (s.updatedAt && s.updatedAt > existing.maxUpdatedAt) {
          existing.maxUpdatedAt = s.updatedAt;
        }
      } else {
        repoMap.set(key, { owner: s.repoOwner, name: s.repoName, count: 1, maxUpdatedAt: s.updatedAt });
      }
    }
  }
  const repos = Array.from(repoMap.values()).sort((a, b) => {
    // Missing time → end
    if (!a.maxUpdatedAt && !b.maxUpdatedAt) return a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name);
    if (!a.maxUpdatedAt) return 1;
    if (!b.maxUpdatedAt) return -1;
    // Descending by maxUpdatedAt
    if (b.maxUpdatedAt !== a.maxUpdatedAt) return b.maxUpdatedAt - a.maxUpdatedAt;
    // Tiebreak: alphabetical
    return a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name);
  });

  const isActive = (cat: SidebarCategory) =>
    category.type === cat.type && JSON.stringify(category) === JSON.stringify(cat);

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
            <span className="shrink-0 ml-2 text-[11px] text-muted-foreground bg-muted/70 px-2 py-0.5 rounded-full min-w-[1.75rem] text-center">
              {skills.length}
            </span>
          </button>

          {/* Star */}
          <button
            onClick={() => onSelectCategory({ type: "starred" })}
            className={cn(
              "w-full px-4 py-2.5 flex items-center text-[13px] transition-colors",
              isActive({ type: "starred" })
                ? "bg-primary/5 text-foreground border-l-2 border-l-primary"
                : "text-foreground/70 hover:bg-accent/50 hover:text-foreground",
            )}
          >
            <span className="flex items-center gap-2.5 min-w-0 flex-1">
              <Star className="h-4 w-4 shrink-0" />
              <span>{t("sidebar.star")}</span>
            </span>
            <span className="shrink-0 ml-2 text-[11px] text-muted-foreground bg-muted/70 px-2 py-0.5 rounded-full min-w-[1.75rem] text-center">
              {starredCount}
            </span>
          </button>

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
            <span className="shrink-0 ml-2 text-[11px] text-muted-foreground bg-muted/70 px-2 py-0.5 rounded-full min-w-[1.75rem] text-center">
              {mineCount}
            </span>
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
              <span className="shrink-0 ml-2 text-[11px] text-muted-foreground bg-muted/70 px-2 py-0.5 rounded-full min-w-[1.75rem] text-center">
                {consistencyCount}
              </span>
            </button>
          )}

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
            </div>
          </div>
        </ScrollArea>
      </div>
    </TooltipProvider>
  );
}

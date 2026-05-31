import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  useInstalledSkills,
  useRemoveSkills,
  useStarSkill,
  useUnstarSkill,
} from "@/hooks/useSkills";
import { useConsistencyCheck } from "@/hooks/useSkillIssues";
import { useConsistencyLabelSettings } from "@/hooks/useConsistencyLabelSettings";
import { useVisibleAgentOrder, useHideNonSsot } from "@/hooks/useSettings";
import { useAgentConfigs } from "@/lib/agents";
import { SkillCard } from "@/components/skills/SkillCard";
import { SkillCardRow } from "@/components/skills/SkillCardRow";
import { SkillSidebar } from "@/components/skills/SkillSidebar";
import { ConsistencyPanel } from "@/components/skills/ConsistencyPanel";
import { ViewModeToggle } from "@/components/skills/ViewModeToggle";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RepoInfoPanel } from "@/components/skills/RepoInfoPanel";
import { AlertTriangle, ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import type { ViewMode } from "@/components/skills/ViewModeToggle";
import type { SidebarCategory } from "@/hooks/useSidebarFilter";
import type { InstalledSkill } from "@/types/skills";

interface InstalledSkillsProps {
  onViewSkill: (id: string, directory: string, name: string) => void;
  category: SidebarCategory;
  onSelectCategory: (cat: SidebarCategory) => void;
  onCreateSkill?: () => void;
}

type SortField = "name" | "repo" | "updatedAt";
type SortDirection = "asc" | "desc";

function SortArrow({ active, direction }: { active: boolean; direction: SortDirection }) {
  if (!active) return null;
  return direction === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
}

function ListHeader({
  allSelected,
  onToggleSelectAll,
  sortField,
  sortDirection,
  onSort,
}: {
  sortField: SortField;
  sortDirection: SortDirection;
  onSort: (field: SortField) => void;
  allSelected: boolean;
  onToggleSelectAll: () => void;
}) {
  const headerBtn = (field: SortField, label: string, className: string) => (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={`flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer ${className}`}
    >
      {label}
      <SortArrow active={sortField === field} direction={sortDirection} />
    </button>
  );

  return (
    <div className="flex items-center gap-4 px-5 py-1.5 border-b border-border/40">
      <div className="w-8 shrink-0 flex justify-center">
        <Checkbox checked={allSelected} onCheckedChange={onToggleSelectAll} />
      </div>
      {headerBtn("name", "Name", "w-48 shrink-0")}
      {headerBtn("repo", "Repo", "flex-1 min-w-0")}
      {headerBtn("updatedAt", "Updated", "w-28 shrink-0")}
      <div className="w-8 shrink-0" />
    </div>
  );
}

export function InstalledSkills({
  onViewSkill,
  category,
  onSelectCategory,
  onCreateSkill,
}: InstalledSkillsProps) {
  const { t } = useTranslation();
  const { data: skills, isLoading, isError, refetch } = useInstalledSkills();
  const { duplicateGroups, nameMismatches, issuesMap, consistencyCount } = useConsistencyCheck(
    skills ?? [],
  );
  const starMutation = useStarSkill();
  const unstarMutation = useUnstarSkill();
  const removeSkillsMutation = useRemoveSkills();
  const visibleAgentOrder = useVisibleAgentOrder();
  const { data: hideNonSsot } = useHideNonSsot();
  const { data: agentConfigs } = useAgentConfigs();
  const { showDuplicate, showConflict, showMismatch } = useConsistencyLabelSettings();

  const getFilteredIssues = (skillId: string) => {
    const issues = issuesMap.get(skillId);
    if (!issues) return undefined;
    const activeFlags: Record<string, boolean> = {};
    if (showConflict && issues.hasConflict) activeFlags.hasConflict = true;
    if (showMismatch && issues.isMismatch) activeFlags.isMismatch = true;
    if (showDuplicate && issues.isDuplicate) activeFlags.isDuplicate = true;
    return Object.keys(activeFlags).length > 0 ? (activeFlags as typeof issues) : undefined;
  };

  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  const [sortField, setSortField] = useState<SortField>("updatedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleToggleStar = (skill: InstalledSkill) => {
    if (skill.starred) {
      unstarMutation.mutate(skill.id);
    } else {
      starMutation.mutate(skill.id);
    }
  };

  useEffect(() => {
    setSelectedIds(new Set());
  }, [category.type]);

  useEffect(() => {
    if (viewMode === "grid") setSelectedIds(new Set());
  }, [viewMode]);

  if (isLoading) {
    return (
      <div className="flex h-full">
        {/* Skeleton sidebar */}
        <div className="w-[220px] h-full shrink-0 border-r border-border/60 bg-background/50 flex flex-col overflow-hidden">
          <div className="px-4 py-4">
            <Skeleton className="h-4 w-20" />
          </div>
          <ScrollArea className="flex-1 px-2">
            <div className="space-y-1">
              <Skeleton className="h-7 w-full rounded-lg" />
              <Skeleton className="h-7 w-full rounded-lg" />
              <Skeleton className="h-7 w-full rounded-lg" />
              <Skeleton className="h-7 w-4/5 rounded-lg" />
            </div>
          </ScrollArea>
        </div>

        {/* Skeleton main content */}
        <div className="flex flex-col flex-1 min-w-0 p-6">
          {/* Toolbar skeleton */}
          <div className="flex items-center gap-3 mb-6">
            <Skeleton className="h-9 w-64 rounded-md" />
            <div className="flex gap-0.5">
              <Skeleton className="h-7 w-10 rounded-lg" />
              <Skeleton className="h-7 w-14 rounded-lg" />
              <Skeleton className="h-7 w-16 rounded-lg" />
            </div>
            <div className="flex-1" />
            <Skeleton className="h-7 w-14 rounded-md" />
          </div>

          {/* Card grid skeleton */}
          <ScrollArea className="flex-1 pt-1 @container/main">
            <div className="grid grid-cols-2 @xl/main:grid-cols-3 gap-4 pb-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-xl border bg-card p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-4 rounded-full" />
                  </div>
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-5/6" />
                  <div className="flex gap-1.5 pt-1">
                    <Skeleton className="h-5 w-12 rounded-full" />
                    <Skeleton className="h-5 w-10 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-3">
          <AlertTriangle className="h-8 w-8 text-destructive/60 mx-auto" />
          <p className="text-sm text-destructive">{t("error.generic")}</p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            {t("error.retry")}
          </Button>
        </div>
      </div>
    );
  }

  const skillsList = skills ?? [];

  // Apply hideNonSsot setting first — this affects both sidebar counts and main list
  const visibleSkills = skillsList.filter((s) => {
    if (hideNonSsot && s.origin !== "ssot") return false;
    return true;
  });

  // Apply sidebar category filter
  const categoryFiltered = visibleSkills.filter((s) => {
    switch (category.type) {
      case "starred":
        return s.starred;
      case "mine":
        return s.isMine;
      case "repo":
        return s.repoOwner === category.owner && s.repoName === category.name;
      case "consistency":
        return true; // ConsistencyPanel handles its own rendering
      case "all":
      default:
        return true;
    }
  });

  // Apply search + agent filter on top of category filter
  const filtered = categoryFiltered.filter((s) => {
    if (search && !s.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (agentFilter !== "all" && !s.apps[agentFilter]) return false;
    return true;
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const handleToggleSelect = (skillId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(skillId)) next.delete(skillId);
      else next.add(skillId);
      return next;
    });
  };

  const handleDeselectAll = () => {
    setSelectedIds(new Set());
  };

  const sorted = filtered.toSorted((a, b) => {
    const dir = sortDirection === "asc" ? 1 : -1;

    switch (sortField) {
      case "name":
        return dir * a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

      case "repo": {
        const aRepo = a.repoOwner && a.repoName ? `${a.repoOwner}/${a.repoName}` : "";
        const bRepo = b.repoOwner && b.repoName ? `${b.repoOwner}/${b.repoName}` : "";
        // Empty values always last
        if (!aRepo && bRepo) return 1;
        if (aRepo && !bRepo) return -1;
        if (!aRepo && !bRepo) return 0;
        return dir * aRepo.localeCompare(bRepo, undefined, { sensitivity: "base" });
      }

      case "updatedAt": {
        const aTime = a.updatedAt ?? 0;
        const bTime = b.updatedAt ?? 0;
        return dir * (aTime - bTime);
      }

      default:
        return 0;
    }
  });

  const handleSelectAll = () => {
    setSelectedIds(new Set(sorted.map((s) => s.id)));
  };

  const allSelected = sorted.length > 0 && selectedIds.size === sorted.length;

  return (
    <div className="flex h-full relative">
      {/* Sidebar */}
      <SkillSidebar
        skills={visibleSkills}
        consistencyCount={consistencyCount}
        category={category}
        onSelectCategory={onSelectCategory}
      />

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex-1 min-h-0 p-6 pb-0 flex flex-col">
          {/* Toolbar — hidden in consistency view since it has its own panel */}
          {category.type !== "consistency" && (
            <div className="flex items-center gap-3 mb-6">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("installed.searchPlaceholder")}
                className="h-9 text-[13px] max-w-xs rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
              />
              <div className="flex gap-0.5 flex-wrap">
                <button
                  onClick={() => setAgentFilter("all")}
                  className={`px-2.5 py-1.5 text-xs rounded-lg transition-colors ${
                    agentFilter === "all"
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  }`}
                >
                  {t("common.all")}
                </button>
                {visibleAgentOrder.map((a) => (
                  <button
                    key={a}
                    onClick={() => setAgentFilter(a)}
                    className={`px-2.5 py-1.5 text-xs rounded-lg transition-colors ${
                      agentFilter === a
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent"
                    }`}
                  >
                    {agentConfigs?.find((c) => c.id === a)?.label ?? a}
                  </button>
                ))}
              </div>
              <div className="flex-1" />
              <ViewModeToggle value={viewMode} onChange={setViewMode} />
            </div>
          )}

          {/* Create skill row (only in "mine" category) */}
          {category.type === "mine" && (
            <div className="mb-5">
              <button
                onClick={onCreateSkill}
                className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-[13px] flex items-center justify-center gap-1.5 hover:bg-primary/90 transition-colors"
              >
                + {t("installed.createSkill")}
              </button>
            </div>
          )}

          {/* Consistency category — show ConsistencyPanel instead of cards */}
          {category.type === "consistency" ? (
            <ConsistencyPanel duplicateGroups={duplicateGroups} nameMismatches={nameMismatches} />
          ) : filtered.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm text-muted-foreground">{t("installed.noMatch")}</p>
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex gap-0">
              <ScrollArea className="flex-1 pt-1 @container/main">
              {viewMode === "grid" ? (
                <div className="grid grid-cols-2 @xl/main:grid-cols-3 gap-4 pb-3">
                  {sorted.map((skill) => (
                    <SkillCard
                      key={skill.id}
                      skill={skill}
                      isInstalled
                      onOpen={() => onViewSkill(skill.id, skill.directory, skill.name)}
                      onToggleStar={() => handleToggleStar(skill)}
                      starred={skill.starred}
                      issues={getFilteredIssues(skill.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col">
                  <ListHeader
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    allSelected={allSelected}
                    onToggleSelectAll={allSelected ? handleDeselectAll : handleSelectAll}
                  />
                  {sorted.map((skill) => (
                    <SkillCardRow
                      key={skill.id}
                      skill={skill}
                      isInstalled
                      onOpen={() => onViewSkill(skill.id, skill.directory, skill.name)}
                      onToggleStar={() => handleToggleStar(skill)}
                      starred={skill.starred}
                      issues={getFilteredIssues(skill.id)}
                      selected={selectedIds.has(skill.id)}
                      onToggleSelect={() => handleToggleSelect(skill.id)}
                    />
                  ))}
                </div>
              )}
            </ScrollArea>

            {category.type === "repo" && (
              <RepoInfoPanel
                owner={category.owner}
                name={category.name}
                skills={categoryFiltered}
              />
            )}
          </div>
          )}
        </div>

        {/* Floating action bar */}
        {viewMode !== "grid" && selectedIds.size > 0 && (
          <div className="border-t border-border bg-background/95 backdrop-blur-sm pl-5 pr-6 py-3 flex items-center justify-between shrink-0">
            <span className="text-sm text-muted-foreground">
              {t("browse.selectedCount", { count: selectedIds.size })}
            </span>
            <Button
              variant="destructive"
              size="sm"
              className="h-7 text-xs rounded-lg"
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              {t("browse.removeSelected")}
            </Button>
          </div>
        )}

        {/* Batch remove confirmation dialog */}
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent className="sm:max-w-[380px]" data-selectable>
            <DialogHeader>
              <DialogTitle>{t("removeDialog.title")}</DialogTitle>
              <DialogDescription>
                {t("removeDialog.batchDescription", { count: selectedIds.size })}{" "}
                {t("removeDialog.warning")}
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-40 border rounded-md">
              <div className="p-2 space-y-1">
                {Array.from(selectedIds).map((id) => {
                  const skill = sorted.find((s) => s.id === id);
                  return skill ? (
                    <p key={id} className="text-[13px] leading-tight truncate text-muted-foreground">
                      {skill.name}
                    </p>
                  ) : null;
                })}
              </div>
            </ScrollArea>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setConfirmOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={removeSkillsMutation.isPending}
                onClick={() => {
                  setConfirmOpen(false);
                  removeSkillsMutation.mutate(Array.from(selectedIds), {
                    onSuccess: (result) => {
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        result.removed.forEach((id) => next.delete(id));
                        return next;
                      });
                    },
                  });
                }}
              >
                {t("common.remove")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

import { memo, useMemo, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  useArchivedSkills,
  useArchiveSelectedSkills,
  useInstalledSkills,
  useRemoveSkills,
  useRestoreArchivedSkills,
  useStarSkill,
  useUnstarSkill,
} from "@/hooks/useSkills";
import { toast } from "sonner";
import { useConsistencyCheck, type SkillIssues } from "@/hooks/useSkillIssues";
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
import { AlertTriangle, Archive, ArrowUp, ArrowDown, RotateCcw, Trash2 } from "lucide-react";
import type { ViewMode } from "@/components/skills/ViewModeToggle";
import type { SidebarCategory } from "@/hooks/useSidebarFilter";
import type { ArchivedSkill, InstalledSkill } from "@/types/skills";

interface InstalledSkillsProps {
  onViewSkill: (id: string, directory: string, name: string) => void;
  onViewArchivedSkill: (archiveId: string, name: string) => void;
  category: SidebarCategory;
  onSelectCategory: (cat: SidebarCategory) => void;
  onCreateSkill?: () => void;
}

type SortField = "name" | "repo" | "updatedAt";
type SortDirection = "asc" | "desc";
type BatchAction = "archive" | "remove" | "restore";

const EMPTY_SKILLS: InstalledSkill[] = [];
const EMPTY_ARCHIVED_SKILLS: ArchivedSkill[] = [];

function matchesToolbarFilters(skill: InstalledSkill, search: string, agentFilter: string) {
  if (search && !skill.name.toLowerCase().includes(search.toLowerCase())) return false;
  if (agentFilter !== "all" && !skill.apps[agentFilter]) return false;
  return true;
}

function SortArrow({ active, direction }: { active: boolean; direction: SortDirection }) {
  if (!active) return null;
  return direction === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
}

function ListHeader({
  allSelected,
  onToggleSelectAll,
  selectable = true,
  dateLabel = "Updated",
  sortField,
  sortDirection,
  onSort,
}: {
  sortField: SortField;
  sortDirection: SortDirection;
  onSort: (field: SortField) => void;
  allSelected: boolean;
  onToggleSelectAll: () => void;
  selectable?: boolean;
  dateLabel?: string;
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
        {selectable && <Checkbox checked={allSelected} onCheckedChange={onToggleSelectAll} />}
      </div>
      {headerBtn("name", "Name", "w-48 shrink-0")}
      {headerBtn("repo", "Repo", "flex-1 min-w-0 hidden @2xl/main:flex")}
      {headerBtn("updatedAt", dateLabel, "w-28 shrink-0 hidden @md/main:flex")}
      <div className="w-8 shrink-0 hidden @lg/main:block" />
    </div>
  );
}

function BatchConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  items,
  confirmLabel,
  confirmVariant = "default",
  confirmPending,
  onConfirm,
  hint,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  items: Array<{ id: string; name: string }>;
  confirmLabel: string;
  confirmVariant?: "default" | "destructive";
  confirmPending?: boolean;
  onConfirm: () => void;
  hint?: string;
}) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[380px]" data-selectable>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-40 border rounded-md">
          <div className="p-2 space-y-1">
            {items.map((skill) => (
              <p
                key={skill.id}
                className="text-[13px] leading-tight truncate text-muted-foreground"
              >
                {skill.name}
              </p>
            ))}
          </div>
        </ScrollArea>
        {hint && <p className="text-xs text-muted-foreground px-1">{hint}</p>}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            variant={confirmVariant}
            size="sm"
            disabled={confirmPending || items.length === 0}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InstalledSkillsSkeleton({
  category,
  viewMode,
  agentCount,
}: {
  category: SidebarCategory;
  viewMode: ViewMode;
  agentCount: number;
}) {
  const showToolbar = category.type !== "consistency";
  const showCreateRow = category.type === "mine";

  return (
    <div className="flex h-full">
      <SkeletonSidebar />

      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex-1 min-h-0 p-6 pb-0 flex flex-col">
          {showToolbar && <SkeletonToolbar viewMode={viewMode} agentCount={agentCount} />}

          {showCreateRow && (
            <div className="mb-5">
              <Skeleton className="h-9 w-28 rounded-lg" />
            </div>
          )}

          {category.type === "consistency" ? (
            <SkeletonConsistencyPanel />
          ) : (
            <div className="flex-1 min-h-0 flex gap-0 relative">
              <ScrollArea className="flex-1 pt-1 @container/main">
                {viewMode === "grid" ? <SkeletonGrid /> : <SkeletonList />}
              </ScrollArea>
              {category.type === "repo" && (
                <div className="hidden @4col/main:block w-[260px] shrink-0 border-l border-border/50 ml-5 pl-5">
                  <Skeleton className="h-4 w-32 mb-3" />
                  <Skeleton className="h-3 w-24 mb-5" />
                  <div className="space-y-2">
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-11/12" />
                    <Skeleton className="h-3 w-4/5" />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SkeletonSidebar() {
  return (
    <div className="w-[220px] h-full shrink-0 border-r border-border/60 bg-sidebar flex flex-col overflow-hidden">
      <div className="px-4 py-4">
        <Skeleton className="h-4 w-20" />
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-0.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2.5 px-4 py-2.5">
              <Skeleton className="h-4 w-4 rounded shrink-0" />
              <Skeleton className="h-3.5 flex-1" />
              <Skeleton className="h-4 w-7 rounded-full shrink-0" />
            </div>
          ))}
          <div className="flex items-center gap-2.5 px-4 py-2.5">
            <Skeleton className="h-4 w-4 rounded shrink-0" />
            <Skeleton className="h-3.5 w-16" />
            <div className="flex-1" />
            <Skeleton className="h-4 w-4 rounded shrink-0" />
          </div>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center px-4 py-2 pl-8">
              <Skeleton className="h-3.5 w-full" />
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function SkeletonToolbar({ viewMode, agentCount }: { viewMode: ViewMode; agentCount: number }) {
  const pillCount = Math.max(2, Math.min(agentCount + 1, 5));

  return (
    <div className="flex items-center gap-3 mb-6">
      <Skeleton className="h-9 w-64 max-w-xs rounded-md" />
      <div className="flex gap-0.5 flex-wrap">
        {Array.from({ length: pillCount }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-12 rounded-lg" />
        ))}
      </div>
      <div className="flex-1" />
      <div className="inline-flex items-center bg-muted rounded-lg p-1 gap-1">
        <Skeleton
          className={`h-6 w-6 rounded-md ${viewMode === "grid" ? "bg-background shadow-sm" : ""}`}
        />
        <Skeleton
          className={`h-6 w-6 rounded-md ${viewMode === "list" ? "bg-background shadow-sm" : ""}`}
        />
      </div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 max-w-[780px] @md/main:grid-cols-2 @md/main:max-w-none @3col/main:grid-cols-3 @4col/main:grid-cols-4 gap-4 pt-1 pb-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-4 rounded-full shrink-0" />
          </div>
          <Skeleton className="h-3 w-1/2" />
          <div className="space-y-2 pt-1">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
          </div>
        </div>
      ))}
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-4 px-5 py-1.5 border-b border-border/40">
        <div className="w-8 shrink-0 flex justify-center">
          <Skeleton className="h-4 w-4 rounded" />
        </div>
        <Skeleton className="h-3 w-48 shrink-0" />
        <Skeleton className="h-3 flex-1 min-w-0 hidden @2xl/main:block" />
        <Skeleton className="h-3 w-28 shrink-0 hidden @md/main:block" />
        <div className="w-8 shrink-0 hidden @lg/main:block" />
      </div>
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-2">
          <div className="w-8 shrink-0 flex justify-center">
            <Skeleton className="h-4 w-4 rounded" />
          </div>
          <div className="w-48 shrink-0 min-w-0 flex items-center gap-2">
            <Skeleton className="h-4 flex-1" />
            {i % 4 === 0 && <Skeleton className="h-4 w-8 rounded-full shrink-0" />}
          </div>
          <Skeleton className="h-3 flex-1 min-w-0 hidden @2xl/main:block" />
          <Skeleton className="h-3 w-28 shrink-0 hidden @md/main:block" />
          <div className="w-8 shrink-0 hidden @lg/main:flex justify-center">
            <Skeleton className="h-4 w-4 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function SkeletonConsistencyPanel() {
  return (
    <div className="flex-1 min-h-0 pt-1">
      <div className="space-y-3 max-w-3xl">
        <Skeleton className="h-4 w-40" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-4 rounded" />
              <Skeleton className="h-4 w-44" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}

export const InstalledSkills = memo(function InstalledSkills({
  onViewSkill,
  onViewArchivedSkill,
  category,
  onSelectCategory,
  onCreateSkill,
}: InstalledSkillsProps) {
  const { t } = useTranslation();
  const { data: skills, isLoading, isError, refetch } = useInstalledSkills();
  const {
    data: archivedSkills,
    isLoading: archivedLoading,
    isError: archivedError,
    error: archivedLoadError,
    refetch: refetchArchived,
  } = useArchivedSkills();
  const { duplicateGroups, nameMismatches, issuesMap, consistencyCount } = useConsistencyCheck(
    skills ?? [],
  );
  const starMutation = useStarSkill();
  const unstarMutation = useUnstarSkill();
  const removeSkillsMutation = useRemoveSkills();
  const archiveSkillsMutation = useArchiveSelectedSkills();
  const restoreArchivedSkillsMutation = useRestoreArchivedSkills();
  const visibleAgentOrder = useVisibleAgentOrder();
  const { data: hideNonSsot } = useHideNonSsot();
  const { data: agentConfigs } = useAgentConfigs();
  const { showDuplicate, showConflict, showMismatch } = useConsistencyLabelSettings();

  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  const [sortField, setSortField] = useState<SortField>("updatedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchAction, setBatchAction] = useState<BatchAction | null>(null);

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

  const skillsList = skills ?? EMPTY_SKILLS;
  const archivedList = archivedSkills ?? EMPTY_ARCHIVED_SKILLS;
  const isArchiveView = category.type === "archived";

  const visibleSkills = useMemo(
    () => skillsList.filter((s) => !hideNonSsot || s.origin === "ssot"),
    [hideNonSsot, skillsList],
  );

  const sidebarCountSkills = useMemo(
    () => visibleSkills.filter((s) => matchesToolbarFilters(s, search, agentFilter)),
    [agentFilter, search, visibleSkills],
  );

  const sidebarArchivedCount = useMemo(
    () => archivedList.filter((s) => matchesToolbarFilters(s, search, agentFilter)).length,
    [agentFilter, archivedList, search],
  );

  const filteredIssuesMap = useMemo(() => {
    const result = new Map<string, SkillIssues>();
    for (const [skillId, issues] of issuesMap) {
      const activeFlags: Record<string, boolean> = {};
      if (showConflict && issues.hasConflict) activeFlags.hasConflict = true;
      if (showMismatch && issues.isMismatch) activeFlags.isMismatch = true;
      if (showDuplicate && issues.isDuplicate) activeFlags.isDuplicate = true;
      if (Object.keys(activeFlags).length > 0) {
        result.set(skillId, activeFlags as typeof issues);
      }
    }
    return result;
  }, [issuesMap, showConflict, showDuplicate, showMismatch]);

  const categoryFiltered = useMemo(
    () =>
      isArchiveView
        ? archivedList
        : visibleSkills.filter((s) => {
            switch (category.type) {
              case "starred":
                return s.starred;
              case "import":
                return s.origin === "external";
              case "mine":
                return s.isMine;
              case "repo":
                return (
                  s.repoOwner?.toLowerCase() === category.owner.toLowerCase() &&
                  s.repoName?.toLowerCase() === category.name.toLowerCase()
                );
              case "unassigned":
                return !(s.repoOwner && s.repoName);
              case "consistency":
                return true; // ConsistencyPanel handles its own rendering
              case "all":
              default:
                return true;
            }
          }),
    [archivedList, category, isArchiveView, visibleSkills],
  );

  const filtered = useMemo(
    () => categoryFiltered.filter((s) => matchesToolbarFilters(s, search, agentFilter)),
    [agentFilter, categoryFiltered, search],
  );

  const sorted = useMemo(
    () =>
      filtered.toSorted((a, b) => {
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
            const aTime = isArchiveView
              ? ((a as ArchivedSkill).archivedAt ?? 0)
              : (a.updatedAt ?? 0);
            const bTime = isArchiveView
              ? ((b as ArchivedSkill).archivedAt ?? 0)
              : (b.updatedAt ?? 0);
            return dir * (aTime - bTime);
          }

          default:
            return 0;
        }
      }),
    [filtered, isArchiveView, sortDirection, sortField],
  );

  const visibleSelectedSkills = useMemo(
    () => sorted.filter((s) => selectedIds.has(s.id)),
    [selectedIds, sorted],
  );
  const visibleSelectedIds = useMemo(
    () => visibleSelectedSkills.map((s) => s.id),
    [visibleSelectedSkills],
  );
  const allSelected = sorted.length > 0 && visibleSelectedIds.length === sorted.length;

  const batchDialogItems = useMemo(
    () =>
      visibleSelectedSkills.map((skill) => ({
        id: skill.id,
        name: skill.name,
      })),
    [visibleSelectedSkills],
  );

  const hasExternalInSelection = useMemo(
    () => visibleSelectedSkills.some((s) => s.origin === "external"),
    [visibleSelectedSkills],
  );

  if (isLoading || (category.type === "archived" && archivedLoading)) {
    return (
      <InstalledSkillsSkeleton
        category={category}
        viewMode={viewMode}
        agentCount={visibleAgentOrder.length}
      />
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

  if (isArchiveView && archivedError) {
    return (
      <div className="flex h-full relative">
        <SkillSidebar
          skills={visibleSkills}
          countSkills={sidebarCountSkills}
          archivedCount={archivedList.length}
          countArchivedCount={sidebarArchivedCount}
          consistencyCount={consistencyCount}
          category={category}
          onSelectCategory={onSelectCategory}
        />
        <div className="flex-1 min-w-0 flex items-center justify-center p-6">
          <div className="text-center space-y-3 max-w-md">
            <AlertTriangle className="h-8 w-8 text-destructive/60 mx-auto" />
            <p className="text-sm font-medium text-destructive">
              {t("installed.archiveLoadFailed")}
            </p>
            <p className="text-xs text-muted-foreground break-words">{String(archivedLoadError)}</p>
            <Button size="sm" variant="outline" onClick={() => refetchArchived()}>
              {t("error.retry")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

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

  const handleDeselectVisible = () => {
    const visibleIds = new Set(sorted.map((s) => s.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      visibleIds.forEach((id) => next.delete(id));
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      sorted.forEach((s) => next.add(s.id));
      return next;
    });
  };

  const clearSucceededSelection = (ids: string[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  };

  const handleBatchArchive = () => {
    const skillIds = visibleSelectedIds;
    setBatchAction(null);
    archiveSkillsMutation.mutate(skillIds, {
      onSuccess: (result) => {
        clearSucceededSelection(result.archived);
        if (result.failed.length > 0) {
          toast.warning(t("archiveDialog.batchPartialFailed", { count: result.failed.length }));
        }
      },
    });
  };

  const handleBatchRemove = () => {
    const skillIds = visibleSelectedIds;
    setBatchAction(null);
    removeSkillsMutation.mutate(skillIds, {
      onSuccess: (result) => {
        clearSucceededSelection(result.removed);
        if (result.failed.length > 0) {
          toast.warning(t("removeDialog.batchPartialFailed", { count: result.failed.length }));
        }
      },
    });
  };

  const handleBatchRestore = () => {
    const archiveIds = visibleSelectedIds;
    setBatchAction(null);
    restoreArchivedSkillsMutation.mutate(archiveIds, {
      onSuccess: (result) => {
        clearSucceededSelection(result.restored);
        if (result.failed.length > 0) {
          toast.warning(t("restoreDialog.batchPartialFailed", { count: result.failed.length }));
        }
      },
    });
  };

  return (
    <div className="flex h-full relative">
      {/* Sidebar */}
      <SkillSidebar
        skills={visibleSkills}
        countSkills={sidebarCountSkills}
        archivedCount={archivedList.length}
        countArchivedCount={sidebarArchivedCount}
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
          ) : (
            <div className="flex-1 min-h-0 flex gap-0 relative">
              {filtered.length === 0 ? (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-sm text-muted-foreground">{t("installed.noMatch")}</p>
                </div>
              ) : (
                <ScrollArea className="flex-1 pt-1 @container/main">
                  {viewMode === "grid" ? (
                    <div className="grid grid-cols-1 max-w-[780px] @md/main:grid-cols-2 @md/main:max-w-none @3col/main:grid-cols-3 @4col/main:grid-cols-4 gap-4 pt-1 pb-3">
                      {sorted.map((skill) => (
                        <SkillCard
                          key={skill.id}
                          skill={
                            isArchiveView
                              ? { ...skill, updatedAt: (skill as ArchivedSkill).archivedAt }
                              : skill
                          }
                          isInstalled
                          onOpen={() =>
                            isArchiveView
                              ? onViewArchivedSkill(skill.id, skill.name)
                              : onViewSkill(skill.id, skill.directory, skill.name)
                          }
                          onToggleStar={isArchiveView ? undefined : () => handleToggleStar(skill)}
                          starred={skill.starred}
                          issues={isArchiveView ? undefined : filteredIssuesMap.get(skill.id)}
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
                        onToggleSelectAll={allSelected ? handleDeselectVisible : handleSelectAll}
                        selectable
                        dateLabel={isArchiveView ? t("skill.archived") : t("skill.updated")}
                      />
                      {sorted.map((skill) => (
                        <SkillCardRow
                          key={skill.id}
                          skill={
                            isArchiveView
                              ? { ...skill, updatedAt: (skill as ArchivedSkill).archivedAt }
                              : skill
                          }
                          isInstalled
                          onOpen={() =>
                            isArchiveView
                              ? onViewArchivedSkill(skill.id, skill.name)
                              : onViewSkill(skill.id, skill.directory, skill.name)
                          }
                          onToggleStar={isArchiveView ? undefined : () => handleToggleStar(skill)}
                          starred={skill.starred}
                          issues={isArchiveView ? undefined : filteredIssuesMap.get(skill.id)}
                          selected={selectedIds.has(skill.id)}
                          onToggleSelect={() => handleToggleSelect(skill.id)}
                        />
                      ))}
                    </div>
                  )}
                </ScrollArea>
              )}

              {category.type === "repo" && filtered.length > 0 && (
                <RepoInfoPanel owner={category.owner} name={category.name} />
              )}
            </div>
          )}
        </div>

        {/* Floating action bar */}
        {viewMode !== "grid" && visibleSelectedIds.length > 0 && (
          <div className="border-t border-border bg-background/95 backdrop-blur-sm pl-5 pr-6 py-3 flex items-center justify-between shrink-0">
            <span className="text-sm text-muted-foreground">
              {t("browse.selectedCount", { count: visibleSelectedIds.length })}
            </span>
            <div className="flex items-center gap-2">
              {isArchiveView ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs rounded-lg"
                  disabled={restoreArchivedSkillsMutation.isPending}
                  onClick={() => setBatchAction("restore")}
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                  {t("browse.restoreSelected")}
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs rounded-lg"
                    disabled={archiveSkillsMutation.isPending || removeSkillsMutation.isPending}
                    onClick={() => setBatchAction("archive")}
                  >
                    <Archive className="h-3.5 w-3.5 mr-1.5" />
                    {t("browse.archiveSelected")}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-7 text-xs rounded-lg"
                    disabled={archiveSkillsMutation.isPending || removeSkillsMutation.isPending}
                    onClick={() => setBatchAction("remove")}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                    {t("browse.removeSelected")}
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        <BatchConfirmDialog
          open={batchAction === "archive"}
          onOpenChange={(open) => setBatchAction(open ? "archive" : null)}
          title={t("archiveDialog.batchTitle")}
          description={`${t("archiveDialog.batchDescription", { count: visibleSelectedIds.length })} ${t(
            "archiveDialog.warning",
          )}`}
          items={batchDialogItems}
          confirmLabel={
            archiveSkillsMutation.isPending ? t("common.archiving") : t("common.archive")
          }
          confirmPending={archiveSkillsMutation.isPending}
          onConfirm={handleBatchArchive}
        />

        <BatchConfirmDialog
          open={batchAction === "restore"}
          onOpenChange={(open) => setBatchAction(open ? "restore" : null)}
          title={t("restoreDialog.batchTitle")}
          description={`${t("restoreDialog.batchDescription", { count: visibleSelectedIds.length })} ${t(
            "restoreDialog.warning",
          )}`}
          items={batchDialogItems}
          confirmLabel={
            restoreArchivedSkillsMutation.isPending ? t("common.restoring") : t("common.restore")
          }
          confirmPending={restoreArchivedSkillsMutation.isPending}
          onConfirm={handleBatchRestore}
        />

        <BatchConfirmDialog
          open={batchAction === "remove"}
          onOpenChange={(open) => setBatchAction(open ? "remove" : null)}
          title={t("removeDialog.title")}
          description={`${t("removeDialog.batchDescription", { count: visibleSelectedIds.length })} ${t(
            "removeDialog.warning",
          )}`}
          items={batchDialogItems}
          confirmLabel={t("common.remove")}
          confirmVariant="destructive"
          confirmPending={removeSkillsMutation.isPending}
          onConfirm={handleBatchRemove}
          hint={hasExternalInSelection ? t("removeDialog.externalImportNote") : undefined}
        />
      </div>
    </div>
  );
});

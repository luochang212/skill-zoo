import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  useRepoMetadata,
  useInstallSkills,
  useRemoveSkill,
  useSkillPreview,
} from "@/hooks/useSkills";
import { useRepoTask } from "@/hooks/useRepoTasks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SkillInstallDialog } from "@/components/skills/SkillInstallDialog";
import { SkillPreviewPanel } from "@/components/skills/SkillPreviewPanel";
import { formatApiError, isCancelledError } from "@/lib/api/errors";
import { toggleSetItem, cn } from "@/lib/utils";
import {
  compressedGroupLabels,
  duplicateSkillNames,
  filterSkillsBySubtree,
  groupSkillsByParentPath,
  parentPathOf,
} from "@/lib/skillGrouping";
import { toast } from "sonner";
import type { DiscoverRepo, DiscoverableSkill } from "@/types/skills";
import { BackButton } from "@/components/ui/BackButton";
import { QueryErrorState } from "@/components/ui/QueryErrorState";
import {
  AlertTriangle,
  Star,
  GitFork,
  ExternalLink,
  RotateCw,
  Loader,
  CircleOff,
  List,
  ListTree,
  X,
} from "lucide-react";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type RepoViewMode = "flat" | "grouped";

interface RepoSkillRowProps {
  skill: DiscoverableSkill;
  selected: boolean;
  isLoading: boolean;
  removePending: boolean;
  showParentPath: boolean;
  onToggle: () => void;
  onPreview: () => void;
  onRemove: () => void;
}

function RepoSkillRow({
  skill,
  selected,
  isLoading,
  removePending,
  showParentPath,
  onToggle,
  onPreview,
  onRemove,
}: RepoSkillRowProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/40 px-4 py-3 hover:bg-accent/30 transition-colors">
      <Checkbox
        checked={skill.installStatus === "installed" || selected}
        disabled={isLoading || skill.installStatus !== "available"}
        onCheckedChange={onToggle}
        aria-label={
          skill.installStatus === "installed"
            ? t("common.installed")
            : skill.installStatus === "conflict"
              ? t("browse.nameConflict")
              : t("browse.selectSkill", { name: skill.name })
        }
        className="shrink-0"
      />
      <button type="button" className="min-w-0 flex-1 cursor-pointer text-left" onClick={onPreview}>
        <div className="flex items-baseline gap-x-2 min-w-0">
          <h4 className="text-[13px] font-medium hover:text-primary transition-colors shrink-0">
            {skill.name}
          </h4>
          {showParentPath && (
            <span className="text-[10px] font-mono text-muted-foreground/70 truncate">
              {parentPathOf(skill.key) || "/"}
            </span>
          )}
        </div>
        {skill.description && (
          <p className="text-[12px] text-muted-foreground/80 text-fade-right mt-0.5">
            {skill.description}
          </p>
        )}
      </button>
      {skill.installStatus === "installed" ? (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs rounded-lg shrink-0"
          disabled={isLoading || removePending}
          onClick={onRemove}
        >
          {t("common.uninstall")}
        </Button>
      ) : skill.installStatus === "conflict" ? (
        <Badge
          variant="destructive"
          className="h-7 shrink-0 px-2.5 text-xs font-medium"
          title={t("browse.nameConflictHint")}
        >
          {t("browse.nameConflict")}
        </Badge>
      ) : null}
    </div>
  );
}

interface GroupedRepoSkillsProps {
  groups: ReturnType<typeof groupSkillsByParentPath>;
  selectedKeys: Set<string>;
  isLoadingRepo: boolean;
  removePending: boolean;
  onToggle: (key: string) => void;
  onPreview: (skill: DiscoverableSkill) => void;
  onRemove: (skill: DiscoverableSkill) => void;
}

function GroupedRepoSkills({
  groups,
  selectedKeys,
  isLoadingRepo,
  removePending,
  onToggle,
  onPreview,
  onRemove,
}: GroupedRepoSkillsProps) {
  const labels = compressedGroupLabels(groups.map((g) => g.parentPath));

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <section key={group.parentPath}>
          {groups.length > 1 && (
            <div
              className="sticky top-0 z-10 -mx-5 px-9 py-1.5 bg-background/85 backdrop-blur-sm border-b border-border/60 flex items-baseline gap-2"
              title={group.parentPath || "/"}
            >
              <span className="text-[13px] font-mono text-muted-foreground truncate">
                {labels.get(group.parentPath) || group.parentPath || "/"}
              </span>
              <span className="text-[11px] text-muted-foreground/60 tabular-nums shrink-0">
                {group.skills.length}
              </span>
            </div>
          )}
          <div className="flex flex-col gap-2 pt-2">
            {group.skills.map((skill) => (
              <RepoSkillRow
                key={skill.key}
                skill={skill}
                selected={selectedKeys.has(skill.key)}
                isLoading={isLoadingRepo}
                removePending={removePending}
                showParentPath={false}
                onToggle={() => onToggle(skill.key)}
                onPreview={() => onPreview(skill)}
                onRemove={() => onRemove(skill)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

interface RepoDetailProps {
  repo: DiscoverRepo;
  onBack: () => void;
}

export function RepoDetail({ repo, onBack }: RepoDetailProps) {
  const { t } = useTranslation();

  const {
    data: skills,
    isLoading,
    isError,
    error,
    isFetching,
    progress: loadProgress,
    selectedKeys,
    setSelectedKeys,
    refresh,
  } = useRepoTask(repo);
  const { data: metadata } = useRepoMetadata(repo.owner, repo.name);
  const installMutation = useInstallSkills();
  const removeMutation = useRemoveSkill();

  const description = metadata?.description ?? repo.description;
  const stars = metadata?.stars;
  const forks = metadata?.forks;

  const [installSkills, setInstallSkills] = useState<DiscoverableSkill[] | null>(null);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<DiscoverableSkill | null>(null);
  const [previewSkill, setPreviewSkill] = useState<DiscoverableSkill | null>(null);
  const [viewMode, setViewMode] = useState<RepoViewMode>("flat");
  const [subtreeFilter, setSubtreeFilter] = useState<string | null>(repo.path?.trim() || null);

  const isLoadingRepo = isFetching || isLoading;
  const refreshRepo = () => {
    void refresh().catch(() => {});
  };

  const [showLoadStage, setShowLoadStage] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    if (isLoadingRepo) {
      if (debounceRef.current === null) {
        debounceRef.current = setTimeout(() => {
          setShowLoadStage(true);
        }, 500);
      }
    } else {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      setShowLoadStage(false);
    }
    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [isLoadingRepo]);

  const {
    data: previewContent,
    isLoading: previewLoading,
    isError: previewError,
  } = useSkillPreview(
    previewSkill?.repoOwner ?? null,
    previewSkill?.repoName ?? null,
    repo.branch,
    previewSkill?.key ?? null,
  );

  const handleInstallSelected = () => {
    if (selectedInstallable.length === 0) return;
    setInstallSkills(selectedInstallable);
  };

  const handleInstallSingle = (skill: DiscoverableSkill) => {
    setInstallSkills([skill]);
  };

  const handleRemoveConfirm = () => {
    if (!pendingRemove || removeMutation.isPending) return;
    const skillId = pendingRemove.installedSkillId;
    if (!skillId) {
      setRemoveConfirmOpen(false);
      setPendingRemove(null);
      return;
    }
    removeMutation.mutate(skillId, {
      onSuccess: () => {
        setRemoveConfirmOpen(false);
        setPendingRemove(null);
      },
    });
  };

  const handleInstall = (skillNames: string[], agents: string[]) => {
    if (!installSkills) return;
    const repoUrl = repo.branch
      ? `https://github.com/${repo.owner}/${repo.name}/tree/${repo.branch}`
      : `https://github.com/${repo.owner}/${repo.name}`;
    installMutation.mutate(
      { repoUrl, skillNames, agents },
      {
        onSuccess: (result) => {
          setInstallSkills(null);
          setSelectedKeys(new Set());
          if (result.skipped.length > 0) {
            toast.success(
              t("browse.skippedDuplicates", {
                count: result.installed.length,
                skipped: result.skipped.length,
              }),
            );
          }
        },
      },
    );
  };

  const { skills: skillList, total } = skills ?? { skills: [], total: 0 };
  const visibleSkills = subtreeFilter ? filterSkillsBySubtree(skillList, subtreeFilter) : skillList;
  const installableSkills = visibleSkills.filter((s) => s.installStatus === "available");
  const duplicateNames = duplicateSkillNames(visibleSkills);
  const allSelected =
    installableSkills.length > 0 && selectedKeys.size === installableSkills.length;
  const selectedInstallable = installableSkills.filter((s) => selectedKeys.has(s.key));

  const toggleKey = (key: string) => {
    setSelectedKeys((prev) => toggleSetItem(prev, key));
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(installableSkills.map((s) => s.key)));
    }
  };

  const isTruncated = total > skillList.length;

  useEffect(() => {
    if (!subtreeFilter || isLoadingRepo || skillList.length === 0) return;
    if (visibleSkills.length === 0) {
      toast.info(t("browse.subtreeNoMatch", { path: subtreeFilter }));
      setSubtreeFilter(null);
    }
  }, [subtreeFilter, isLoadingRepo, skillList.length, visibleSkills.length, t]);

  return (
    <div className="flex flex-col h-full relative" data-selectable>
      <div className="px-5 pt-4 pb-3 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <BackButton onClick={onBack} title={t("browse.backToDiscover")} />
            <h1 className="text-xl font-bold tracking-tight leading-tight truncate">
              {repo.owner}/{repo.name}
            </h1>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground translate-y-[1px]"
              disabled={isLoadingRepo}
              onClick={refreshRepo}
              aria-label={t("error.retry")}
            >
              {isLoadingRepo ? (
                <Loader className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCw className="h-3.5 w-3.5" />
              )}
            </Button>
            {showLoadStage && loadProgress && (
              <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                {t(`repoLoadStage.${loadProgress.stage}`)}
                {loadProgress.stage === "downloading" && loadProgress.downloaded > 0 && (
                  <span className="ml-1">
                    {formatBytes(loadProgress.downloaded)}
                    {loadProgress.total && <span> / {formatBytes(loadProgress.total)}</span>}
                  </span>
                )}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => openUrl(`https://github.com/${repo.owner}/${repo.name}`)}
            className="shrink-0 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            GitHub
            <ExternalLink className="h-3 w-3" />
          </button>
        </div>
        <div className="ml-11">
          <p className="text-sm text-muted-foreground mt-1">
            {description || t("browse.noDescription")}
          </p>
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {stars != null && (
                <span className="inline-flex items-center gap-0.5">
                  <Star className="h-3.5 w-3.5" />
                  {stars >= 1000 ? `${(stars / 1000).toFixed(1).replace(/\.0$/, "")}k` : stars}
                </span>
              )}
              {forks != null && (
                <span className="inline-flex items-center gap-0.5">
                  <GitFork className="h-3.5 w-3.5" />
                  {forks}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {skillList.length > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                  {t("browse.skills", { count: skillList.length })}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </div>
      {isLoadingRepo && !skills ? (
        <div
          className="flex-1 min-h-0 overflow-clip px-5 py-4"
          role="status"
          aria-label={t("common.loading")}
        >
          <div className="flex flex-col gap-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-lg border border-border/40 px-4 py-3"
              >
                <Skeleton className="h-4 w-4 rounded-sm shrink-0" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-72" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-5 py-4 pr-5 max-w-full">
            {isError && !isCancelledError(error) ? (
              <QueryErrorState
                className="py-12"
                message={formatApiError(error)}
                retryDisabled={isLoadingRepo}
                onRetry={refreshRepo}
              />
            ) : isCancelledError(error) && skillList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <CircleOff className="h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">{t("repoLoadCancelled")}</p>
                <Button size="sm" variant="outline" disabled={isLoadingRepo} onClick={refreshRepo}>
                  {t("error.retry")}
                </Button>
              </div>
            ) : skillList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <p className="text-sm">{t("browse.noSkillsToInstall")}</p>
              </div>
            ) : (
              <>
                {subtreeFilter && (
                  <div className="flex items-center mb-3 pl-4">
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-[11px] font-mono text-muted-foreground">
                      {subtreeFilter}
                      <button
                        type="button"
                        aria-label={t("browse.clearSubtreeFilter")}
                        title={t("browse.clearSubtreeFilter")}
                        onClick={() => setSubtreeFilter(null)}
                        className="cursor-pointer text-muted-foreground/60 hover:text-foreground transition-colors"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  </div>
                )}
                {installableSkills.length > 0 && (
                  <div className="flex items-center justify-between mb-4 pl-4 pr-1">
                    <label className="inline-flex items-center gap-3 text-[11px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={toggleAll}
                        disabled={isLoadingRepo}
                      />
                      {t("browse.selectAll")}
                    </label>
                    <button
                      type="button"
                      aria-label={t(viewMode === "flat" ? "browse.viewGrouped" : "browse.viewFlat")}
                      title={t(viewMode === "flat" ? "browse.viewGrouped" : "browse.viewFlat")}
                      onClick={() => setViewMode(viewMode === "flat" ? "grouped" : "flat")}
                      className="inline-flex shrink-0 items-center bg-muted rounded-lg p-1 gap-1 cursor-pointer"
                    >
                      <span
                        className={cn(
                          "p-1.5 rounded-md transition-all duration-200",
                          viewMode === "flat"
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground",
                        )}
                      >
                        <List className="h-3.5 w-3.5" />
                      </span>
                      <span
                        className={cn(
                          "p-1.5 rounded-md transition-all duration-200",
                          viewMode === "grouped"
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground",
                        )}
                      >
                        <ListTree className="h-3.5 w-3.5" />
                      </span>
                    </button>
                  </div>
                )}
                {viewMode === "flat" ? (
                  <div className="flex flex-col gap-2">
                    {visibleSkills.map((skill) => (
                      <RepoSkillRow
                        key={skill.key}
                        skill={skill}
                        selected={selectedKeys.has(skill.key)}
                        isLoading={isLoadingRepo}
                        removePending={removeMutation.isPending}
                        showParentPath={duplicateNames.has(skill.name)}
                        onToggle={() => toggleKey(skill.key)}
                        onPreview={() => setPreviewSkill(skill)}
                        onRemove={() => {
                          setPendingRemove(skill);
                          setRemoveConfirmOpen(true);
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <GroupedRepoSkills
                    groups={groupSkillsByParentPath(visibleSkills)}
                    selectedKeys={selectedKeys}
                    isLoadingRepo={isLoadingRepo}
                    removePending={removeMutation.isPending}
                    onToggle={toggleKey}
                    onPreview={setPreviewSkill}
                    onRemove={(skill) => {
                      setPendingRemove(skill);
                      setRemoveConfirmOpen(true);
                    }}
                  />
                )}

                {isTruncated && (
                  <div className="flex items-center gap-2 mt-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                    <p className="text-[11px] text-amber-700 dark:text-amber-300">
                      {t("browse.truncated", { shown: visibleSkills.length, total })}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      )}

      {installableSkills.length > 0 && (
        <div className="border-t border-border/60 bg-background px-5 py-3 flex items-center justify-between">
          <p className="text-xs">
            <span className="font-medium text-foreground">
              {t("browse.selectedItems", { count: selectedInstallable.length })}
            </span>
            <span className="text-muted-foreground"> / </span>
            <span className="text-muted-foreground">
              {t("browse.selectableTotal", { count: installableSkills.length })}
            </span>
          </p>
          <Button
            size="sm"
            className="press-feedback h-8 px-3.5 text-xs rounded-lg shrink-0"
            disabled={
              isLoadingRepo || installMutation.isPending || selectedInstallable.length === 0
            }
            onClick={handleInstallSelected}
          >
            {installMutation.isPending && <Loader className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            {t("browse.installSelected", { count: selectedInstallable.length })}
          </Button>
        </div>
      )}

      <Dialog open={removeConfirmOpen} onOpenChange={setRemoveConfirmOpen}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>{t("removeDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("removeDialog.description")}{" "}
              <span className="font-medium text-foreground">{pendingRemove?.name}</span>?{" "}
              {t("removeDialog.warning")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              disabled={removeMutation.isPending}
              onClick={() => setRemoveConfirmOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={removeMutation.isPending}
              onClick={handleRemoveConfirm}
            >
              {t("common.remove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {installSkills && (
        <SkillInstallDialog
          open={!!installSkills}
          onOpenChange={(open) => {
            if (!open) setInstallSkills(null);
          }}
          skills={installSkills}
          repoOwner={repo.owner}
          repoName={repo.name}
          repoBranch={repo.branch}
          onInstall={handleInstall}
          isPending={installMutation.isPending}
        />
      )}

      <SkillPreviewPanel
        skillName={previewSkill?.name ?? ""}
        open={!!previewSkill}
        loading={previewLoading}
        showProgressBar={false}
        error={previewError ? null : undefined}
        content={previewContent}
        installStatus={
          previewSkill
            ? (skills?.skills.find((s) => s.key === previewSkill.key)?.installStatus ??
              previewSkill.installStatus)
            : undefined
        }
        installPending={installMutation.isPending}
        onInstall={() => {
          if (previewSkill) handleInstallSingle(previewSkill);
        }}
        onClose={() => setPreviewSkill(null)}
      />
    </div>
  );
}

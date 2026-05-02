import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useRepoSkills, useRepoMetadata, useInstallSkills, useInstalledSkills, useRemoveSkill } from "@/hooks/useSkills";
import { skillsApi } from "@/lib/api/skills";
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
import { SkillInstallDialog } from "@/components/skills/SkillInstallDialog";
import type { DiscoverRepo, DiscoverableSkill } from "@/types/skills";
import { BackButton } from "@/components/ui/BackButton";
import { AlertTriangle, Star, GitFork, ExternalLink, Check, RotateCw, Loader } from "lucide-react";

interface RepoDetailProps {
  repo: DiscoverRepo;
  onBack: () => void;
}

export function RepoDetail({ repo, onBack }: RepoDetailProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: skills, isLoading, isError, error } = useRepoSkills(repo.owner, repo.name, repo.branch || undefined);
  const { data: metadata } = useRepoMetadata(repo.owner, repo.name);
  const installMutation = useInstallSkills();
  const removeMutation = useRemoveSkill();
  const { data: installedSkills = [] } = useInstalledSkills();
  const dirToId = useMemo(() => new Map(installedSkills.map(s => [s.directory, s.id])), [installedSkills]);

  // Use GitHub API metadata when available, fall back to static data
  const description = metadata?.description ?? repo.description;
  const stars = metadata?.stars;
  const forks = metadata?.forks;

  // Install dialog state
  const [installSkills, setInstallSkills] = useState<DiscoverableSkill[] | null>(null);
  const [selectedDirs, setSelectedDirs] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<DiscoverableSkill | null>(null);

  const handleRefresh = () => {
    setIsRefreshing(true);
    skillsApi.getRepoSkills(repo.owner, repo.name, repo.branch || undefined, true).then((data) => {
      qc.setQueryData(["repos", "skills", repo.owner, repo.name, repo.branch || undefined], data);
    }).catch(() => {
      // Silently ignore — stale data remains, user can retry
    }).finally(() => {
      setIsRefreshing(false);
    });
    qc.invalidateQueries({ queryKey: ["repos", "metadata", repo.owner, repo.name] });
  };

  const handleInstallSelected = () => {
    if (selectedInstallable.length === 0) return;
    setInstallSkills(selectedInstallable);
  };

  const handleInstallSingle = (skill: DiscoverableSkill) => {
    setInstallSkills([skill]);
  };

  const handleRemoveConfirm = () => {
    if (!pendingRemove) return;
    const skillId = dirToId.get(pendingRemove.directory);
    if (!skillId) {
      setRemoveConfirmOpen(false);
      setPendingRemove(null);
      return;
    }
    // Optimistic update: mark as uninstalled immediately
    const queryKey = ["repos", "skills", repo.owner, repo.name, repo.branch || undefined];
    qc.setQueryData<DiscoverableSkill[]>(queryKey, (old) => {
      if (!old) return old;
      return old.map(s => s.key === pendingRemove.key ? { ...s, installed: false } : s);
    });
    removeMutation.mutate(skillId, {
      onSuccess: () => {
        setRemoveConfirmOpen(false);
        setPendingRemove(null);
      },
      onError: () => {
        // Rollback on error
        qc.setQueryData<DiscoverableSkill[]>(queryKey, (old) => {
          if (!old) return old;
          return old.map(s => s.key === pendingRemove.key ? { ...s, installed: true } : s);
        });
      },
    });
  };

  const handleInstall = (skillNames: string[], agents: string[]) => {
    if (!installSkills) return;
    const repoUrl = `https://github.com/${repo.owner}/${repo.name}`;
    installMutation.mutate(
      { repoUrl, skillNames, agents },
      {
        onSuccess: () => {
          setInstallSkills(null);
          setSelectedDirs(new Set());
          // Mark installed skills in cache without re-downloading the repo
          const queryKey = ["repos", "skills", repo.owner, repo.name, repo.branch || undefined];
          qc.setQueryData<DiscoverableSkill[]>(queryKey, (old) => {
            if (!old) return old;
            const installedDirs = new Set(skillNames);
            return old.map((s) =>
              installedDirs.has(s.directory) ? { ...s, installed: true } : s
            );
          });
        },
      },
    );
  };

  const skillList = skills ?? [];
  const installableSkills = skillList.filter((s) => !s.installed);
  const allSelected = installableSkills.length > 0 && selectedDirs.size === installableSkills.length;
  const selectedInstallable = installableSkills.filter((s) => selectedDirs.has(s.directory));

  const toggleDir = (dir: string) => {
    const next = new Set(selectedDirs);
    if (next.has(dir)) next.delete(dir);
    else next.add(dir);
    setSelectedDirs(next);
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelectedDirs(new Set());
    } else {
      setSelectedDirs(new Set(installableSkills.map((s) => s.directory)));
    }
  };

  const isTruncated = skillList.length === 500;

  return (
    <div className="flex flex-col h-full">
      {/* Hero */}
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
              onClick={() => handleRefresh()}
              aria-label={t("error.retry")}
            >
              {isRefreshing ? (
                <Loader className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCw className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
          <a
            href={`https://github.com/${repo.owner}/${repo.name}`}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            GitHub
            <ExternalLink className="h-3 w-3" />
          </a>
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
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="px-5 py-4 pr-6 max-w-full">
          {isLoading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg border border-border/40 px-4 py-3">
                    <Skeleton className="h-4 w-4 rounded-sm shrink-0" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-3 w-72" />
                    </div>
                    <Skeleton className="h-5 w-14 rounded shrink-0" />
                  </div>
              ))}
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <AlertTriangle className="h-8 w-8 text-destructive/60" />
              <p className="text-sm text-destructive">{t("error.generic")}</p>
              <Button size="sm" variant="outline" onClick={handleRefresh}>
                {t("error.retry")}
              </Button>
            </div>
          ) : skillList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <p className="text-sm">{t("browse.noSkillsToInstall")}</p>
            </div>
          ) : (
            <>
              {installableSkills.length > 0 && (
                <label className="inline-flex items-center gap-3 text-[11px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors mb-4 pl-4">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleAll}
                    className="h-4 w-4"
                  />
                  {t("browse.selectAll")}
                </label>
              )}
              <div className="flex flex-col gap-2">
                {skillList.map((skill) => (
                  <div
                    key={skill.key}
                    className="flex items-center gap-3 rounded-lg border border-border/40 px-4 py-3 hover:bg-accent/30 transition-colors"
                  >
                    <Checkbox
                      checked={skill.installed || selectedDirs.has(skill.directory)}
                      disabled={skill.installed}
                      onCheckedChange={() => toggleDir(skill.directory)}
                      aria-label={skill.installed ? t("common.installed") : `Select ${skill.name}`}
                      className="h-4 w-4 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <h4 className="text-[13px] font-medium">{skill.name}</h4>
                      {skill.description && (
                        <p className="text-[12px] text-muted-foreground/80 line-clamp-1 mt-0.5">
                          {skill.description}
                        </p>
                      )}
                    </div>
                    {skill.installed ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs rounded-lg shrink-0"
                        onClick={() => { setPendingRemove(skill); setRemoveConfirmOpen(true); }}
                      >
                        {t("common.uninstall")}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 text-xs rounded-lg shrink-0"
                        onClick={() => handleInstallSingle(skill)}
                      >
                        {t("common.install")}
                      </Button>
                    )}
                  </div>
                ))}
              </div>

              {/* Truncation warning */}
              {isTruncated && (
                <div className="flex items-center gap-2 mt-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                  <p className="text-[11px] text-amber-700 dark:text-amber-300">
                    {t("browse.truncated", { shown: skillList.length, limit: 500 })}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Floating action bar for multi-select */}
      {selectedInstallable.length > 0 && (
        <div className="border-t border-border bg-background/95 backdrop-blur-sm pl-5 pr-6 py-3 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {t("browse.selectedCount", { count: selectedInstallable.length })}
          </span>
          <Button
            size="sm"
            className="h-7 text-xs rounded-lg"
            onClick={handleInstallSelected}
          >
            <Check className="h-3.5 w-3.5 mr-1.5" />
            {t("browse.installSelected")}
          </Button>
        </div>
      )}

      {/* Remove confirmation dialog */}
      <Dialog open={removeConfirmOpen} onOpenChange={setRemoveConfirmOpen}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>{t("removeDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("removeDialog.description")}{" "}
              <span className="font-medium text-foreground">{pendingRemove?.name}</span>?
              {" "}{t("removeDialog.warning")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRemoveConfirmOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleRemoveConfirm}
            >
              {t("common.remove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Install dialog */}
      {installSkills && (
        <SkillInstallDialog
          open={!!installSkills}
          onOpenChange={(open) => { if (!open) setInstallSkills(null); }}
          skills={installSkills}
          repoOwner={repo.owner}
          repoName={repo.name}
          repoBranch={repo.branch}
          onInstall={handleInstall}
          isPending={installMutation.isPending}
        />
      )}
    </div>
  );
}

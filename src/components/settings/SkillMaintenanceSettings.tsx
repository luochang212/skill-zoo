import {
  FolderInput,
  FolderOpen,
  FolderSearch,
  History,
  RefreshCw,
  Trash2,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  SkillUpdateManagerDialog,
  type SkillUpdateCandidate,
  type SkillUpdateIssue,
} from "@/components/settings/SkillUpdateManagerDialog";
import { LocalImportsDialog } from "@/components/settings/LocalImportsDialog";
import { Button } from "@/components/ui/button";
import { ToggleRow } from "@/components/ui/toggle-row";
import { useUpdateAllSkills, useInstalledSkills, useRescanSkills } from "@/hooks/useSkills";
import { useHideNonSsot, useUpdateHideNonSsot } from "@/hooks/useSettings";
import { useCheckUpdates } from "@/hooks/useCheckUpdates";
import { useIsMutationPending } from "@/hooks/usePendingMutation";
import { formatApiError } from "@/lib/api/errors";
import { skillsApi } from "@/lib/api/skills";
import { cn } from "@/lib/utils";

function formatSize(bytes: number) {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SkillMaintenanceSettings() {
  const { data: skills } = useInstalledSkills();
  const updateAllMutation = useUpdateAllSkills();
  const rescanMutation = useRescanSkills();
  const { data: hideNonSsot } = useHideNonSsot();
  const updateHideNonSsot = useUpdateHideNonSsot();
  const { t } = useTranslation();
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheSize, setCacheSize] = useState<number | null>(null);
  const [updateManagerOpen, setUpdateManagerOpen] = useState(false);
  const [localImportsOpen, setLocalImportsOpen] = useState(false);
  const updateManagerButtonRef = useRef<HTMLButtonElement>(null);

  const checkMutation = useCheckUpdates();

  const refreshCacheSize = useCallback(async () => {
    const size = await skillsApi.getCacheSize();
    setCacheSize(size);
  }, []);

  useEffect(() => {
    refreshCacheSize();
  }, [refreshCacheSize]);

  const installedCount = skills?.length ?? 0;

  const ssotSkillDirs = useMemo(
    () =>
      new Set(
        (skills ?? []).filter((skill) => skill.origin === "ssot").map((skill) => skill.directory),
      ),
    [skills],
  );

  const checkedUpdateCandidates = useMemo<SkillUpdateCandidate[]>(() => {
    if (!checkMutation.data) return [];
    return checkMutation.data.skills
      .filter(
        (skill) =>
          skill.hasUpdate &&
          skill.currentSha != null &&
          skill.latestSha != null &&
          ssotSkillDirs.has(skill.skillName),
      )
      .map((skill) => ({
        skillName: skill.skillName,
        currentSha: skill.currentSha!,
        latestSha: skill.latestSha!,
        repo: skill.repo,
      }));
  }, [checkMutation.data, ssotSkillDirs]);

  const checkedUpdateIssues = useMemo<SkillUpdateIssue[]>(() => {
    if (!checkMutation.data) return [];
    return checkMutation.data.skills
      .filter(
        (skill) =>
          skill.checkError != null &&
          skill.checkError.length > 0 &&
          ssotSkillDirs.has(skill.skillName),
      )
      .map((skill) => ({
        skillName: skill.skillName,
        repo: skill.repo,
        code: skill.checkErrorCode ?? "checkFailed",
        message: skill.checkError!,
      }));
  }, [checkMutation.data, ssotSkillDirs]);

  const updatableCount = checkedUpdateCandidates.length;
  const updateIssueCount = checkedUpdateIssues.length;

  const hasChecked = checkMutation.data != null;
  const isChecking = useIsMutationPending("checkSkillUpdates") || checkMutation.isPending;
  const isUpdating = useIsMutationPending("updateAllSkills") || updateAllMutation.isPending;
  const rateLimited = checkMutation.data?.rateLimited ?? false;
  const checkedRepos = checkMutation.data?.checkedRepos ?? 0;
  const rateLimitedWithoutResults = rateLimited && checkedRepos === 0;
  const rateLimitedWithPartialCheck = rateLimited && checkedRepos > 0;
  const showUpdateManagerButton =
    updatableCount > 0 || updateIssueCount > 0 || isUpdating || updateManagerOpen;

  const updateSummary = (() => {
    if (hasChecked && updatableCount > 0) {
      return t("settings.maintenance.updatesAvailable", { count: updatableCount });
    }
    if (hasChecked && updateIssueCount > 0) {
      return t("settings.maintenance.updateCheckIssues", { count: updateIssueCount });
    }
    return t("settings.maintenance.checkUpdate");
  })();

  const updateDescription = (() => {
    if (isChecking) return t("settings.maintenance.checkingDesc");
    if (hasChecked && updatableCount > 0) {
      return t("settings.maintenance.updatesAvailableDesc", { count: updatableCount });
    }
    if (hasChecked && rateLimitedWithoutResults) return t("settings.maintenance.checkRateLimited");
    if (hasChecked && rateLimitedWithPartialCheck) return t("settings.maintenance.checkPartial");
    if (hasChecked && updateIssueCount > 0) {
      return t("settings.maintenance.updateCheckIssuesDesc", { count: updateIssueCount });
    }
    if (hasChecked) return t("settings.maintenance.allUpToDate");
    return t("settings.maintenance.checkUpdateDesc");
  })();

  const updateCheckedCandidates = useCallback(
    (updates: SkillUpdateCandidate[]) => {
      updateAllMutation.mutate(
        updates.map((update) => ({
          skillName: update.skillName,
          currentSha: update.currentSha,
          latestSha: update.latestSha,
        })),
        {
          onSuccess: (result) => {
            checkMutation.reset();
            if (result.successCount > 0 && result.failCount === 0) {
              toast.success(
                t("settings.maintenance.updateAllSuccess", {
                  count: result.successCount,
                }),
              );
            } else if (result.failCount > 0) {
              const failure = result.errors[0]
                ? formatApiError(result.errors[0])
                : t("settings.maintenance.updateAllFailed");
              toast.warning(
                result.successCount > 0
                  ? `${t("settings.maintenance.updateAllPartial", {
                      success: result.successCount,
                      fail: result.failCount,
                    })}: ${failure}`
                  : failure,
              );
            } else {
              toast.error(t("settings.maintenance.updateAllFailed"));
            }
          },
        },
      );
    },
    [checkMutation, t, updateAllMutation],
  );

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 pb-2 border-b border-border/40">
        <Wrench className="h-4 w-4 text-blue-500" />
        <h3 className="text-sm font-medium">{t("settings.maintenance.title")}</h3>
      </div>

      <div className="space-y-4">
        {/* Check / Update manager */}
        <div className="group flex items-center justify-between rounded-xl border border-border bg-card/50 p-4 transition-colors hover:bg-muted/50">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-background ring-1 ring-border">
              <RefreshCw className="h-4 w-4 text-blue-500" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium leading-none">{updateSummary}</p>
              <p className="text-xs text-muted-foreground">{updateDescription}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              ref={updateManagerButtonRef}
              size="sm"
              variant="outline"
              className={cn(
                "h-8 text-xs gap-1.5 transition-opacity",
                showUpdateManagerButton ? "opacity-100" : "opacity-0 group-hover:opacity-100",
              )}
              onClick={() => setUpdateManagerOpen(true)}
            >
              <History className="h-3.5 w-3.5" />
              {t("settings.maintenance.updateManagerBtn")}
              {updatableCount > 0 && ` (${updatableCount})`}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5"
              onClick={() => checkMutation.mutate()}
              disabled={isChecking || installedCount === 0}
            >
              {isChecking ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  {t("settings.maintenance.checkingBtn")}
                </>
              ) : (
                <>
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t("settings.maintenance.checkUpdateBtn")}
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Local imports */}
        <div className="flex items-center justify-between rounded-xl border border-border bg-card/50 p-4 transition-colors hover:bg-muted/50">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-background ring-1 ring-border">
              <FolderInput className="h-4 w-4 text-blue-500" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium leading-none">
                {t("settings.localImports.cardTitle")}
              </p>
              <p className="text-xs text-muted-foreground">{t("settings.localImports.cardDesc")}</p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1.5"
            onClick={() => setLocalImportsOpen(true)}
          >
            <FolderInput className="h-3.5 w-3.5" />
            {t("settings.localImports.manage")}
          </Button>
        </div>

        {/* Rescan */}
        <div className="flex items-center justify-between rounded-xl border border-border bg-card/50 p-4 transition-colors hover:bg-muted/50">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-background ring-1 ring-border">
              <FolderSearch className="h-4 w-4 text-blue-500" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium leading-none">{t("settings.maintenance.rescan")}</p>
              <p className="text-xs text-muted-foreground">
                {t("settings.maintenance.rescanDesc")}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1.5"
            onClick={() => rescanMutation.mutate()}
            disabled={rescanMutation.isPending}
          >
            {rescanMutation.isPending ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                {t("settings.maintenance.rescanning")}
              </>
            ) : (
              <>
                <FolderSearch className="h-3.5 w-3.5" />
                {t("settings.maintenance.rescanBtn")}
              </>
            )}
          </Button>
        </div>

        {/* Clear cache */}
        <div className="flex items-center justify-between rounded-xl border border-border bg-card/50 p-4 transition-colors hover:bg-muted/50 group">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-background ring-1 ring-border">
              <Trash2 className="h-4 w-4 text-blue-500" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium leading-none">
                {t("settings.maintenance.clearCache")}
                {cacheSize != null && (
                  <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                    ({formatSize(cacheSize)})
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("settings.maintenance.clearCacheDesc")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => skillsApi.openCacheDir()}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              {t("settings.maintenance.openCacheDir")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5"
              onClick={async () => {
                setClearingCache(true);
                try {
                  const start = Date.now();
                  const freed = await skillsApi.clearDownloadCache();
                  const elapsed = Date.now() - start;
                  if (elapsed < 500) {
                    await new Promise((r) => setTimeout(r, 500 - elapsed));
                  }
                  setCacheSize((prev) => Math.max(0, (prev ?? 0) - freed));
                } catch {
                  toast.error(t("settings.maintenance.clearCacheFailed"));
                } finally {
                  setClearingCache(false);
                }
              }}
              disabled={clearingCache}
            >
              {clearingCache ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  {t("settings.maintenance.clearing")}
                </>
              ) : (
                <>
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("settings.maintenance.clearCacheBtn")}
                </>
              )}
            </Button>
          </div>
        </div>

        <ToggleRow
          icon={<Wrench className="h-4 w-4 text-muted-foreground" />}
          title={t("settings.maintenance.hideNonSsot")}
          description={t("settings.maintenance.hideNonSsotDesc")}
          checked={hideNonSsot ?? false}
          onCheckedChange={(checked) => updateHideNonSsot.mutate(checked)}
        />

        <p className="text-[11px] text-muted-foreground">
          {t("settings.maintenance.installedCount", { count: installedCount })}
        </p>
      </div>
      <SkillUpdateManagerDialog
        open={updateManagerOpen}
        onOpenChange={setUpdateManagerOpen}
        returnFocusRef={updateManagerButtonRef}
        updates={checkedUpdateCandidates}
        issues={checkedUpdateIssues}
        isChecking={isChecking}
        isUpdating={isUpdating}
        onCheckUpdates={() => checkMutation.mutate()}
        onUpdate={updateCheckedCandidates}
      />
      <LocalImportsDialog open={localImportsOpen} onOpenChange={setLocalImportsOpen} />
    </section>
  );
}

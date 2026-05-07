import { FolderSearch, RefreshCw, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ToggleRow } from "@/components/ui/toggle-row";
import { useUpdateAllSkills, useInstalledSkills, useRescanSkills } from "@/hooks/useSkills";
import { useHideNonSsot, useUpdateHideNonSsot } from "@/hooks/useSettings";

export function SkillMaintenanceSettings() {
  const { data: skills } = useInstalledSkills();
  const updateAllMutation = useUpdateAllSkills();
  const rescanMutation = useRescanSkills();
  const { data: hideNonSsot } = useHideNonSsot();
  const updateHideNonSsot = useUpdateHideNonSsot();
  const { t } = useTranslation();

  const installedCount = skills?.length ?? 0;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 pb-2 border-b border-border/40">
        <Wrench className="h-4 w-4 text-blue-500" />
        <h3 className="text-sm font-medium">{t("settings.maintenance.title")}</h3>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-xl border border-border bg-card/50 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-background ring-1 ring-border">
              <RefreshCw className="h-4 w-4 text-blue-500" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium leading-none">
                {t("settings.maintenance.updateAll")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("settings.maintenance.updateAllDesc")}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1.5"
            onClick={() => updateAllMutation.mutate()}
            disabled={updateAllMutation.isPending || installedCount === 0}
          >
            {updateAllMutation.isPending ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                {t("settings.maintenance.updating")}
              </>
            ) : (
              <>
                <RefreshCw className="h-3.5 w-3.5" />
                {t("settings.maintenance.updateAllBtn")}
              </>
            )}
          </Button>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-border bg-card/50 p-4">
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
    </section>
  );
}

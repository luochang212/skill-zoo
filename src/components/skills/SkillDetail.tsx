import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { SkillHero } from "@/components/skills/SkillHero";
import { BackButton } from "@/components/ui/BackButton";
import { ConfigureDialog } from "@/components/skills/ConfigureDialog";
import { SkillContentPane, type ContentTab } from "@/components/skills/SkillContentPane";
import { skillsApi } from "@/lib/api/skills";
import { AlertTriangle } from "lucide-react";
import type { InstalledSkill } from "@/types/skills";

interface SkillDetailProps {
  skill: InstalledSkill | null;
  skillName: string;
  skillLoading?: boolean;
  contentLoading: boolean;
  isError?: boolean;
  content: string;
  onChange: (content: string) => void;
  onBack?: () => void;
  onUpdate?: () => Promise<unknown>;
  onRemove?: () => void;
  onArchive?: () => void;
  onRestore?: () => void;
  onToggleStar?: () => void;
  updatePending?: boolean;
  removePending?: boolean;
  archivePending?: boolean;
  restorePending?: boolean;
  archiveDisabled?: boolean;
  onTabChange?: (tab: ContentTab) => void;
  onSave?: () => void;
  savePending?: boolean;
  dirty?: boolean;
  readOnly?: boolean;
}

export function SkillDetail({
  skill,
  skillName,
  skillLoading,
  contentLoading,
  isError,
  content,
  onChange,
  onBack,
  onUpdate,
  onRemove,
  onArchive,
  onRestore,
  onToggleStar,
  updatePending,
  removePending,
  archivePending,
  restorePending,
  archiveDisabled,
  onTabChange,
  onSave,
  savePending,
  dirty,
  readOnly,
}: SkillDetailProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<ContentTab>("overview");
  const [configureOpen, setConfigureOpen] = useState(false);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState(false);
  const [updateUpToDate, setUpdateUpToDate] = useState(false);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentSkillIdRef = useRef(skill?.id);

  const clearUpdateTimer = useCallback(() => {
    if (successTimerRef.current) {
      clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
  }, []);

  const clearUpdateStatus = useCallback(() => {
    clearUpdateTimer();
    setUpdateSuccess(false);
    setUpdateUpToDate(false);
  }, [clearUpdateTimer]);

  // Auto-navigate back when skill disappears (deleted externally)
  useEffect(() => {
    if (!skillLoading && !isError && !skill && onBack) onBack();
  }, [skill, skillLoading, isError, onBack]);

  useEffect(() => {
    currentSkillIdRef.current = skill?.id;
    clearUpdateStatus();
  }, [skill?.id, clearUpdateStatus]);

  // Clean up timer on unmount
  useEffect(() => {
    return clearUpdateTimer;
  }, [clearUpdateTimer]);

  const handleTabChange = useCallback(
    (tab: ContentTab) => {
      setActiveTab(tab);
      onTabChange?.(tab);
    },
    [onTabChange],
  );

  const handleUpdate = async () => {
    if (!onUpdate) return;
    const updateSkillId = skill?.id;
    clearUpdateStatus();
    try {
      const result = (await onUpdate()) as { updated: boolean } | null;
      if (currentSkillIdRef.current !== updateSkillId) return;
      if (result?.updated) {
        setUpdateUpToDate(false);
        setUpdateSuccess(true);
        successTimerRef.current = setTimeout(() => setUpdateSuccess(false), 1500);
      } else {
        setUpdateSuccess(false);
        setUpdateUpToDate(true);
        successTimerRef.current = setTimeout(() => setUpdateUpToDate(false), 2000);
      }
    } catch {
      if (currentSkillIdRef.current === updateSkillId) {
        clearUpdateStatus();
      }
      // Error toast is handled by the global mutation onError handler
    }
  };

  const handleRemoveClick = () => {
    setRemoveConfirmOpen(true);
  };

  const handleRemoveConfirm = () => {
    setRemoveConfirmOpen(false);
    onRemove?.();
  };

  const handleArchiveConfirm = () => {
    setArchiveConfirmOpen(false);
    onArchive?.();
  };

  return (
    <div className="flex flex-col h-full" data-selectable>
      {/* Header stays available even while SKILL.md content is loading. */}
      {skill ? (
        <SkillHero
          skill={skill}
          onBack={onBack}
          onUpdate={onUpdate ? handleUpdate : undefined}
          onConfigure={readOnly ? undefined : () => setConfigureOpen(true)}
          onRemove={onRemove ? handleRemoveClick : undefined}
          onArchive={onArchive ? () => setArchiveConfirmOpen(true) : undefined}
          onRestore={onRestore}
          onToggleStar={onToggleStar}
          onOpenDir={
            readOnly
              ? undefined
              : () => {
                  if (skill.homePath) {
                    skillsApi.openSkillPath(skill.homePath);
                  } else {
                    skillsApi.openSkillDir(skill.directory);
                  }
                }
          }
          starred={skill.starred}
          updatePending={updatePending}
          removePending={removePending}
          archivePending={archivePending}
          restorePending={restorePending}
          archiveDisabled={archiveDisabled}
          archiveDisabledReason={t("archiveDialog.dirtyHint")}
          updateSuccess={updateSuccess}
          updateUpToDate={updateUpToDate}
        />
      ) : (
        <div className="px-5 pt-4 pb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 min-w-0">
              {onBack && <BackButton onClick={onBack} title={t("common.back")} />}
              <h1 className="text-xl font-bold tracking-tight leading-tight truncate">
                {skillName}
              </h1>
            </div>
            {skillLoading && (
              <div className="flex items-center gap-1 shrink-0">
                <Skeleton className="h-7 w-7 rounded-md" />
                <Skeleton className="h-7 w-7 rounded-md" />
                <Skeleton className="h-7 w-7 rounded-md" />
              </div>
            )}
          </div>
          {skillLoading && (
            <div className="mt-2 inline-flex items-center gap-1.5">
              <Skeleton className="h-6 w-16 rounded-lg" />
              <Skeleton className="h-6 w-14 rounded-lg" />
              <Skeleton className="h-6 w-12 rounded-lg" />
            </div>
          )}
        </div>
      )}

      {isError && !skill ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <AlertTriangle className="h-8 w-8 text-destructive/60 mx-auto" />
            <p className="text-sm text-destructive">{t("error.generic")}</p>
          </div>
        </div>
      ) : (
        <SkillContentPane
          content={content}
          onChange={onChange}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          isLoading={contentLoading}
          updatedAt={
            readOnly && skill && "archivedAt" in skill
              ? String(skill.archivedAt)
              : skill?.updatedAt != null
                ? String(skill.updatedAt)
                : undefined
          }
          updatedLabel={readOnly ? t("skill.archived") : undefined}
          directory={skill?.directory}
          skillId={skill?.id}
          onSave={onSave}
          savePending={savePending}
          dirty={dirty}
          readOnly={readOnly}
        />
      )}

      {/* Configure dialog */}
      {skill && (
        <ConfigureDialog
          open={configureOpen}
          onOpenChange={setConfigureOpen}
          skillId={skill.id}
          skillName={skill.name}
          homeAgent={skill.homeAgent}
        />
      )}

      {/* Remove confirmation dialog */}
      <Dialog open={removeConfirmOpen} onOpenChange={setRemoveConfirmOpen}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>{t("removeDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("removeDialog.description")}{" "}
              <span className="font-medium text-foreground">{skillName}</span>?{" "}
              {skill?.origin === "external"
                ? t("removeDialog.externalImportNote")
                : t("removeDialog.warning")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRemoveConfirmOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" size="sm" onClick={handleRemoveConfirm}>
              {t("common.remove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Archive confirmation dialog */}
      <Dialog open={archiveConfirmOpen} onOpenChange={setArchiveConfirmOpen}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>{t("archiveDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("archiveDialog.description")}{" "}
              <span className="font-medium text-foreground">{skillName}</span>?{" "}
              {t("archiveDialog.warning")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setArchiveConfirmOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleArchiveConfirm}
              disabled={archivePending || archiveDisabled}
            >
              {archivePending ? t("common.archiving") : t("common.archive")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

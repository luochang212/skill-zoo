import { useState, useEffect, useRef } from "react";
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
import { ConfigureDialog } from "@/components/skills/ConfigureDialog";
import { SkillContentPane, type ContentTab } from "@/components/skills/SkillContentPane";
import { SkillAuditCard } from "@/components/skills/SkillAuditCard";
import { skillsApi } from "@/lib/api/skills";
import { AlertTriangle } from "lucide-react";
import type { InstalledSkill } from "@/types/skills";

interface SkillDetailProps {
  skill: InstalledSkill | null;
  skillName: string;
  isLoading: boolean;
  isError?: boolean;
  content: string;
  onChange: (content: string) => void;
  onBack?: () => void;
  onUpdate?: () => void;
  onRemove?: () => void;
  onToggleStar?: () => void;
  updatePending?: boolean;
  removePending?: boolean;
  onTabChange?: (tab: ContentTab) => void;
}

export function SkillDetail({
  skill,
  skillName,
  isLoading,
  isError,
  content,
  onChange,
  onBack,
  onUpdate,
  onRemove,
  onToggleStar,
  updatePending,
  removePending,
  onTabChange,
}: SkillDetailProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<ContentTab>("overview");
  const [configureOpen, setConfigureOpen] = useState(false);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState(false);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  const handleTabChange = (tab: ContentTab) => {
    setActiveTab(tab);
    onTabChange?.(tab);
  };

  const handleUpdate = () => {
    onUpdate?.();
    setUpdateSuccess(true);
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    successTimerRef.current = setTimeout(() => setUpdateSuccess(false), 1500);
  };

  const handleRemoveClick = () => {
    setRemoveConfirmOpen(true);
  };

  const handleRemoveConfirm = () => {
    setRemoveConfirmOpen(false);
    onRemove?.();
  };

  // Show skeleton while skill metadata is loading
  if (isLoading && !skill) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-5 pt-4 pb-3">
          {/* Name + actions row (mirrors SkillHero layout) */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Skeleton className="h-7 w-7 rounded-md" />
              <Skeleton className="h-6 w-16 rounded-full" />
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
            <div className="flex items-center gap-1">
              <Skeleton className="h-7 w-7 rounded-md" />
              <Skeleton className="h-7 w-7 rounded-md" />
              <Skeleton className="h-7 w-7 rounded-md" />
            </div>
          </div>
          {/* Agent badges row */}
          <div className="mt-2 inline-flex items-center gap-1.5">
            <Skeleton className="h-6 w-16 rounded-lg" />
            <Skeleton className="h-6 w-14 rounded-lg" />
            <Skeleton className="h-6 w-12 rounded-lg" />
          </div>
        </div>
        {/* Content pane skeleton */}
        <div className="flex-1 min-h-0 flex flex-col">
          {/* Tab bar skeleton */}
          <div className="px-5 py-2 shrink-0 border-b border-border flex items-center">
            <div className="inline-flex items-center bg-muted rounded-xl p-0.5 gap-0.5">
              <Skeleton className="h-6 w-16 rounded-lg" />
              <Skeleton className="h-6 w-12 rounded-lg" />
              <Skeleton className="h-6 w-14 rounded-lg" />
            </div>
          </div>
          {/* Content lines — mimicking markdown content */}
          <div className="flex-1 px-5 py-4 pr-6 space-y-3 overflow-hidden">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-11/12" />
            <div className="pt-3" />
            <Skeleton className="h-5 w-1/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-3 w-3/4" />
            <div className="pt-3" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  if (isError && !skill) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-5 pt-4 pb-4">
          <h1 className="text-xl font-bold tracking-tight">{skillName}</h1>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <AlertTriangle className="h-8 w-8 text-destructive/60 mx-auto" />
            <p className="text-sm text-destructive">{t("error.generic")}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Hero — skill may still be null during brief transition */}
      {skill ? (
        <SkillHero
          skill={skill}
          onBack={onBack}
          onUpdate={onUpdate ? handleUpdate : undefined}
          onConfigure={() => setConfigureOpen(true)}
          onRemove={onRemove ? handleRemoveClick : undefined}
          onToggleStar={onToggleStar}
          onOpenDir={() => skillsApi.openSkillDir(skill.directory)}
          starred={skill.starred}
          updatePending={updatePending}
          removePending={removePending}
          updateSuccess={updateSuccess}
        />
      ) : (
        <div className="px-5 pt-4 pb-4">
          <h1 className="text-xl font-bold tracking-tight">{skillName}</h1>
        </div>
      )}

      {/* Security audit */}
      {skill?.repoOwner && skill.repoName && skill.directory && (
        <SkillAuditCard owner={skill.repoOwner} repo={skill.repoName} slug={skill.directory} />
      )}

      {/* Content pane */}
      <SkillContentPane
        content={content}
        onChange={onChange}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        isLoading={isLoading}
        updatedAt={skill?.updatedAt != null ? String(skill.updatedAt) : undefined}
        directory={skill?.directory}
      />

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
              {t("removeDialog.warning")}
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
    </div>
  );
}

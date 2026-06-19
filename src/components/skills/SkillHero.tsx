import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { StarButton } from "@/components/skills/StarButton";
import { SkillAuditCard } from "@/components/skills/SkillAuditCard";
import { BackButton } from "@/components/ui/BackButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAgentConfigs, getAgentColor, getAgentLabel } from "@/lib/agents";
import { formatRelativeDate } from "@/lib/date";

import { cn } from "@/lib/utils";
import type { InstalledSkill } from "@/types/skills";
import { Archive, ArchiveRestore, Settings, Trash2, CircleArrowUp, FolderOpen, CircleEllipsis } from "lucide-react";

function getLinkedAgents(apps: Record<string, boolean>): string[] {
  return Object.entries(apps)
    .filter(([, v]) => v)
    .map(([k]) => k);
}

function parseSkillName(fullName: string) {
  const colonIndex = fullName.indexOf(":");
  if (colonIndex === -1) {
    return { namespace: null, name: fullName };
  }
  return {
    namespace: fullName.slice(0, colonIndex),
    name: fullName.slice(colonIndex + 1),
  };
}

function SkillInfoPopover({ skill }: { skill: InstalledSkill }) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const onEnter = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(true), 200);
  }, []);

  const onLeave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), 150);
  }, []);

  useEffect(() => {
    if (!visible) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setVisible(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [visible]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div ref={containerRef} className="relative inline-flex items-center shrink-0">
      <button
        type="button"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-default"
      >
        <CircleEllipsis className="h-3.5 w-3.5" />
      </button>
      {visible && (
        <div
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
          className="absolute right-0 top-8 z-50 w-64 rounded-lg border border-border bg-popover shadow-lg px-3 py-2.5 text-xs space-y-1.5"
        >
          {/* Repository */}
          {skill.repoOwner && skill.repoName && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide shrink-0">
                {t("skillInfo.repository")}
              </span>
              <button
                type="button"
                onClick={() => openUrl(`https://github.com/${skill.repoOwner}/${skill.repoName}`)}
                className="text-foreground text-right truncate hover:text-primary transition-colors cursor-pointer border-b border-transparent hover:border-primary"
              >
                {skill.repoOwner}/{skill.repoName}
              </button>
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide shrink-0">
              {t("skillInfo.origin")}
            </span>
            <span className="text-foreground text-right">
              {skill.origin === "ssot" ? "SSOT" : t("skillInfo.local")}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide shrink-0">
              {t("skillInfo.installed")}
            </span>
            <span className="text-foreground text-right">{formatRelativeDate(skill.installedAt)}</span>
          </div>

          {skill.updatedAt > 0 && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide shrink-0">
                {t("skillInfo.updated")}
              </span>
              <span className="text-foreground text-right">{formatRelativeDate(skill.updatedAt)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface SkillHeroProps {
  skill: InstalledSkill;
  onUpdate?: () => void;
  onConfigure?: () => void;
  onRemove?: () => void;
  onArchive?: () => void;
  onRestore?: () => void;
  onToggleStar?: () => void;
  onOpenDir?: () => void;
  onBack?: () => void;
  starred?: boolean;
  updatePending?: boolean;
  removePending?: boolean;
  archivePending?: boolean;
  restorePending?: boolean;
  archiveDisabled?: boolean;
  archiveDisabledReason?: string;
  updateSuccess?: boolean;
}

export function SkillHero({
  skill,
  onUpdate,
  onConfigure,
  onRemove,
  onArchive,
  onRestore,
  onToggleStar,
  onOpenDir,
  onBack,
  starred,
  updatePending,
  removePending,
  archivePending,
  restorePending,
  archiveDisabled,
  archiveDisabledReason,
  updateSuccess,
}: SkillHeroProps) {
  const { t } = useTranslation();
  const { data: agentConfigs } = useAgentConfigs();
  const { namespace, name } = parseSkillName(skill.name);
  const linkedAgents = getLinkedAgents(skill.apps);
  const visibleAgents = linkedAgents.slice(0, 2);
  const canUpdate = !!(skill.repoOwner && skill.repoName);
  const canAudit = !!(skill.repoOwner && skill.repoName && skill.directory);
  const overflowCount = linkedAgents.length - visibleAgents.length;

  return (
    <div className="px-5 pt-4 pb-2">
      {/* Name + repo link + actions row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          {onBack && <BackButton onClick={onBack} title={t("common.back")} />}
          {namespace && (
            <Badge
              variant="secondary"
              className="text-[10px] px-2 py-0 h-6 font-semibold tracking-wide uppercase shrink-0"
            >
              {namespace}
            </Badge>
          )}
          <h1 className="text-xl font-bold tracking-tight leading-tight truncate">{name}</h1>
          {linkedAgents.length > 0 && agentConfigs && (
            <div className="min-w-0 inline-flex flex-wrap items-center gap-1.5 relative top-[1.5px]">
              {visibleAgents.map((agent) => {
                const color = getAgentColor(agent, agentConfigs);
                return (
                  <span
                    key={agent}
                    className={cn(
                      "px-2.5 py-1 h-6 text-[11px] rounded-lg font-medium",
                      color.bg,
                      color.text,
                      color.darkBg,
                      color.darkText,
                    )}
                  >
                    {getAgentLabel(agent, agentConfigs)}
                  </span>
                );
              })}
              {overflowCount > 0 && (
                <span className="px-2.5 py-1 h-6 text-[11px] rounded-lg text-muted-foreground font-medium bg-muted">
                  +{overflowCount}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onToggleStar && <StarButton starred={starred ?? false} onToggle={onToggleStar} />}
          <SkillInfoPopover skill={skill} />
          {onUpdate && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onUpdate}
              disabled={!canUpdate || updatePending || updateSuccess}
              title={
                !canUpdate
                  ? t("skillHero.noRepo")
                  : updateSuccess
                    ? t("skillHero.updated")
                    : updatePending
                      ? t("skillHero.updating")
                      : t("skillHero.updateFromGit")
              }
            >
              {updateSuccess ? (
                <CircleArrowUp className="h-3.5 w-3.5 text-green-600" />
              ) : updatePending ? (
                <CircleArrowUp className="h-3.5 w-3.5 animate-pulse" />
              ) : (
                <CircleArrowUp className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
          {canAudit && (
            <SkillAuditCard
              owner={skill.repoOwner!}
              repo={skill.repoName!}
              slug={skill.directory}
              display="icon"
            />
          )}
          {onConfigure && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onConfigure}
              title={t("skillHero.configureAgents")}
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
          )}
          {onOpenDir && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onOpenDir}
              title={t("skillHero.openInFileManager")}
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </Button>
          )}
          {onRestore && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onRestore}
              disabled={restorePending}
              title={restorePending ? t("common.restoring") : t("common.restore")}
            >
              <ArchiveRestore className="h-3.5 w-3.5" />
            </Button>
          )}
          {onArchive && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onArchive}
              disabled={archivePending || archiveDisabled}
              title={
                archiveDisabled
                  ? (archiveDisabledReason ?? t("archiveDialog.dirtyHint"))
                  : archivePending
                    ? t("common.archiving")
                    : t("common.archive")
              }
            >
              <Archive className="h-3.5 w-3.5" />
            </Button>
          )}
          {onRemove && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:text-destructive"
              onClick={onRemove}
              disabled={removePending}
              title={t("skillHero.removeSkill")}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

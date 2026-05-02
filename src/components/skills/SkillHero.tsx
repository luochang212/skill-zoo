import { useTranslation } from "react-i18next";
import { StarButton } from "@/components/skills/StarButton";
import { BackButton } from "@/components/ui/BackButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAgentConfigs, getAgentColor, getAgentLabel } from "@/lib/agents";
import { skillsApi } from "@/lib/api/skills";
import { cn } from "@/lib/utils";
import type { InstalledSkill } from "@/types/skills";
import { Settings, Trash2, CircleArrowUp, FolderOpen } from "lucide-react";

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

interface SkillHeroProps {
  skill: InstalledSkill;
  onUpdate?: () => void;
  onConfigure?: () => void;
  onRemove?: () => void;
  onToggleStar?: () => void;
  onOpenDir?: () => void;
  onBack?: () => void;
  starred?: boolean;
  updatePending?: boolean;
  removePending?: boolean;
  updateSuccess?: boolean;
}

export function SkillHero({
  skill,
  onUpdate,
  onConfigure,
  onRemove,
  onToggleStar,
  onOpenDir,
  onBack,
  starred,
  updatePending,
  removePending,
  updateSuccess,
}: SkillHeroProps) {
  const { t } = useTranslation();
  const { data: agentConfigs } = useAgentConfigs();
  const { namespace, name } = parseSkillName(skill.name);
  const linkedAgents = getLinkedAgents(skill.apps);
  const visibleAgents = linkedAgents.slice(0, 3);
  const canUpdate = !!(skill.repoOwner && skill.repoName);
  const overflowCount = linkedAgents.length - visibleAgents.length;

  return (
    <div className="px-5 pt-4 pb-3">
      {/* Name + repo link + actions row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          {onBack && (
            <BackButton onClick={onBack} title={t("common.back")} />
          )}
          {namespace && (
            <Badge
              variant="secondary"
              className="text-[10px] px-2 py-0 h-6 font-semibold tracking-wide uppercase shrink-0"
            >
              {namespace}
            </Badge>
          )}
          <h1 className="text-xl font-bold tracking-tight leading-tight truncate">
            {name}
          </h1>
          {skill.repoOwner && skill.repoName && (
            <a
              href={`https://github.com/${skill.repoOwner}/${skill.repoName}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${skill.repoOwner}/${skill.repoName} (opens in new tab)`}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              {skill.repoOwner}/{skill.repoName}
            </a>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onToggleStar && (
            <StarButton starred={starred ?? false} onToggle={onToggleStar} />
          )}
          {onUpdate && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onUpdate}
              disabled={!canUpdate || updatePending || updateSuccess}
              title={!canUpdate ? t("skillHero.noRepo") : updateSuccess ? t("skillHero.updated") : updatePending ? t("skillHero.updating") : t("skillHero.updateFromGit")}
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

      {/* Agent badges */}
      {linkedAgents.length > 0 && agentConfigs && (
        <div className="mt-2 inline-flex items-center gap-1.5">
          {visibleAgents.map((agent) => {
            const color = getAgentColor(agent, agentConfigs);
            return (
              <span
                key={agent}
                className={cn(
                  "px-2.5 py-1 h-6 text-[11px] rounded-lg font-medium",
                  color.bg, color.text, color.darkBg, color.darkText
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
  );
}

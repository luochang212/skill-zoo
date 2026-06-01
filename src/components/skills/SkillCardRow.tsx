import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { StarButton } from "@/components/skills/StarButton";
import { SkillBadges } from "@/components/skills/SkillBadges";
import { formatRelativeDate } from "@/lib/date";
import type { DiscoverableSkill, InstalledSkill } from "@/types/skills";
import type { SkillIssues } from "@/hooks/useSkillIssues";

interface SkillCardRowProps {
  skill: DiscoverableSkill | InstalledSkill;
  isInstalled: boolean;
  onInstall?: () => void;
  onOpen?: () => void;
  onToggleStar?: () => void;
  starred?: boolean;
  issues?: SkillIssues;
  selected?: boolean;
  onToggleSelect?: () => void;
}

export function SkillCardRow({
  skill,
  isInstalled,
  onInstall,
  onOpen,
  onToggleStar,
  starred,
  issues,
  selected,
  onToggleSelect,
}: SkillCardRowProps) {
  const { t } = useTranslation();
  const installedSkill = isInstalled ? (skill as InstalledSkill) : null;

  const repoLabel = skill.repoOwner && skill.repoName ? `${skill.repoOwner}/${skill.repoName}` : "";

  return (
    <div
      className="flex items-center gap-4 px-5 py-2 hover:bg-accent/40 transition-colors group last:border-b-0"
      data-selectable
    >
      {/* Checkbox column */}
      {onToggleSelect !== undefined && (
        <div className="w-8 shrink-0 flex justify-center">
          <Checkbox checked={selected ?? false} onCheckedChange={onToggleSelect} />
        </div>
      )}
      {/* Name — w-48 aligned with header */}
      <div className="w-48 shrink-0 min-w-0 flex items-center gap-2">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className="text-left text-[14px] font-medium leading-tight cursor-pointer hover:underline truncate"
          >
            {skill.name}
          </button>
        ) : (
          <span className="text-[14px] font-medium leading-tight truncate">{skill.name}</span>
        )}
        {installedSkill?.isMine && (
          <Badge
            variant="secondary"
            className="text-[9px] px-1.5 py-0 h-4 bg-primary text-primary-foreground shrink-0"
          >
            {t("skill.mine")}
          </Badge>
        )}
        <SkillBadges issues={issues} />
      </div>

      {/* Repo — flex-1 aligned with header, hidden when panel takes space */}
      <span className="flex-1 min-w-0 text-[13px] text-muted-foreground/80 truncate hidden @2xl/main:inline">
        {repoLabel}
      </span>

      {/* Updated At — w-28 aligned with header, hidden when very narrow */}
      {installedSkill && (
        <span className="w-28 shrink-0 text-[13px] text-muted-foreground/80 hidden @md/main:inline">
          {formatRelativeDate(installedSkill.updatedAt)}
        </span>
      )}

      {/* Star — w-8 aligned with header, hidden at narrow widths */}
      {isInstalled && onToggleStar && (
        <div className="w-8 shrink-0 flex justify-center hidden @lg/main:flex">
          <StarButton starred={starred ?? false} onToggle={onToggleStar} />
        </div>
      )}
      {!isInstalled && onInstall && (
        <div className="w-8 shrink-0 flex justify-center">
          <Button
            size="sm"
            variant="default"
            className="h-7 text-xs px-3 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg"
            onClick={onInstall}
          >
            {t("common.install")}
          </Button>
        </div>
      )}
    </div>
  );
}

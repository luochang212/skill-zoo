import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StarButton } from "@/components/skills/StarButton";
import { SkillBadges } from "@/components/skills/SkillBadges";
import type { DiscoverableSkill, InstalledSkill } from "@/types/skills";
import type { SkillIssues } from "@/hooks/useSkillIssues";

interface SkillCardProps {
  skill: DiscoverableSkill | InstalledSkill;
  isInstalled: boolean;
  onInstall?: () => void;
  onOpen?: () => void;
  onToggleStar?: () => void;
  starred?: boolean;
  issues?: SkillIssues;
}

export function SkillCard({
  skill,
  isInstalled,
  onInstall,
  onOpen,
  onToggleStar,
  starred,
  issues,
}: SkillCardProps) {
  const { t } = useTranslation();
  const installedSkill = isInstalled ? (skill as InstalledSkill) : null;

  return (
    <Card className="group rounded-xl hover:shadow-md hover:-translate-y-0.5 transition-all duration-200" data-selectable>
      <CardHeader className="px-4 pt-4 pb-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {onOpen ? (
              <button
                type="button"
                onClick={onOpen}
                className="text-left text-[13px] font-medium leading-tight cursor-pointer hover:underline truncate"
              >
                {skill.name}
              </button>
            ) : (
              <CardTitle className="text-[13px] font-medium leading-tight truncate">
                {skill.name}
              </CardTitle>
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
          <div className="flex items-center gap-1 shrink-0">
            {isInstalled && onToggleStar && (
              <StarButton starred={starred ?? false} onToggle={onToggleStar} />
            )}
          </div>
        </div>
        {"repoOwner" in skill && skill.repoOwner && (
          <p className="text-xs text-muted-foreground">
            {skill.repoOwner}/{skill.repoName}
          </p>
        )}
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-0">
        {skill.description && (
          <p className="text-[13px] text-muted-foreground/80 line-clamp-2 mb-2 leading-relaxed">
            {skill.description}
          </p>
        )}
        {!isInstalled && onInstall && (
          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              variant="default"
              className="h-8 text-xs rounded-lg"
              onClick={onInstall}
            >
              {t("common.install")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

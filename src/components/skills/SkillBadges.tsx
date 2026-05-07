import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import type { SkillIssues } from "@/hooks/useSkillIssues";

export function SkillBadges({ issues }: { issues?: SkillIssues }) {
  const { t } = useTranslation();
  if (!issues) return null;

  return (
    <>
      {issues.hasConflict && (
        <Badge variant="destructive" className="text-[9px] px-1.5 py-0 h-4 shrink-0">
          {t("consistency.conflict")}
        </Badge>
      )}
      {issues.isMismatch && !issues.hasConflict && (
        <Badge
          variant="secondary"
          className="text-[9px] px-1.5 py-0 h-4 bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-800 shrink-0"
        >
          {t("consistency.mismatch")}
        </Badge>
      )}
      {issues.isDuplicate && !issues.hasConflict && !issues.isMismatch && (
        <Badge
          variant="secondary"
          className="text-[9px] px-1.5 py-0 h-4 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800 shrink-0"
        >
          {t("consistency.duplicate")}
        </Badge>
      )}
    </>
  );
}

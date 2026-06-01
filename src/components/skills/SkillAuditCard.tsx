import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck, ShieldAlert, ShieldX, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { useSkillAudit } from "@/hooks/useSkills";

interface SkillAuditCardProps {
  owner: string;
  repo: string;
  slug: string;
}

const STATUS_CONFIG = {
  pass: { icon: ShieldCheck, color: "text-green-600 dark:text-green-400" },
  warn: { icon: ShieldAlert, color: "text-yellow-600 dark:text-yellow-400" },
  fail: { icon: ShieldX, color: "text-red-600 dark:text-red-400" },
} as const;

function getRiskColor(riskLevel?: string) {
  const map: Record<string, string> = {
    NONE: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    LOW: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    MEDIUM: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    HIGH: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  };
  if (!riskLevel || !map[riskLevel]) return null;
  return (
    <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", map[riskLevel])}>
      {riskLevel}
    </span>
  );
}

export function SkillAuditCard({ owner, repo, slug }: SkillAuditCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const {
    data: audits = [],
    isLoading,
    isError,
  } = useSkillAudit(
    expanded ? owner : undefined,
    expanded ? repo : undefined,
    expanded ? slug : undefined,
  );

  return (
    <div className="mx-5 mb-3 rounded-lg border border-border bg-card">
      <button
        className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span className="flex items-center gap-2">
          <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
          {t("audit.title")}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-border pt-2">
          {isLoading ? (
            <div className="space-y-2.5">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center gap-2">
                  <Skeleton className="h-3.5 w-3.5 rounded-full shrink-0" />
                  <Skeleton className="h-3 w-24 shrink-0" />
                  <Skeleton className="h-3.5 w-10 rounded-full" />
                </div>
              ))}
            </div>
          ) : isError || audits.length === 0 ? (
            <p className="text-[11px] text-muted-foreground py-1">{t("audit.unavailable")}</p>
          ) : (
            audits.map((audit) => {
              const config =
                STATUS_CONFIG[audit.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.warn;
              const Icon = config.icon;
              return (
                <div key={audit.slug} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Icon className={cn("h-3.5 w-3.5 shrink-0", config.color)} />
                    <span className="text-xs text-foreground">{audit.provider}</span>
                    {getRiskColor(audit.riskLevel)}
                  </div>
                  {audit.summary && (
                    <p className="text-[11px] text-muted-foreground pl-5.5 leading-relaxed">
                      {audit.summary}
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

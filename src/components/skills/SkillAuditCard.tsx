import { useEffect, useRef, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck, ShieldAlert, ShieldX, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { useSkillAudit } from "@/hooks/useSkills";

type AuditDisplay = "card" | "compact" | "icon";

interface SkillAuditCardProps {
  owner: string;
  repo: string;
  slug: string;
  /** @deprecated use `display="compact"` instead */
  compact?: boolean;
  display?: AuditDisplay;
}

const STATUS_CONFIG = {
  pass: { icon: ShieldCheck, color: "text-green-600 dark:text-green-400" },
  warn: { icon: ShieldAlert, color: "text-yellow-600 dark:text-yellow-400" },
  fail: { icon: ShieldX, color: "text-red-600 dark:text-red-400" },
} as const;

const STATUS_RANK: Record<string, number> = { pass: 0, warn: 1, fail: 2 };

function aggregateStatus(audits: Array<{ status: string }>): keyof typeof STATUS_CONFIG | null {
  if (audits.length === 0) return null;
  let worst: keyof typeof STATUS_CONFIG = "pass";
  for (const a of audits) {
    if ((STATUS_RANK[a.status] ?? 0) > (STATUS_RANK[worst] ?? 0)) {
      worst = a.status as keyof typeof STATUS_CONFIG;
    }
  }
  return worst;
}

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

function AuditEmptyState({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-muted/50 px-2.5 py-2 text-[11px] text-muted-foreground">
      <ShieldAlert className="h-3.5 w-3.5 shrink-0 opacity-70" />
      <span className="leading-relaxed">{label}</span>
    </div>
  );
}

export function SkillAuditCard({ owner, repo, slug, compact, display }: SkillAuditCardProps) {
  const { t } = useTranslation();
  const mode: AuditDisplay = display ?? (compact ? "compact" : "card");
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded || mode === "card") return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [expanded, mode]);

  const shouldFetch = mode === "icon" || expanded;
  const {
    data: audits = [],
    isLoading,
    isError,
  } = useSkillAudit(
    shouldFetch ? owner : undefined,
    shouldFetch ? repo : undefined,
    shouldFetch ? slug : undefined,
  );

  const statusSummary = useMemo(() => aggregateStatus(audits), [audits]);

  const auditBody = (
    <div className={cn("space-y-2 px-3 pb-3 pt-2", mode === "card" && "border-t border-border")}>
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
        <AuditEmptyState label={t("audit.unavailable")} />
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
  );

  if (mode === "icon") {
    const statusConfig = statusSummary ? STATUS_CONFIG[statusSummary] : null;
    const Icon = statusConfig?.icon ?? ShieldCheck;
    const iconColor = statusConfig
      ? statusConfig.color
      : "text-muted-foreground";
    return (
      <div ref={containerRef} className="relative shrink-0">
        <button
          type="button"
          className={cn(
            "h-7 w-7 inline-flex items-center justify-center rounded-md transition-colors",
            "hover:bg-accent hover:text-accent-foreground",
            iconColor,
          )}
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          title={t("audit.title")}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
        {expanded && (
          <div
            className="absolute right-0 top-8 z-50 rounded-lg border border-border bg-popover shadow-lg"
            style={{ width: "min(20rem, calc(100vw - 2.5rem))" }}
          >
            {auditBody}
          </div>
        )}
      </div>
    );
  }

  if (mode === "compact") {
    return (
      <div className="flex justify-end w-full">
        <div ref={containerRef} className="relative">
          <button
            className="h-6 inline-flex items-center gap-1.5 rounded-lg bg-muted px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            {t("audit.title")}
            <ChevronDown
              className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")}
            />
          </button>

          {expanded && (
            <div
              className="absolute right-0 top-8 z-50 rounded-lg border border-border bg-popover shadow-lg"
              style={{ width: "min(20rem, calc(100vw - 2.5rem))" }}
            >
              {auditBody}
            </div>
          )}
        </div>
      </div>
    );
  }

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

      {expanded && auditBody}
    </div>
  );
}

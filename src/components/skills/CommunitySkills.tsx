import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSkillCatalog } from "@/hooks/useSkillCatalog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { CatalogKind, CatalogSkill } from "@/types/skills";

// Give different authors room on the first screen without inventing a quality ranking.
export function diversifySkills(skills: CatalogSkill[]) {
  const groups = new Map<string, CatalogSkill[]>();
  for (const skill of skills) {
    const group = groups.get(skill.source) ?? [];
    group.push(skill);
    groups.set(skill.source, group);
  }
  const result: CatalogSkill[] = [];
  for (let index = 0; result.length < skills.length; index++) {
    for (const group of groups.values()) {
      const skill = group[index];
      if (skill) result.push(skill);
    }
  }
  return result;
}

const BATCH = 9;

// A precise skeleton: mirrors the real card structure bar for bar so the
// handoff from loading to loaded never shifts layout.
function CatalogCardSkeleton() {
  return (
    <div aria-hidden="true" className="h-full rounded-xl border border-border/70 bg-card p-4">
      <div className="flex w-full items-center justify-between gap-2">
        <Skeleton className="h-3.5 w-2/3 rounded-md" />
        <Skeleton className="size-3.5 rounded" />
      </div>
      <Skeleton className="mt-1.5 h-3 w-1/2 rounded-md" />
      <div className="mt-4 flex items-center gap-1.5">
        <Skeleton className="size-3 rounded" />
        <Skeleton className="h-3 w-1/3 rounded-md" />
      </div>
    </div>
  );
}

export function CommunitySkills({ onOpen }: { onOpen: (skill: CatalogSkill) => void }) {
  const { t, i18n } = useTranslation();
  const [kind, setKind] = useState<CatalogKind>("popular");
  const [limit, setLimit] = useState(12);
  const [entranceStart, setEntranceStart] = useState(0);
  const { data, isPending, isError, refetch } = useSkillCatalog(kind);
  const skills = diversifySkills(data?.skills ?? []);
  // The catalog is bounded at 600 entries upstream and already in memory, so
  // the sentinel only widens a render window, well ahead of the viewport —
  // scrolling never waits. What is shaped is the arrival, not a delay: each
  // batch fades in with a stagger so new cards read as newly arrived.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || limit >= skills.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setEntranceStart(limit);
          setLimit((current) => Math.min(current + BATCH, skills.length));
        }
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [limit, skills.length]);
  // Switching tabs swaps the list for precise skeletons; rendering as many of
  // them as the previous list showed keeps the section height stable.
  const [switchCount, setSwitchCount] = useState<number | null>(null);
  const switchKind = (value: CatalogKind) => {
    if (value === kind) return;
    setSwitchCount(Math.min(limit, skills.length));
    setKind(value);
    setLimit(12);
    setEntranceStart(0);
  };
  useEffect(() => {
    if (!isPending) setSwitchCount(null);
  }, [isPending]);
  const number = new Intl.NumberFormat(i18n.language, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold">{t("browse.community")}</h2>
        <div
          className="flex items-center gap-1 rounded-lg bg-muted p-1"
          role="group"
          aria-label={t("browse.community")}
        >
          {(["popular", "trending"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={kind === value}
              className={cn(
                "flex h-8 items-center justify-center rounded-md px-3 text-xs font-medium transition-colors",
                kind === value ? "bg-background shadow-sm" : "text-muted-foreground",
              )}
              onClick={() => switchKind(value)}
            >
              {t(`browse.${value}`)}
            </button>
          ))}
        </div>
      </div>
      {isPending ? (
        <div
          aria-busy="true"
          aria-label={t("common.loading")}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
        >
          {Array.from({ length: switchCount ?? 6 }, (_, index) => (
            <CatalogCardSkeleton key={index} />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-dashed p-5 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground" role="status">
            {t("browse.communityUnavailable")}
          </p>
          <Button size="sm" variant="outline" onClick={() => void refetch()}>
            {t("error.retry")}
          </Button>
        </div>
      ) : (
        <>
          <ul role="list" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {skills.slice(0, limit).map((skill, index) => (
              <li
                key={`${skill.source}/${skill.skillId}`}
                className="animate-catalog-card-in min-w-0"
                style={{ animationDelay: `${Math.max(0, index - entranceStart) * 25}ms` }}
              >
                <article className="h-full">
                  <button
                    type="button"
                    aria-label={`${skill.name} · ${skill.source}`}
                    onClick={() => onOpen(skill)}
                    className="group flex h-full w-full flex-col items-start rounded-xl border border-border/70 bg-card p-4 text-left transition-colors hover:bg-accent/40 hover:border-primary/30 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-medium">{skill.name}</span>
                      <ArrowUpRight
                        aria-hidden="true"
                        className="size-3.5 shrink-0 text-muted-foreground group-hover:text-primary"
                      />
                    </span>
                    <span className="mt-1 truncate max-w-full text-xs text-muted-foreground">
                      {skill.source}
                    </span>
                    <span className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Download aria-hidden="true" className="size-3" />
                      {number.format(skill.installs)}{" "}
                      {t(kind === "popular" ? "browse.totalInstalls" : "browse.dailyInstalls")}
                    </span>
                  </button>
                </article>
              </li>
            ))}
          </ul>
          {limit < skills.length && <div ref={sentinelRef} aria-hidden="true" className="h-px" />}
        </>
      )}
    </section>
  );
}

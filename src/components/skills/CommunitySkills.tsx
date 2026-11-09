import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
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

// Eight weekly install counts as a watermark-style area sparkline, anchored
// to the card's empty bottom-right corner: a smooth curve over a gradient
// that fades downward, with the latest week marked by a dot. Purely
// decorative; the install number above carries the meaning.
function TrendSparkline({ values }: { values: number[] }) {
  const gradientId = useId();
  if (values.length < 2) return null;
  const width = 104;
  const height = 30;
  const pad = 3;
  const max = Math.max(...values, 1);
  const points = values.map((value, index): [number, number] => [
    pad + (index / (values.length - 1)) * (width - 2 * pad),
    height - pad - (value / max) * (height - 2 * pad),
  ]);
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;
  // Catmull-Rom through the points, emitted as cubic beziers: the curve
  // reads like a chart, not a join-the-dots zigzag.
  let line = `M ${first[0]},${first[1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const prev = points[Math.max(0, i - 1)];
    const current = points[i];
    const following = points[i + 1];
    const next = points[Math.min(points.length - 1, i + 2)];
    if (!prev || !current || !following || !next) continue;
    const [x1, y1] = current;
    const [x2, y2] = following;
    line += ` C ${x1 + (x2 - prev[0]) / 6},${y1 + (y2 - prev[1]) / 6} ${x2 - (next[0] - x1) / 6},${
      y2 - (next[1] - y1) / 6
    } ${x2},${y2}`;
  }
  const [lastX, lastY] = last;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-[30px] w-[104px] text-primary"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d={`${line} L ${lastX},${height} L ${first[0]},${height} Z`}
        fill={`url(#${gradientId})`}
        stroke="none"
      />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.55"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx={lastX} cy={lastY} r="2" fill="currentColor" fillOpacity="0.55" />
    </svg>
  );
}

// Only Hot cards have the additional 104 × 30 trend slot.
function CatalogCardSkeleton({ showTrend }: { showTrend: boolean }) {
  return (
    <div aria-hidden="true" className="skeleton-card h-full flex flex-col p-4">
      <div className="flex h-[19.5px] w-full items-center justify-between gap-4">
        <Skeleton className="h-3 w-1/2" />
        <div className="flex items-center gap-1">
          <Skeleton className="size-3 rounded-sm opacity-50" />
          <Skeleton className="h-2.5 w-7 opacity-60" />
        </div>
      </div>
      <div className="mt-1 flex h-4 items-center">
        <Skeleton className="h-2 w-2/5 opacity-60" />
      </div>
      {showTrend && (
        <svg
          viewBox="0 0 104 30"
          className="mt-auto h-[30px] w-[104px] self-end text-primary"
          aria-hidden="true"
        >
          {/* A neutral chart silhouette reserves the slot without implying real values. */}
          <path
            d="M3 24 C18 24 20 18 34 19 S51 12 65 14 S83 8 101 6 L101 30 L3 30 Z"
            fill="currentColor"
            fillOpacity="0.025"
          />
          <path
            d="M3 24 C18 24 20 18 34 19 S51 12 65 14 S83 8 101 6"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.09"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      )}
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
  const sectionRef = useRef<HTMLElement>(null);
  const [columns, setColumns] = useState(3);
  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const update = () => {
      if (section.clientWidth > 0) {
        setColumns(Math.max(1, Math.floor((section.clientWidth + 12) / 292)));
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(section);
    return () => observer.disconnect();
  }, []);
  const switchKind = (value: CatalogKind) => {
    if (value === kind) return;
    setKind(value);
    setLimit(12);
    setEntranceStart(0);
  };
  const number = new Intl.NumberFormat(i18n.language, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  return (
    <section ref={sectionRef} className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold">{t("browse.community")}</h2>
        <div
          className="relative inline-grid grid-cols-2 rounded-lg bg-muted p-1"
          role="group"
          aria-label={t("browse.community")}
        >
          {/* Single highlight knob sliding under the labels (technique from
              genesis's sliding-pill): grid cells make the knob exactly one
              cell wide, so translate-x-full travels one cell. Pure transform,
              no layout work. */}
          <span
            aria-hidden="true"
            className={cn(
              "absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-md bg-background shadow-sm",
              "transition-transform duration-200 ease-out motion-reduce:transition-none",
              kind === "trending" && "translate-x-full",
            )}
          />
          {(["popular", "trending"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={kind === value}
              className={cn(
                "relative z-10 flex h-8 items-center justify-center px-3 text-xs font-medium transition-colors",
                kind === value ? "text-foreground" : "text-muted-foreground",
              )}
              onClick={() => switchKind(value)}
            >
              {t(`browse.${value}`)}
            </button>
          ))}
        </div>
      </div>
      {isPending ? (
        <>
          <div
            aria-busy="true"
            aria-label={t("common.loading")}
            className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-3"
          >
            {Array.from({ length: columns * 3 }, (_, index) => (
              <CatalogCardSkeleton key={index} showTrend={kind === "popular"} />
            ))}
          </div>
          <div
            aria-hidden="true"
            className="loading-dots mt-4 flex items-center justify-center gap-2"
          >
            {Array.from({ length: 5 }, (_, index) => (
              <span
                key={index}
                className="size-1.5 rounded-full bg-foreground opacity-15"
                style={{ animationDelay: `${index * 180}ms` }}
              />
            ))}
          </div>
        </>
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
          <ul
            role="list"
            className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-3"
          >
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
                      <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground">
                        <Download aria-hidden="true" className="size-3" />
                        {number.format(skill.installs)}
                        <span className="sr-only">
                          {t(kind === "popular" ? "browse.totalInstalls" : "browse.dailyInstalls")}
                        </span>
                      </span>
                    </span>
                    <span className="mt-1 truncate max-w-full text-xs text-muted-foreground">
                      {skill.source}
                    </span>
                    <span className="mt-auto self-end">
                      <TrendSparkline values={skill.weeklyInstalls ?? []} />
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

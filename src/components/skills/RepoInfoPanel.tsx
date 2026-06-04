import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
  type WheelEvent,
} from "react";
import { Star, GitFork, BookOpen, AlertCircle, LoaderCircle } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useRefreshRepoPanel, useRepoMetadata, useRepoReadme } from "@/hooks/useSkills";
import { MarkdownContent } from "@/components/skills/MarkdownContent";
import { useRepoPanelCollapsed } from "@/hooks/useRepoPanelCollapsed";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { openUrl } from "@tauri-apps/plugin-opener";

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

interface RepoInfoPanelProps {
  owner: string;
  name: string;
}

const PULL_REFRESH_THRESHOLD = 128;
const PULL_REFRESH_MAX = 150;
const MIN_REFRESH_SPINNER_MS = 700;

function usePullToRefresh({
  viewportRef,
  disabled,
  onRefresh,
}: {
  viewportRef: RefObject<HTMLDivElement | null>;
  disabled: boolean;
  onRefresh: () => void;
}) {
  const [distance, setDistance] = useState(0);
  const pointerStartYRef = useRef<number | null>(null);
  const refreshTriggeredRef = useRef(false);
  const wheelResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const atTop = useCallback(() => (viewportRef.current?.scrollTop ?? 0) <= 0, [viewportRef]);

  const reset = useCallback(() => {
    setDistance(0);
    pointerStartYRef.current = null;
    refreshTriggeredRef.current = false;
    if (wheelResetTimerRef.current) {
      clearTimeout(wheelResetTimerRef.current);
      wheelResetTimerRef.current = null;
    }
  }, []);

  const triggerRefresh = useCallback(() => {
    if (refreshTriggeredRef.current) return;
    refreshTriggeredRef.current = true;
    setDistance(PULL_REFRESH_THRESHOLD);
    onRefresh();
  }, [onRefresh]);

  const onPointerDown = useCallback(
    (event: PointerEvent) => {
      if (disabled || event.pointerType === "mouse" || !atTop()) return;
      pointerStartYRef.current = event.clientY;
    },
    [atTop, disabled],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const startY = pointerStartYRef.current;
      if (disabled || startY == null) return;

      const delta = event.clientY - startY;
      if (delta <= 0) {
        setDistance(0);
        return;
      }

      event.preventDefault();
      setDistance(Math.min(PULL_REFRESH_MAX, delta * 0.42));
    },
    [disabled],
  );

  const onPointerEnd = useCallback(() => {
    if (disabled || pointerStartYRef.current == null) return;
    setDistance((current) => {
      if (current >= PULL_REFRESH_THRESHOLD) {
        triggerRefresh();
        return PULL_REFRESH_THRESHOLD;
      }
      return 0;
    });
    pointerStartYRef.current = null;
  }, [disabled, triggerRefresh]);

  const onWheel = useCallback(
    (event: WheelEvent) => {
      if (disabled || !atTop() || event.deltaY >= 0) return;

      event.preventDefault();
      setDistance((current) => {
        const next = Math.min(PULL_REFRESH_MAX, current + Math.abs(event.deltaY) * 0.1);
        if (next >= PULL_REFRESH_THRESHOLD) {
          triggerRefresh();
          return PULL_REFRESH_THRESHOLD;
        }
        return next;
      });

      if (wheelResetTimerRef.current) clearTimeout(wheelResetTimerRef.current);
      wheelResetTimerRef.current = setTimeout(() => setDistance(0), 220);
    },
    [atTop, disabled, triggerRefresh],
  );

  return {
    distance: disabled ? PULL_REFRESH_THRESHOLD : distance,
    active: distance >= PULL_REFRESH_THRESHOLD || disabled,
    reset,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: reset,
      onWheel,
    },
  };
}

export function RepoInfoPanel({ owner, name }: RepoInfoPanelProps) {
  const { collapsed, rotation, handleToggle } = useRepoPanelCollapsed();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const wasRefreshingRef = useRef(false);
  const refreshStartedAtRef = useRef<number | null>(null);
  const refreshResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [spinnerHolding, setSpinnerHolding] = useState(false);
  const {
    data: metadata,
    isLoading: metaLoading,
    isError: metaError,
  } = useRepoMetadata(owner, name);
  const { data: readme, isLoading: readmeLoading } = useRepoReadme(owner, name, metadata?.branch);
  const refreshPanel = useRefreshRepoPanel(owner, name, metadata?.branch);
  const isRefreshing = refreshPanel.isPending;
  const showRefreshing = isRefreshing || spinnerHolding;
  const {
    distance: pullDistance,
    active: pullActive,
    reset: resetPullToRefresh,
    handlers: pullHandlers,
  } = usePullToRefresh({
    viewportRef,
    disabled: showRefreshing,
    onRefresh: () => {
      refreshStartedAtRef.current = Date.now();
      setSpinnerHolding(false);
      if (refreshResetTimerRef.current) clearTimeout(refreshResetTimerRef.current);
      refreshPanel.mutate();
    },
  });
  const pullProgress = Math.min(1, pullDistance / PULL_REFRESH_THRESHOLD);

  useEffect(() => {
    if (wasRefreshingRef.current && !isRefreshing) {
      const elapsed = Date.now() - (refreshStartedAtRef.current ?? Date.now());
      const remaining = Math.max(0, MIN_REFRESH_SPINNER_MS - elapsed);
      if (remaining > 0) {
        setSpinnerHolding(true);
        refreshResetTimerRef.current = setTimeout(() => {
          setSpinnerHolding(false);
          resetPullToRefresh();
          refreshStartedAtRef.current = null;
          refreshResetTimerRef.current = null;
        }, remaining);
      } else {
        resetPullToRefresh();
        refreshStartedAtRef.current = null;
      }
    }
    wasRefreshingRef.current = isRefreshing;
  }, [isRefreshing, resetPullToRefresh]);

  useEffect(() => {
    return () => {
      if (refreshResetTimerRef.current) clearTimeout(refreshResetTimerRef.current);
    };
  }, []);

  return (
    <>
      {/* Persistent GitHub toggle button */}
      <motion.button
        className="group absolute -right-[7px] bottom-[18px] w-[40px] h-[40px] rounded-full bg-background/60
                   backdrop-blur-md border border-border/50 shadow-lg flex items-center
                   justify-center hover:bg-background/80 hover:border-border/80 z-20"
        onClick={handleToggle}
        animate={{ scale: collapsed ? 1 : 1.15 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
      >
        <motion.div
          animate={{ rotate: rotation, opacity: collapsed ? 0.7 : 1 }}
          transition={{ duration: 0.2, ease: "easeInOut" }}
        >
          <GithubIcon className="h-[20px] w-[20px] group-hover:opacity-100 transition-opacity duration-200" />
        </motion.div>
      </motion.button>

      {/* Expanded: info panel */}
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            className="shrink-0 w-[32%] min-w-[360px] flex flex-col rounded-t-[18px] bg-popover
                       border border-b-0 border-border/65 dark:border-white/10
                       shadow-[0_12px_32px_rgba(15,23,42,0.10)] dark:shadow-[0_22px_55px_rgba(0,0,0,0.45)]
                       ml-4"
            data-selectable
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%", transition: { duration: 0.2, ease: "easeIn" } }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <div className="relative flex-1 min-h-0" {...pullHandlers}>
              <motion.div
                className="pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2"
                initial={false}
                animate={{
                  opacity: pullDistance > 0 || showRefreshing ? 1 : 0,
                  y: pullDistance > 0 || showRefreshing ? 0 : -10,
                  scale: 0.85 + pullProgress * 0.15,
                }}
                transition={{ duration: 0.16, ease: "easeOut" }}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border/70 bg-popover/95 shadow-sm backdrop-blur">
                  <LoaderCircle
                    className={`h-4 w-4 text-muted-foreground ${
                      showRefreshing || pullActive ? "animate-spin" : ""
                    }`}
                    style={{
                      transform:
                        showRefreshing || pullActive
                          ? undefined
                          : `rotate(${pullProgress * 240}deg)`,
                    }}
                  />
                </div>
              </motion.div>

              <ScrollArea
                viewportRef={viewportRef}
                className="h-full overflow-hidden px-5 pt-4 pb-0"
              >
                <div className="space-y-4">
                  {/* Header */}
                  <div>
                    <h3 className="text-xl font-bold tracking-tight truncate">
                      <button
                        className="hover:underline cursor-pointer text-left truncate max-w-full"
                        onClick={() =>
                          openUrl(metadata?.htmlUrl ?? `https://github.com/${owner}/${name}`)
                        }
                      >
                        {owner}/{name}
                      </button>
                    </h3>

                    {metaLoading ? (
                      <div className="mt-2 space-y-2">
                        <Skeleton className="h-3.5 w-3/4" />
                        <div className="flex gap-4 pt-1">
                          <Skeleton className="h-3 w-14" />
                          <Skeleton className="h-3 w-10" />
                          <Skeleton className="h-3 w-10" />
                        </div>
                        <div className="flex gap-1.5 pt-1">
                          <Skeleton className="h-5 w-12 rounded-full" />
                          <Skeleton className="h-5 w-14 rounded-full" />
                          <Skeleton className="h-5 w-10 rounded-full" />
                        </div>
                      </div>
                    ) : metaError ? (
                      <p className="text-xs text-muted-foreground mt-1">Failed to load repo info</p>
                    ) : (
                      metadata?.description && (
                        <p className="text-sm text-muted-foreground mt-1 leading-relaxed line-clamp-3">
                          {metadata.description}
                        </p>
                      )
                    )}
                  </div>

                  {/* Stats row */}
                  {!metaLoading && !metaError && (
                    <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                      {metadata?.stars != null && (
                        <span className="flex items-center gap-1">
                          <Star className="h-3.5 w-3.5" />
                          {metadata.stars >= 1000
                            ? `${(metadata.stars / 1000).toFixed(1)}k`
                            : metadata.stars}
                        </span>
                      )}
                      {metadata?.forks != null && (
                        <span className="flex items-center gap-1">
                          <GitFork className="h-3.5 w-3.5" />
                          {metadata.forks}
                        </span>
                      )}
                      {metadata?.openIssues != null && (
                        <span className="flex items-center gap-1">
                          <AlertCircle className="h-3.5 w-3.5" />
                          {metadata.openIssues}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Meta badges */}
                  {!metaLoading && !metaError && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {metadata?.language && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5">
                          {metadata.language}
                        </Badge>
                      )}
                      {metadata?.license && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5">
                          {metadata.license}
                        </Badge>
                      )}
                      {metadata?.topics?.map((topic) => (
                        <Badge
                          key={topic}
                          variant="outline"
                          className="text-[10px] px-1.5 py-0 h-5"
                        >
                          {topic}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* README */}
                  {readmeLoading ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 pb-2 border-b border-border/50">
                        <Skeleton className="h-3 w-3" />
                        <Skeleton className="h-3 w-20" />
                      </div>
                      <div className="space-y-2">
                        <Skeleton className="h-3.5 w-full" />
                        <Skeleton className="h-3.5 w-11/12" />
                        <Skeleton className="h-3.5 w-5/6" />
                        <Skeleton className="h-3.5 w-full" />
                        <Skeleton className="h-3.5 w-4/5" />
                      </div>
                    </div>
                  ) : readme ? (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.2 }}
                    >
                      <div className="flex items-center gap-2 pb-2 border-b border-border/50">
                        <BookOpen className="h-3 w-3 text-muted-foreground" />
                        <span className="text-[10px] text-muted-foreground font-mono tracking-wider">
                          README.md
                        </span>
                      </div>
                      <div className="pt-3">
                        <MarkdownContent
                          content={readme}
                          repoOwner={owner}
                          repoName={name}
                          repoBranch={metadata?.branch}
                        />
                      </div>
                    </motion.div>
                  ) : null}
                </div>
              </ScrollArea>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

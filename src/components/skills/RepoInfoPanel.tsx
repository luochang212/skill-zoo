import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
  type WheelEvent,
} from "react";
import { Star, GitFork, BookOpen, AlertCircle, AlertTriangle, LoaderCircle } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useRefreshRepoPanel, useRepoMetadata, useRepoReadme } from "@/hooks/useSkills";
import { MarkdownContent } from "@/components/skills/MarkdownContent";
import { useRepoPanelCollapsed } from "@/hooks/useRepoPanelCollapsed";
import { apiErrorCode, formatApiError } from "@/lib/api/errors";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { GithubIcon } from "@/components/ui/github-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { openUrl } from "@tauri-apps/plugin-opener";

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
  const { t } = useTranslation();
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
    error: metaErrorObj,
  } = useRepoMetadata(owner, name);
  const {
    data: readme,
    isLoading: readmeLoading,
    error: readmeError,
  } = useRepoReadme(owner, name, undefined);
  const refreshPanel = useRefreshRepoPanel(owner, name, undefined);
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
          animate={{ rotate: rotation.current, opacity: collapsed ? 0.7 : 1 }}
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
                      <div className="flex items-center gap-1.5 mt-1">
                        <AlertTriangle className="h-3 w-3 text-destructive/70 shrink-0" />
                        <span className="text-xs text-destructive/80">
                          {formatApiError(metaErrorObj)}
                        </span>
                        <button
                          type="button"
                          className="text-xs underline hover:text-foreground cursor-pointer ml-1"
                          onClick={() => refreshPanel.mutate()}
                        >
                          {t("error.retry")}
                        </button>
                      </div>
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
                  ) : readmeError && apiErrorCode(readmeError) !== "repoNotFound" ? (
                    <p className="text-xs text-destructive/80" role="alert">
                      {formatApiError(readmeError)}
                    </p>
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
                          repoBranch={metadata?.defaultBranch}
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

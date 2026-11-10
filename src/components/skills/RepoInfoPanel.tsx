import { useId, useRef } from "react";
import { Star, GitFork, BookOpen, AlertCircle, AlertTriangle, LoaderCircle } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useRefreshRepoPanel, useRepoMetadata, useRepoReadme } from "@/hooks/useSkills";
import { MarkdownContent } from "@/components/skills/MarkdownContent";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useRepoPanelRefresh } from "@/hooks/useRepoPanelRefresh";
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
  collapsed: boolean;
  rotation: number;
  onToggle: () => void;
}

export function RepoInfoPanel({ owner, name, collapsed, rotation, onToggle }: RepoInfoPanelProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const panelId = useId();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const {
    data: metadata,
    isLoading: metaLoading,
    isError: metaError,
    error: metaErrorObj,
  } = useRepoMetadata(owner, name);
  const { data: readme, isLoading: readmeLoading, error: readmeError } = useRepoReadme(owner, name);
  const refreshPanel = useRefreshRepoPanel(owner, name);
  const { distance, progress, refreshing, refresh, handlers } = useRepoPanelRefresh({
    viewportRef,
    onRefresh: refreshPanel.mutateAsync,
    disabled: collapsed,
  });

  return (
    <>
      <motion.button
        className="group motion-reduce:transform-none! absolute right-[17px] bottom-[18px] w-[40px] h-[40px] rounded-full bg-background/60
                   backdrop-blur-md border border-border/50 shadow-lg flex items-center
                   justify-center hover:bg-background/80 hover:border-border/80 z-20"
        type="button"
        aria-label={t("repoPanel.toggle")}
        aria-expanded={!collapsed}
        aria-controls={panelId}
        onClick={onToggle}
        animate={{ scale: reduceMotion || collapsed ? 1 : 1.15 }}
        transition={{ duration: reduceMotion ? 0 : 0.2, ease: "easeOut" }}
      >
        <motion.div
          className="motion-reduce:transform-none!"
          animate={{ rotate: reduceMotion ? 0 : rotation, opacity: collapsed ? 0.7 : 1 }}
          transition={{ duration: reduceMotion ? 0 : 0.2, ease: "easeInOut" }}
        >
          <GithubIcon className="h-[20px] w-[20px] group-hover:opacity-100 transition-opacity duration-200" />
        </motion.div>
      </motion.button>

      <AnimatePresence>
        {!collapsed && (
          <motion.div
            className="motion-reduce:transform-none! shrink-0 w-[32%] min-w-[360px] flex flex-col rounded-t-[18px] bg-popover
                       border border-b-0 border-border/65 dark:border-white/10
                       shadow-[0_12px_32px_rgba(15,23,42,0.10)] dark:shadow-[0_22px_55px_rgba(0,0,0,0.45)]
                       ml-4"
            id={panelId}
            data-selectable
            initial={reduceMotion ? false : { y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%", transition: { duration: reduceMotion ? 0 : 0.2, ease: "easeIn" } }}
            transition={{ duration: reduceMotion ? 0 : 0.2, ease: "easeOut" }}
          >
            <div className="relative flex-1 min-h-0" {...handlers}>
              <motion.div
                className="pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2"
                initial={false}
                animate={{
                  opacity: distance > 0 || refreshing ? 1 : 0,
                  y: distance > 0 || refreshing ? 0 : -10,
                  scale: 0.85 + progress * 0.15,
                }}
                transition={{ duration: reduceMotion ? 0 : 0.16, ease: "easeOut" }}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border/70 bg-popover/95 shadow-sm backdrop-blur">
                  <LoaderCircle
                    className={`h-4 w-4 text-muted-foreground ${
                      refreshing && !reduceMotion ? "animate-spin" : ""
                    }`}
                    style={{
                      transform: refreshing ? undefined : `rotate(${progress * 240}deg)`,
                    }}
                  />
                </div>
              </motion.div>

              <ScrollArea
                viewportRef={viewportRef}
                className={`h-full overflow-hidden px-5 pt-4 pb-0 [&_[data-radix-scroll-area-viewport]]:overscroll-contain ${readmeLoading ? "[&_[data-radix-scroll-area-viewport]>div]:h-full" : ""}`}
              >
                <div className={readmeLoading ? "flex h-full flex-col gap-4" : "space-y-4"}>
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
                          onClick={refresh}
                          disabled={refreshing}
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

                  {readmeLoading ? (
                    <div className="flex-1 min-h-0 overflow-clip space-y-3">
                      <div className="flex items-center gap-2 pb-2 border-b border-border/50">
                        <Skeleton className="h-3 w-3" />
                        <Skeleton className="h-3 w-20" />
                      </div>
                      <div className="space-y-2">
                        {Array.from({ length: 24 }).map((_, index) => (
                          <Skeleton
                            key={index}
                            className={index % 3 === 0 ? "h-3.5 w-4/5" : "h-3.5 w-full"}
                          />
                        ))}
                      </div>
                    </div>
                  ) : readmeError && apiErrorCode(readmeError) !== "repoNotFound" ? (
                    <p className="text-xs text-destructive/80" role="alert">
                      {formatApiError(readmeError)}
                    </p>
                  ) : readme ? (
                    <motion.div
                      className="motion-reduce:opacity-100!"
                      initial={reduceMotion ? false : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: reduceMotion ? 0 : 0.2 }}
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
                          documentPath="README.md"
                          repoLinksExternal
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

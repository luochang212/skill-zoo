import { useId, useRef } from "react";
import { Star, GitFork, BookOpen, AlertCircle, AlertTriangle, LoaderCircle } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useRefreshRepoPanel, useRepoMetadata, useRepoReadme } from "@/hooks/useSkills";
import { MarkdownContent } from "@/components/skills/MarkdownContent";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useRepoPanelRefresh } from "@/hooks/useRepoPanelRefresh";
import { apiErrorCode, formatApiError, formatRetryTime, rateLimitInfo } from "@/lib/api/errors";
import { useTranslation, Trans } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GithubIcon } from "@/components/ui/github-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { openUrl } from "@tauri-apps/plugin-opener";
import { emit } from "@tauri-apps/api/event";

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
  const quota = metaError ? rateLimitInfo(metaErrorObj) : null;

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
                    ) : metaError && quota ? (
                      <div className="mt-3 overflow-hidden rounded-2xl border border-orange-200/80 bg-gradient-to-br from-amber-100 via-orange-100 to-rose-100 px-4 py-4 shadow-sm dark:border-amber-400/25 dark:from-amber-950/80 dark:via-orange-950/70 dark:to-rose-950/80">
                        <div className="flex items-center gap-3">
                          <p className="min-w-0 flex-1 text-base font-semibold leading-[28px] text-amber-950 dark:text-amber-50">
                            {t("repoPanel.quotaTitle")}
                          </p>
                          <Button
                            size="sm"
                            className="h-7 shrink-0 rounded-full bg-gradient-to-br from-amber-400 via-orange-400 to-rose-400 px-3 text-xs font-semibold text-white shadow-md hover:brightness-95"
                            disabled={refreshing}
                            onClick={refresh}
                          >
                            {t("error.retry")}
                          </Button>
                        </div>
                        <p className="mt-2 text-xs leading-normal text-amber-900/75 dark:text-amber-100/70">
                          {quota.authenticated === true ? (
                            t("repoPanel.quotaBodyAuthenticated")
                          ) : (
                            <Trans
                              i18nKey="repoPanel.quotaBodyAnonymous"
                              components={{
                                tokenLink: (
                                  <button
                                    type="button"
                                    className="font-medium text-amber-900 underline decoration-amber-500/60 underline-offset-2 hover:text-amber-950 dark:text-amber-100 dark:decoration-amber-300/50"
                                    onClick={() =>
                                      void emit("navigate", "settings:github-token").catch(() => {})
                                    }
                                  />
                                ),
                              }}
                            />
                          )}
                        </p>
                        {quota.retryAt != null && formatRetryTime(quota.retryAt) && (
                          <div className="mt-2.5">
                            <span className="inline-flex items-center rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-medium tabular-nums text-amber-900 dark:bg-white/10 dark:text-amber-100">
                              {t("repoPanel.quotaResetsAt", {
                                time: formatRetryTime(quota.retryAt),
                              })}
                            </span>
                          </div>
                        )}
                      </div>
                    ) : metaError ? (
                      <div className="mt-3 flex items-start gap-2.5 rounded-2xl border border-destructive/25 bg-destructive/5 px-4 py-3.5">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <p className="min-w-0 flex-1 py-1.5 text-xs leading-relaxed text-destructive/90">
                          {formatApiError(metaErrorObj)}
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 shrink-0 rounded-full px-3.5 text-xs"
                          disabled={refreshing}
                          onClick={refresh}
                        >
                          {t("error.retry")}
                        </Button>
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
                  ) : readmeError &&
                    apiErrorCode(readmeError) !== "repoNotFound" &&
                    (!metaError || apiErrorCode(readmeError) !== apiErrorCode(metaErrorObj)) ? (
                    <div
                      className="flex items-start gap-2.5 rounded-2xl border border-destructive/25 bg-destructive/5 px-4 py-3"
                      role="alert"
                    >
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                      </span>
                      <p className="min-w-0 flex-1 text-xs leading-relaxed text-destructive/90">
                        {formatApiError(readmeError)}
                      </p>
                    </div>
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

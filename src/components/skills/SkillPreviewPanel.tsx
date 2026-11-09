import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, ArrowUpRight } from "lucide-react";
import { useSkeletonCount } from "@/hooks/useSkeletonCount";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { MarkdownContent } from "@/components/skills/MarkdownContent";
import { Button } from "@/components/ui/button";
import type { DiscoverableSkill } from "@/types/skills";

interface SkillPreviewPanelProps {
  open: boolean;
  loading: boolean;
  /** undefined = no error; null = generic failure; string = specific message. */
  error?: string | null;
  content: string | undefined;
  skillName: string;
  /** Present when the panel offers installation; the footer is hidden otherwise. */
  installStatus?: DiscoverableSkill["installStatus"];
  /** Gray placeholder footer while the install status is still resolving. */
  installLoading?: boolean;
  installPending?: boolean;
  onInstall?: () => void;
  /** Shown under a resolution error so the user can pick a skill manually. */
  fallbackSkills?: DiscoverableSkill[];
  onPickFallback?: (skill: DiscoverableSkill) => void;
  /** Replaces the skill name in the footer when the caller's context already
   * identifies the skill but not the repository it belongs to. */
  repoLabel?: string;
  /** Makes the repo label clickable to open the repository detail page. */
  onOpenRepo?: () => void;
  /** False hides the load progress bar for callers whose content is usually
   * cached, where the instant completion flash carries no information. */
  showProgressBar?: boolean;
  onClose: () => void;
}

function SkillPreviewSkeleton() {
  const { ref, count } = useSkeletonCount(Infinity, 156, 24);
  return (
    <div
      aria-hidden="true"
      className="markdown-reader flex flex-1 min-h-0 flex-col overflow-hidden px-5 py-4 [&_.skeleton]:animate-none [&_.skeleton]:rounded-sm"
    >
      <div className="shrink-0">
        <div className="not-prose mb-4">
          <table className="reader-metadata w-full table-fixed border-collapse rounded-lg overflow-hidden border border-border/60">
            <tbody>
              <tr className="border-b border-border/60">
                <td className="w-32 bg-muted/40 px-3 py-1.5 align-top">
                  <div className="flex h-[1.6em] items-center">
                    <Skeleton className="h-2.5 w-10" />
                  </div>
                </td>
                <td className="px-3 py-1.5">
                  <Skeleton className="h-2.5 w-3/5" />
                </td>
              </tr>
              <tr>
                <td className="w-32 bg-muted/40 px-3 py-1.5 align-top">
                  <div className="flex h-[1.6em] items-center">
                    <Skeleton className="h-2.5 w-20" />
                  </div>
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex h-[1.6em] items-center">
                    <Skeleton className="h-2.5 w-full" />
                  </div>
                  <div className="flex h-[1.6em] items-center">
                    <Skeleton className="h-2.5 w-4/5" />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mb-3 flex h-[calc(var(--reader-h1-size)*var(--reader-h1-leading))] items-center">
          <Skeleton className="h-5 w-3/5" />
        </div>
        <div className="my-3.5">
          <div className="flex h-[1.7em] items-center">
            <Skeleton className="h-2.5 w-full" />
          </div>
          <div className="flex h-[1.7em] items-center">
            <Skeleton className="h-2.5 w-11/12" />
          </div>
        </div>
        <div className="my-3.5 rounded-lg border border-border/60 bg-card/50 px-4 py-3.5">
          {[64, 84, 48].map((width) => (
            <div
              key={width}
              className="flex h-[calc(var(--reader-code-size)*var(--reader-code-leading))] items-center"
            >
              <Skeleton className="h-2" style={{ width: `${width}%` }} />
            </div>
          ))}
        </div>
      </div>
      <div ref={ref} className="flex-1 min-h-0 overflow-hidden pt-2.5">
        <div className="flex flex-col gap-6">
          {Array.from({ length: count }, (_, index) => (
            <div key={index} className="h-[156px] shrink-0">
              <div className="mb-3 flex h-[calc(var(--reader-h2-size)*var(--reader-h2-leading))] items-center">
                <Skeleton className="h-3.5" style={{ width: `${[42, 56, 35][index % 3]}%` }} />
              </div>
              <div className="flex h-[1.7em] items-center">
                <Skeleton className="h-2.5 w-full" />
              </div>
              <div className="flex h-[1.7em] items-center">
                <Skeleton className="h-2.5 w-4/5" />
              </div>
              <div className="mt-3.5 pl-6">
                {[78, 60].map((width) => (
                  <div key={width} className="flex h-[1.7em] items-center gap-3">
                    <Skeleton className="size-1 shrink-0 rounded-full" />
                    <Skeleton className="h-2.5" style={{ width: `${width}%` }} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// The preview side panel from the repo page, extracted so community skills on
// the Discover page can preview in the same shell. No header: the caller's
// context already identifies the skill, the backdrop closes, and the only
// added control is the install button in the footer.
export function SkillPreviewPanel({
  open,
  loading,
  error,
  content,
  skillName,
  installStatus,
  installLoading = false,
  installPending = false,
  onInstall,
  fallbackSkills,
  onPickFallback,
  repoLabel,
  onOpenRepo,
  showProgressBar = true,
  onClose,
}: SkillPreviewPanelProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const [hadLoading, setHadLoading] = useState(false);
  useEffect(() => {
    if (!open || error !== undefined || !showProgressBar) setHadLoading(false);
    else if (loading) setHadLoading(true);
  }, [open, loading, error, showProgressBar]);
  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/20 z-20"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.2 }}
            onClick={onClose}
          />
          {/* Panel */}
          <motion.div
            className="absolute top-0 right-0 h-full w-[45%] min-w-[400px] max-w-[600px] bg-background border-l border-border shadow-xl z-30 flex flex-col"
            initial={reduceMotion ? false : { x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={
              reduceMotion ? { duration: 0 } : { type: "spring", damping: 24, stiffness: 260 }
            }
          >
            {loading ? (
              <SkillPreviewSkeleton />
            ) : (
              <ScrollArea className="flex-1 min-h-0">
                <div className="px-5 py-4">
                  {error !== undefined ? (
                    <div className="py-8">
                      <div className="flex flex-col items-center justify-center gap-3">
                        <AlertTriangle className="h-8 w-8 text-destructive/60" />
                        <p className="text-sm text-muted-foreground">
                          {error ?? t("error.generic")}
                        </p>
                      </div>
                      {fallbackSkills && fallbackSkills.length > 0 && (
                        <ul role="list" className="mt-6 border-t border-border">
                          {fallbackSkills.map((skill) => (
                            <li key={skill.key}>
                              <button
                                type="button"
                                className="w-full text-left py-2.5 border-b border-border/60 hover:bg-accent/50 rounded-md transition-colors"
                                onClick={() => onPickFallback?.(skill)}
                              >
                                <span className="block truncate text-[13px] font-medium">
                                  {skill.name}
                                </span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {skill.key}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : content ? (
                    <MarkdownContent content={content} linksDisabled />
                  ) : null}
                </div>
              </ScrollArea>
            )}
            <div className="relative shrink-0">
              {(loading || hadLoading) && showProgressBar && error === undefined && (
                <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5">
                  {loading && <progress className="sr-only" aria-label={t("common.loading")} />}
                  <div
                    aria-hidden="true"
                    className="translation-intent-progress h-full origin-left bg-teal-700/70 dark:bg-teal-400/50"
                    data-state={loading ? "streaming" : "completed"}
                  />
                </div>
              )}
              {/* While loading, keep the footer present but gray so the button
                never pops in after the content resolves. */}
              {(installStatus !== undefined || installLoading) && (
                <div className="flex shrink-0 items-center gap-4 border-t border-border/50 px-5 py-2.5">
                  {repoLabel && onOpenRepo ? (
                    <button
                      type="button"
                      className="group flex min-w-0 flex-1 items-center gap-1 text-left text-[13px] font-medium"
                      title={repoLabel}
                      onClick={onOpenRepo}
                    >
                      <span className="truncate group-hover:underline">{repoLabel}</span>
                      <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  ) : (
                    <span
                      className="min-w-0 flex-1 truncate text-[13px] font-medium"
                      title={skillName}
                    >
                      {skillName}
                    </span>
                  )}
                  <Button
                    size="sm"
                    className="h-7 shrink-0 text-xs"
                    disabled={installStatus !== "available" || installPending}
                    onClick={onInstall}
                  >
                    {t(
                      installStatus === "installed"
                        ? "common.installed"
                        : installStatus === "conflict"
                          ? "browse.nameConflict"
                          : "common.install",
                    )}
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

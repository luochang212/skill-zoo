import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle } from "lucide-react";
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
  /** Present when the panel offers installation; the footer is hidden otherwise. */
  installStatus?: DiscoverableSkill["installStatus"];
  /** Gray placeholder footer while the install status is still resolving. */
  installLoading?: boolean;
  installPending?: boolean;
  onInstall?: () => void;
  /** Shown under a resolution error so the user can pick a skill manually. */
  fallbackSkills?: DiscoverableSkill[];
  onPickFallback?: (skill: DiscoverableSkill) => void;
  onClose: () => void;
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
  installStatus,
  installLoading = false,
  installPending = false,
  onInstall,
  fallbackSkills,
  onPickFallback,
  onClose,
}: SkillPreviewPanelProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
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
            <ScrollArea className="flex-1 min-h-0">
              <div className="px-5 py-4">
                {loading ? (
                  <div aria-busy="true" className="space-y-3">
                    <span className="sr-only">{t("common.loading")}</span>
                    <Skeleton className="h-5 w-1/3 rounded-md" />
                    <Skeleton className="h-3 w-full rounded" />
                    <Skeleton className="h-3 w-11/12 rounded" />
                    <Skeleton className="h-3 w-4/5 rounded" />
                    <Skeleton className="mt-6 h-4 w-1/4 rounded-md" />
                    <Skeleton className="h-3 w-full rounded" />
                    <Skeleton className="h-3 w-3/4 rounded" />
                    <Skeleton className="mt-6 h-16 w-full rounded-md" />
                    <Skeleton className="h-3 w-2/3 rounded" />
                  </div>
                ) : error !== undefined ? (
                  <div className="py-8">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <AlertTriangle className="h-8 w-8 text-destructive/60" />
                      <p className="text-sm text-muted-foreground">{error ?? t("error.generic")}</p>
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
            {/* While loading, keep the footer present but gray so the button
                never pops in after the content resolves. */}
            {(installStatus !== undefined || installLoading) && (
              <div className="border-t border-border px-5 py-3">
                <Button
                  className="w-full"
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
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

import { Star, GitFork, AlertCircle, ExternalLink, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRepoMetadata } from "@/hooks/useSkills";
import { useRepoPanelCollapsed } from "@/hooks/useRepoPanelCollapsed";
import { formatRelativeDate } from "@/lib/date";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { InstalledSkill } from "@/types/skills";

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
  skills: InstalledSkill[];
}

export function RepoInfoPanel({ owner, name, skills }: RepoInfoPanelProps) {
  const { t } = useTranslation();
  const { collapsed, toggle } = useRepoPanelCollapsed();
  const { data: metadata } = useRepoMetadata(owner, name);

  const installedCount = skills.length;
  const lastUpdated = skills.reduce(
    (max, s) => (s.updatedAt > max ? s.updatedAt : max),
    0,
  );

  return (
    <>
      {/* Collapsed: floating button */}
      {collapsed && (
        <button
          className="group absolute right-4 bottom-4 w-11 h-11 rounded-full bg-background/60
                     backdrop-blur-md border border-border/50 shadow-lg flex items-center
                     justify-center hover:bg-background/80 hover:border-border/80 z-20
                     transition-opacity duration-150"
          onClick={toggle}
        >
          <GithubIcon className="h-5 w-5 opacity-70 group-hover:opacity-100 transition-opacity duration-200" />
        </button>
      )}

      {/* Expanded: info panel */}
      {!collapsed && (
        <div
          className="shrink-0 w-[30%] min-w-[300px] max-w-[380px] flex flex-col rounded-xl border border-border bg-card
                     shadow-sm ml-4 mb-4 overflow-hidden"
        >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 p-5 pb-0">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold truncate">
              {owner}/{name}
            </h3>
            {metadata?.description && (
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-3">
                {metadata.description}
              </p>
            )}
          </div>
          <button
            className="shrink-0 w-7 h-7 rounded-full border border-border/50
                       bg-background/60 backdrop-blur-sm flex items-center
                       justify-center hover:bg-background/80 transition-colors"
            onClick={toggle}
            title={t("common.collapse")}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <ScrollArea className="flex-1 px-5 py-4">
          <div className="space-y-4">
            {/* Stats row */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
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

            {/* Meta badges */}
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
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5">
                {metadata?.branch ?? "main"}
              </Badge>
            </div>

            {/* Topics */}
            {metadata?.topics && metadata.topics.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {metadata.topics.map((topic) => (
                  <span
                    key={topic}
                    className="text-[10px] px-1.5 py-0.5 rounded-full
                               bg-sky-100 dark:bg-sky-900/30 text-sky-700
                               dark:text-sky-400/80"
                  >
                    {topic}
                  </span>
                ))}
              </div>
            )}

            {/* Footer */}
            <div className="pt-3 border-t border-border space-y-1.5 text-xs text-muted-foreground">
              <p>
                {t("repoPanel.installedCount", { count: installedCount })}
              </p>
              {lastUpdated > 0 && (
                <p>
                  {t("repoPanel.lastActive")}{" "}
                  {formatRelativeDate(lastUpdated)}
                </p>
              )}
              {metadata?.pushedAt && (
                <p>
                  {t("repoPanel.lastPush")}{" "}
                  {formatRelativeDate(Math.floor(new Date(metadata.pushedAt).getTime() / 1000))}
                </p>
              )}
            </div>

            {/* GitHub link */}
            {metadata?.htmlUrl && (
              <button
                className="flex items-center gap-1.5 text-xs text-muted-foreground
                           hover:text-foreground transition-colors"
                onClick={() => openUrl(metadata.htmlUrl!)}
              >
                <ExternalLink className="h-3 w-3" />
                {t("repoPanel.viewOnGitHub")}
              </button>
            )}
          </div>
        </ScrollArea>
      </div>
      )}
    </>
  );
}
import { useQuery } from "@tanstack/react-query";
import { FolderOpen, FolderSymlink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { skillsApi } from "@/lib/api/skills";
import {
  useVisibleAgents,
  useUpdateVisibleAgents,
  getVisibleAgentsOrDefault,
} from "@/hooks/useSettings";
import type { AgentPathInfo, VisibleAgents } from "@/types/skills";

function PathRow({
  info,
  isVisible,
  onToggleVisibility,
  canToggle,
}: {
  info: AgentPathInfo;
  isVisible: boolean;
  onToggleVisibility: () => void;
  canToggle: boolean;
}) {
  const { t } = useTranslation();
  const isSsot = info.agent === "ssot";
  const Icon = isSsot ? FolderSymlink : FolderOpen;

  const handleOpen = () => {
    skillsApi.openSkillsDir(info.agent);
  };

  return (
    <div
      className={`flex items-center justify-between rounded-xl border border-border p-4 transition-opacity ${
        isSsot ? "bg-primary/5" : "bg-card/50"
      } ${!isVisible && !isSsot ? "opacity-50" : ""}`}
    >
      <div className="flex items-center gap-3 min-w-0">
        {/* Visibility toggle (not for SSOT) */}
        {!isSsot ? (
          <Switch
            checked={isVisible}
            onCheckedChange={onToggleVisibility}
            disabled={!canToggle && isVisible}
            aria-label={`Toggle visibility for ${info.label}`}
            className="shrink-0"
          />
        ) : (
          <div className="flex h-5 w-9 shrink-0 items-center justify-center">
            <FolderSymlink className="h-3.5 w-3.5 text-primary" />
          </div>
        )}

        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border">
          <Icon className={`h-4 w-4 ${isSsot ? "text-primary" : "text-muted-foreground"}`} />
        </div>

        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium leading-none">{info.label}</p>
            {!info.exists && (
              <span className="text-[10px] text-muted-foreground/60 leading-none">
                {t("settings.agentPaths.notFound")}
              </span>
            )}
            {!isVisible && !isSsot && (
              <span className="text-[10px] text-muted-foreground/60 leading-none">
                {t("settings.agentPaths.hidden")}
              </span>
            )}
          </div>
          <p className="font-mono text-xs text-muted-foreground truncate">{info.path}</p>
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-8 text-xs gap-1.5 shrink-0 ml-3"
        onClick={handleOpen}
        disabled={!info.exists}
      >
        <FolderOpen className="h-3.5 w-3.5" />
        {t("settings.agentPaths.open")}
      </Button>
    </div>
  );
}

export function AgentPathsSettings() {
  const { t } = useTranslation();
  const { data: paths } = useQuery({
    queryKey: ["agentPaths"],
    queryFn: () => skillsApi.getAgentPaths(),
  });
  const { data: visibleAgentsData } = useVisibleAgents();
  const updateVisibleAgents = useUpdateVisibleAgents();

  const visibleAgents = getVisibleAgentsOrDefault(visibleAgentsData);

  const visibleCount = Object.values(visibleAgents).filter(Boolean).length;

  const handleToggleVisibility = (agent: string) => {
    const currentVisible = visibleAgents[agent] !== false;
    // Prevent hiding the last visible agent
    if (currentVisible && visibleCount <= 1) return;

    const updated: VisibleAgents = { ...visibleAgents, [agent]: !currentVisible };
    updateVisibleAgents.mutate(updated);
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 pb-2 border-b border-border/40">
        <FolderOpen className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-medium">{t("settings.agentPaths.title")}</h3>
      </div>

      <p className="text-xs text-muted-foreground">{t("settings.agentPaths.description")}</p>

      <div className="space-y-3">
        {paths?.map((info) => {
          const isSsot = info.agent === "ssot";
          const isVisible = isSsot || visibleAgents[info.agent] !== false;
          const canToggle = !isSsot && !(isVisible && visibleCount <= 1);

          return (
            <PathRow
              key={info.agent}
              info={info}
              isVisible={isVisible}
              onToggleVisibility={() => handleToggleVisibility(info.agent)}
              canToggle={canToggle}
            />
          );
        })}
      </div>

      <p className="text-[11px] text-muted-foreground/70">{t("settings.agentPaths.hiddenHint")}</p>
    </section>
  );
}

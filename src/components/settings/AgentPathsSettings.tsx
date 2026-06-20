import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderOpen, FolderSymlink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AgentManagerDialog } from "@/components/settings/AgentManagerDialog";
import { Button } from "@/components/ui/button";
import {
  getVisibleAgentsOrDefault,
  mergeAgentOrder,
  useAgentOrder,
  useVisibleAgents,
} from "@/hooks/useSettings";
import { skillsApi } from "@/lib/api/skills";
import type { AgentPathInfo } from "@/types/skills";

const EMPTY_AGENT_ORDER: string[] = [];
const SUMMARY_LIMIT = 5;

function PathDetails({ info }: { info: AgentPathInfo }) {
  const { t } = useTranslation();
  return (
    <div className="min-w-0 space-y-1" data-selectable>
      <div className="flex items-center gap-2">
        <p className="truncate text-sm font-medium leading-none">{info.label}</p>
        <span className="shrink-0 text-[10px] leading-none text-muted-foreground/60">
          {info.exists ? t("settings.agentPaths.created") : t("settings.agentPaths.notFound")}
        </span>
      </div>
      <p className="truncate font-mono text-xs text-muted-foreground">{info.path}</p>
    </div>
  );
}

function PathRow({ info, storage = false }: { info: AgentPathInfo; storage?: boolean }) {
  const { t } = useTranslation();
  const Icon = storage ? FolderSymlink : FolderOpen;
  return (
    <div
      className={
        storage ? "flex items-center gap-3 px-4 py-3" : "flex items-center gap-3 px-4 py-2.5"
      }
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border">
        <Icon className={storage ? "h-4 w-4 text-primary" : "h-4 w-4 text-muted-foreground"} />
      </div>
      <div className="min-w-0 flex-1">
        <PathDetails info={info} />
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="h-8 shrink-0 gap-1.5 px-2 text-xs"
        onClick={() => skillsApi.openSkillsDir(info.agent)}
        disabled={!info.exists}
        aria-label={t("settings.agentPaths.openAgent", { agent: info.label })}
      >
        <FolderOpen className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{t("settings.agentPaths.open")}</span>
      </Button>
    </div>
  );
}

export function AgentPathsSettings() {
  const { t } = useTranslation();
  const [managerOpen, setManagerOpen] = useState(false);
  const managerTriggerRef = useRef<HTMLButtonElement>(null);
  const { data: paths = [] } = useQuery({
    queryKey: ["agentPaths"],
    queryFn: () => skillsApi.getAgentPaths(),
  });
  const { data: visibleAgentsData } = useVisibleAgents();
  const { data: agentOrder = EMPTY_AGENT_ORDER } = useAgentOrder();
  const visibleAgents = getVisibleAgentsOrDefault(visibleAgentsData);
  const ssotPath = paths.find((info) => info.agent === "ssot");
  const agentPaths = paths.filter((info) => info.agent !== "ssot");
  const pathById = new Map(agentPaths.map((info) => [info.agent, info]));
  const orderedIds = mergeAgentOrder(
    agentOrder,
    agentPaths.map((info) => info.agent),
  );
  const visibleInfos = orderedIds
    .filter((agent) => visibleAgents[agent] !== false)
    .map((agent) => pathById.get(agent))
    .filter((info): info is AgentPathInfo => Boolean(info));
  const summaryInfos = visibleInfos.slice(0, SUMMARY_LIMIT);
  const remainingCount = Math.max(0, visibleInfos.length - SUMMARY_LIMIT);

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 border-b border-border/40 pb-2">
        <FolderOpen className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-medium">{t("settings.agentPaths.title")}</h3>
      </div>
      <p className="text-xs text-muted-foreground">{t("settings.agentPaths.summaryDescription")}</p>

      {ssotPath && (
        <div className="overflow-hidden rounded-xl border border-border bg-primary/5">
          <PathRow info={ssotPath} storage />
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card/50">
        {summaryInfos.map((info, index) => (
          <div key={info.agent} className={index > 0 ? "border-t border-border/40" : undefined}>
            <PathRow info={info} />
          </div>
        ))}
        {remainingCount > 0 && (
          <p className="border-t border-border/40 px-4 py-2 text-center text-[11px] text-muted-foreground">
            {t("settings.agentPaths.remaining", { count: remainingCount })}
          </p>
        )}
        <div className="border-t border-border/40 p-2">
          <Button
            ref={managerTriggerRef}
            variant="ghost"
            size="sm"
            className="w-full text-xs"
            onClick={() => setManagerOpen(true)}
          >
            {t("settings.agentPaths.manage")}
          </Button>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground/70">{t("settings.agentPaths.hiddenHint")}</p>

      <AgentManagerDialog
        open={managerOpen}
        onOpenChange={setManagerOpen}
        returnFocusRef={managerTriggerRef}
        paths={paths}
        visibleAgents={visibleAgents}
        agentOrder={agentOrder}
      />
    </section>
  );
}

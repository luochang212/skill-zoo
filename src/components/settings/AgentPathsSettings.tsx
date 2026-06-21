import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Reorder, useDragControls } from "framer-motion";
import { FolderOpen, FolderSymlink, GripVertical, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AgentManagerDialog } from "@/components/settings/AgentManagerDialog";
import { Button } from "@/components/ui/button";
import {
  getVisibleAgentsOrDefault,
  mergeAgentOrder,
  useAgentOrder,
  useAgentPreferences,
  useVisibleAgents,
} from "@/hooks/useSettings";
import { skillsApi } from "@/lib/api/skills";
import type { AgentPathInfo } from "@/types/skills";

const EMPTY_AGENT_ORDER: string[] = [];

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
    <div className="flex items-center gap-3 p-4">
      <div className="w-7 shrink-0" aria-hidden="true" />
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

function DraggablePathRow({
  info,
  disabled,
  onDragEnd,
}: {
  info: AgentPathInfo;
  disabled: boolean;
  onDragEnd: () => void;
}) {
  const { t } = useTranslation();
  const dragControls = useDragControls();
  return (
    <Reorder.Item
      as="div"
      value={info.agent}
      dragListener={false}
      dragControls={dragControls}
      onDragEnd={onDragEnd}
      className="flex list-none items-center gap-3 border-b border-border/40 bg-background p-4 last:border-b-0"
    >
      <button
        type="button"
        onPointerDown={(event) => !disabled && dragControls.start(event)}
        disabled={disabled}
        className="flex h-8 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/55 hover:bg-accent hover:text-muted-foreground active:cursor-grabbing disabled:cursor-default disabled:opacity-40"
        aria-label={t("settings.agentPaths.reorder", { agent: info.label })}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border">
        <FolderOpen className="h-4 w-4 text-muted-foreground" />
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
    </Reorder.Item>
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
  const agentPaths = useMemo(() => paths.filter((info) => info.agent !== "ssot"), [paths]);
  const pathById = useMemo(
    () => new Map(agentPaths.map((info) => [info.agent, info])),
    [agentPaths],
  );
  const knownAgents = useMemo(() => agentPaths.map((info) => info.agent), [agentPaths]);
  const orderedIds = useMemo(
    () => mergeAgentOrder(agentOrder, knownAgents),
    [agentOrder, knownAgents],
  );
  const visibleAgentIds = useMemo(
    () => orderedIds.filter((agent) => visibleAgents[agent] !== false),
    [orderedIds, visibleAgents],
  );
  const { commitOrder, isPending } = useAgentPreferences({
    visibleAgents,
    agentOrder,
    knownAgents,
  });
  const [localOrder, setLocalOrder] = useState<string[]>(visibleAgentIds);
  const localOrderRef = useRef(visibleAgentIds);
  useEffect(() => {
    setLocalOrder(visibleAgentIds);
    localOrderRef.current = visibleAgentIds;
  }, [visibleAgentIds]);
  const handleDragEnd = () => {
    if (isPending) return;
    commitOrder(localOrderRef.current);
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 border-b border-border/40 pb-2">
        <FolderOpen className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-medium">{t("settings.agentPaths.title")}</h3>
      </div>
      <p className="text-xs text-muted-foreground">{t("settings.agentPaths.summaryDescription")}</p>

      <div className="overflow-hidden rounded-xl border border-border bg-card/50">
        {ssotPath && (
          <div className="bg-primary/5">
            <PathRow info={ssotPath} storage />
          </div>
        )}
        <Reorder.Group
          as="div"
          axis="y"
          values={localOrder}
          onReorder={(next) => {
            setLocalOrder(next);
            localOrderRef.current = next;
          }}
          className={ssotPath ? "border-t border-border/40" : undefined}
        >
          {localOrder.map((agent) => {
            const info = pathById.get(agent);
            if (!info) return null;
            return (
              <DraggablePathRow
                key={agent}
                info={info}
                disabled={isPending}
                onDragEnd={handleDragEnd}
              />
            );
          })}
        </Reorder.Group>
        <div className="border-t border-border/40 p-2">
          <Button
            ref={managerTriggerRef}
            variant="outline"
            size="sm"
            className="w-full gap-2"
            onClick={() => setManagerOpen(true)}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
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

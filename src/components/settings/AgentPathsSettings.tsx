import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Reorder, useDragControls } from "framer-motion";
import { FolderOpen, FolderSymlink, GripVertical } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { skillsApi } from "@/lib/api/skills";
import {
  mergeAgentOrder,
  useAgentOrder,
  useVisibleAgents,
  useUpdateAgentOrder,
  useUpdateVisibleAgents,
  getVisibleAgentsOrDefault,
} from "@/hooks/useSettings";
import type { AgentPathInfo, VisibleAgents } from "@/types/skills";

function sortAgentsByOrder(agents: AgentPathInfo[], agentOrder: string[]): AgentPathInfo[] {
  return mergeAgentOrder(
    agentOrder,
    agents.map((info) => info.agent),
  )
    .map((agent) => agents.find((info) => info.agent === agent))
    .filter((info): info is AgentPathInfo => Boolean(info));
}

function getAgentOrder(paths: AgentPathInfo[] | undefined, agentOrder: string[]): string[] {
  const agents = paths?.filter((info) => info.agent !== "ssot") ?? [];
  return sortAgentsByOrder(agents, agentOrder).map((info) => info.agent);
}

function PathRow({
  info,
  isVisible,
  onToggleVisibility,
  canToggle,
  isDragging,
  onStartDrag,
}: {
  info: AgentPathInfo;
  isVisible: boolean;
  onToggleVisibility: () => void;
  canToggle: boolean;
  isDragging: boolean;
  onStartDrag?: (event: React.PointerEvent<HTMLButtonElement>) => void;
}) {
  const { t } = useTranslation();
  const isSsot = info.agent === "ssot";
  const Icon = isSsot ? FolderSymlink : FolderOpen;
  const rowTone = isSsot ? "border-border bg-primary/5" : "border-border bg-card/50";

  const handleOpen = () => {
    skillsApi.openSkillsDir(info.agent);
  };

  return (
    <div
      className={`flex items-center justify-between rounded-xl border p-4 transition-all ${rowTone} ${
        !isVisible && !isSsot ? "opacity-50" : ""
      } ${isDragging ? "opacity-60" : ""}`}
    >
      <div className="flex items-center gap-3 min-w-0">
        {!isSsot ? (
          <button
            type="button"
            onPointerDown={onStartDrag}
            className="flex h-7 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/45 hover:bg-accent hover:text-muted-foreground active:cursor-grabbing"
            aria-label={t("settings.agentPaths.reorder", { agent: info.label })}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        ) : (
          <div className="h-7 w-5 shrink-0" />
        )}

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
          <div className="inline-flex h-[24px] w-[44px] shrink-0" />
        )}

        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border">
          <Icon className={`h-4 w-4 ${isSsot ? "text-primary" : "text-muted-foreground"}`} />
        </div>

        <div className="min-w-0 space-y-0.5" data-selectable>
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

function SortablePathRow({
  info,
  isVisible,
  onToggleVisibility,
  canToggle,
  onSaveOrder,
}: {
  info: AgentPathInfo;
  isVisible: boolean;
  onToggleVisibility: () => void;
  canToggle: boolean;
  onSaveOrder: () => void;
}) {
  const dragControls = useDragControls();
  const [isDragging, setIsDragging] = useState(false);

  return (
    <Reorder.Item
      as="div"
      value={info.agent}
      dragListener={false}
      dragControls={dragControls}
      onDragStart={() => setIsDragging(true)}
      onDragEnd={() => {
        setIsDragging(false);
        onSaveOrder();
      }}
      className="list-none"
    >
      <PathRow
        info={info}
        isVisible={isVisible}
        onToggleVisibility={onToggleVisibility}
        canToggle={canToggle}
        isDragging={isDragging}
        onStartDrag={(event) => dragControls.start(event)}
      />
    </Reorder.Item>
  );
}

export function AgentPathsSettings() {
  const { t } = useTranslation();
  const [orderedAgents, setOrderedAgents] = useState<string[]>([]);
  const currentOrderRef = useRef<string[]>([]);
  const { data: paths } = useQuery({
    queryKey: ["agentPaths"],
    queryFn: () => skillsApi.getAgentPaths(),
  });
  const { data: visibleAgentsData } = useVisibleAgents();
  const { data: agentOrder = [] } = useAgentOrder();
  const updateVisibleAgents = useUpdateVisibleAgents();
  const updateAgentOrder = useUpdateAgentOrder();

  const visibleAgents = getVisibleAgentsOrDefault(visibleAgentsData);
  const ssotPaths = paths?.filter((info) => info.agent === "ssot") ?? [];
  const agentPaths = paths?.filter((info) => info.agent !== "ssot") ?? [];
  const agentPathById = new Map(agentPaths.map((info) => [info.agent, info]));

  const visibleCount = Object.values(visibleAgents).filter(Boolean).length;

  useEffect(() => {
    const nextOrder = getAgentOrder(paths, agentOrder);
    setOrderedAgents(nextOrder);
    currentOrderRef.current = nextOrder;
  }, [paths, agentOrder]);

  const handleToggleVisibility = (agent: string) => {
    const currentVisible = visibleAgents[agent] !== false;
    // Prevent hiding the last visible agent
    if (currentVisible && visibleCount <= 1) return;

    const updated: VisibleAgents = { ...visibleAgents, [agent]: !currentVisible };
    updateVisibleAgents.mutate(updated);
  };

  const handleReorder = (nextOrder: string[]) => {
    setOrderedAgents(nextOrder);
    currentOrderRef.current = nextOrder;
  };

  const handleSaveOrder = () => {
    updateAgentOrder.mutate(currentOrderRef.current);
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 pb-2 border-b border-border/40">
        <FolderOpen className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-medium">{t("settings.agentPaths.title")}</h3>
      </div>

      <p className="text-xs text-muted-foreground">{t("settings.agentPaths.description")}</p>

      <div className="space-y-3">
        {ssotPaths.map((info) => (
          <PathRow
            key={info.agent}
            info={info}
            isVisible
            onToggleVisibility={() => {}}
            canToggle={false}
            isDragging={false}
          />
        ))}

        <Reorder.Group
          as="div"
          axis="y"
          values={orderedAgents}
          onReorder={handleReorder}
          className="space-y-3"
        >
          {orderedAgents.map((agent) => {
            const info = agentPathById.get(agent);
            if (!info) return null;

            const isVisible = visibleAgents[info.agent] !== false;
            const canToggle = !(isVisible && visibleCount <= 1);

            return (
              <SortablePathRow
                key={info.agent}
                info={info}
                isVisible={isVisible}
                onToggleVisibility={() => handleToggleVisibility(info.agent)}
                canToggle={canToggle}
                onSaveOrder={handleSaveOrder}
              />
            );
          })}
        </Reorder.Group>
      </div>

      <p className="text-[11px] text-muted-foreground/70">{t("settings.agentPaths.hiddenHint")}</p>
    </section>
  );
}

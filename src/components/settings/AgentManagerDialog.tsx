import { useEffect, useMemo, useRef, useState } from "react";
import { Reorder, useDragControls, type PanInfo } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  FolderOpen,
  GripVertical,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { skillsApi } from "@/lib/api/skills";
import { normalizeAgentOrder, useUpdateAgentPreferences } from "@/hooks/useSettings";
import type { AgentPathInfo, VisibleAgents } from "@/types/skills";

function AgentPathDetails({ info }: { info: AgentPathInfo }) {
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

function OpenPathButton({ info }: { info: AgentPathInfo }) {
  const { t } = useTranslation();
  return (
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
  );
}

function ManageAgentRow({
  info,
  isVisible,
  canToggle,
  disabled,
  onToggle,
}: {
  info: AgentPathInfo;
  isVisible: boolean;
  canToggle: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-14 items-center gap-3 border-b border-border/40 px-4 py-2 last:border-b-0">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/60">
        <FolderOpen className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <AgentPathDetails info={info} />
      </div>
      <OpenPathButton info={info} />
      <Switch
        checked={isVisible}
        onCheckedChange={onToggle}
        disabled={disabled || !canToggle}
        aria-label={t("settings.agentPaths.toggleVisibility", { agent: info.label })}
        className="shrink-0"
      />
    </div>
  );
}

type MoveDirection = "first" | "up" | "down" | "last";

function SortableAgentRow({
  info,
  index,
  count,
  disabled,
  onDragStart,
  onDrag,
  onDragEnd,
  onMove,
}: {
  info: AgentPathInfo;
  index: number;
  count: number;
  disabled: boolean;
  onDragStart: () => void;
  onDrag: (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => void;
  onDragEnd: (event: MouseEvent | TouchEvent | PointerEvent) => void;
  onMove: (direction: MoveDirection) => void;
}) {
  const { t } = useTranslation();
  const dragControls = useDragControls();
  const atStart = index === 0;
  const atEnd = index === count - 1;

  return (
    <Reorder.Item
      as="div"
      value={info.agent}
      dragListener={false}
      dragControls={dragControls}
      onDragStart={onDragStart}
      onDrag={onDrag}
      onDragEnd={onDragEnd}
      className="flex min-h-12 list-none items-center gap-2 border-b border-border/40 bg-background px-3 last:border-b-0"
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
      <span className="w-6 shrink-0 text-right font-mono text-xs text-muted-foreground">
        {index + 1}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{info.label}</span>
      <div className="flex shrink-0 items-center gap-0.5">
        <SortButton
          label={t("settings.agentPaths.moveFirst", { agent: info.label })}
          disabled={disabled || atStart}
          onClick={() => onMove("first")}
        >
          <ChevronsUp className="h-3.5 w-3.5" />
        </SortButton>
        <SortButton
          label={t("settings.agentPaths.moveUp", { agent: info.label })}
          disabled={disabled || atStart}
          onClick={() => onMove("up")}
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </SortButton>
        <SortButton
          label={t("settings.agentPaths.moveDown", { agent: info.label })}
          disabled={disabled || atEnd}
          onClick={() => onMove("down")}
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </SortButton>
        <SortButton
          label={t("settings.agentPaths.moveLast", { agent: info.label })}
          disabled={disabled || atEnd}
          onClick={() => onMove("last")}
        >
          <ChevronsDown className="h-3.5 w-3.5" />
        </SortButton>
      </div>
    </Reorder.Item>
  );
}

function SortButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-25"
    >
      {children}
    </button>
  );
}

export function AgentManagerDialog({
  open,
  onOpenChange,
  returnFocusRef,
  paths,
  visibleAgents,
  agentOrder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
  paths: AgentPathInfo[];
  visibleAgents: VisibleAgents;
  agentOrder: string[];
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"manage" | "sort">("manage");
  const [query, setQuery] = useState("");
  const [hiddenExpanded, setHiddenExpanded] = useState(false);
  const [draftOrder, setDraftOrder] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartOrderRef = useRef<string[]>([]);
  const draftOrderRef = useRef<string[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const scrollDirectionRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const updatePreferences = useUpdateAgentPreferences();
  const agentPaths = useMemo(() => paths.filter((info) => info.agent !== "ssot"), [paths]);
  const pathById = useMemo(
    () => new Map(agentPaths.map((info) => [info.agent, info])),
    [agentPaths],
  );
  const knownAgents = useMemo(() => agentPaths.map((info) => info.agent), [agentPaths]);
  const normalizedOrder = useMemo(
    () => normalizeAgentOrder(agentOrder, knownAgents, visibleAgents),
    [agentOrder, knownAgents, visibleAgents],
  );

  useEffect(() => {
    setDraftOrder(normalizedOrder);
    draftOrderRef.current = normalizedOrder;
  }, [normalizedOrder]);

  useEffect(() => {
    if (!open) {
      setMode("manage");
      setQuery("");
      setHiddenExpanded(false);
    }
  }, [open]);

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    },
    [],
  );

  const stopAutoScroll = () => {
    scrollDirectionRef.current = 0;
    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    }
  };

  const runAutoScroll = () => {
    const list = listRef.current;
    if (!list || scrollDirectionRef.current === 0) {
      scrollFrameRef.current = null;
      return;
    }
    list.scrollTop += scrollDirectionRef.current * 8;
    scrollFrameRef.current = requestAnimationFrame(runAutoScroll);
  };

  const updateAutoScroll = (pointerY: number) => {
    const list = listRef.current;
    if (!list) return;
    const bounds = list.getBoundingClientRect();
    const edge = 44;
    const nextDirection =
      pointerY < bounds.top + edge ? -1 : pointerY > bounds.bottom - edge ? 1 : 0;
    scrollDirectionRef.current = nextDirection;
    if (nextDirection !== 0 && scrollFrameRef.current === null) {
      scrollFrameRef.current = requestAnimationFrame(runAutoScroll);
    } else if (nextDirection === 0) {
      stopAutoScroll();
    }
  };

  const savePreferences = (nextVisible: VisibleAgents, nextOrder: string[]) => {
    updatePreferences.mutate(
      { visibleAgents: nextVisible, agentOrder: nextOrder },
      { onError: () => toast.error(t("settings.agentPaths.saveFailed")) },
    );
  };

  const visibleOrder = draftOrder.filter((agent) => visibleAgents[agent] !== false);
  const hiddenOrder = draftOrder.filter((agent) => visibleAgents[agent] === false);

  const handleToggle = (agent: string) => {
    if (updatePreferences.isPending) return;
    const isVisible = visibleAgents[agent] !== false;
    if (isVisible && visibleOrder.length <= 1) {
      toast.warning(t("settings.agentPaths.minOneWarning"));
      return;
    }

    const nextVisible = { ...visibleAgents, [agent]: !isVisible };
    const withoutAgent = draftOrder.filter((id) => id !== agent);
    if (isVisible) {
      withoutAgent.push(agent);
    } else {
      const firstHidden = withoutAgent.findIndex((id) => nextVisible[id] === false);
      withoutAgent.splice(firstHidden === -1 ? withoutAgent.length : firstHidden, 0, agent);
    }
    const nextOrder = normalizeAgentOrder(withoutAgent, knownAgents, nextVisible);
    savePreferences(nextVisible, nextOrder);
  };

  const commitOrder = (nextOrder: string[]) => {
    if (updatePreferences.isPending) return;
    savePreferences(visibleAgents, nextOrder);
  };

  const handleMove = (agent: string, direction: MoveDirection) => {
    const nextVisibleOrder = [...visibleOrder];
    const index = nextVisibleOrder.indexOf(agent);
    if (index === -1) return;
    nextVisibleOrder.splice(index, 1);
    const target =
      direction === "first"
        ? 0
        : direction === "last"
          ? nextVisibleOrder.length
          : direction === "up"
            ? Math.max(0, index - 1)
            : Math.min(nextVisibleOrder.length, index + 1);
    nextVisibleOrder.splice(target, 0, agent);
    commitOrder([...nextVisibleOrder, ...hiddenOrder]);
  };

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchesQuery = (info: AgentPathInfo) =>
    !normalizedQuery ||
    info.label.toLocaleLowerCase().includes(normalizedQuery) ||
    info.agent.toLocaleLowerCase().includes(normalizedQuery) ||
    info.path.toLocaleLowerCase().includes(normalizedQuery);
  const visibleInfos = visibleOrder
    .map((agent) => pathById.get(agent))
    .filter((info): info is AgentPathInfo => Boolean(info))
    .filter(matchesQuery);
  const hiddenInfos = hiddenOrder
    .map((agent) => pathById.get(agent))
    .filter((info): info is AgentPathInfo => Boolean(info))
    .filter(matchesQuery);
  const showHiddenRows = Boolean(normalizedQuery) || hiddenExpanded;
  const noResults = visibleInfos.length === 0 && hiddenInfos.length === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => !updatePreferences.isPending && onOpenChange(nextOpen)}
    >
      <DialogContent
        closeDisabled={updatePreferences.isPending}
        onPointerDownOutside={(event) => updatePreferences.isPending && event.preventDefault()}
        onEscapeKeyDown={(event) => updatePreferences.isPending && event.preventDefault()}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
        className="flex h-[min(720px,calc(100vh-2rem))] w-[calc(100vw-2rem)] max-w-[760px] flex-col gap-0 overflow-hidden p-0 sm:rounded-xl"
        data-selectable
      >
        <DialogHeader className="shrink-0 border-b border-border/50 px-5 py-4 pr-12 text-left">
          <DialogTitle>{t("settings.agentPaths.manageTitle")}</DialogTitle>
          <DialogDescription>{t("settings.agentPaths.manageDescription")}</DialogDescription>
        </DialogHeader>

        {mode === "manage" ? (
          <>
            <div className="flex shrink-0 items-center gap-3 border-b border-border/40 px-4 py-3">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("settings.agentPaths.searchPlaceholder")}
                  className="h-9 pl-9"
                />
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {t("settings.agentPaths.visibleCount", {
                  visible: visibleOrder.length,
                  total: agentPaths.length,
                })}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-9 shrink-0 gap-1.5"
                onClick={() => {
                  setQuery("");
                  setMode("sort");
                }}
                disabled={updatePreferences.isPending}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {t("settings.agentPaths.sort")}
              </Button>
            </div>

            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {noResults ? (
                <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
                  {t("settings.agentPaths.noResults")}
                </div>
              ) : (
                <>
                  {visibleInfos.length > 0 && (
                    <div>
                      <div className="sticky top-0 z-10 bg-muted/95 px-4 py-2 text-xs font-medium text-muted-foreground backdrop-blur">
                        {t("settings.agentPaths.visibleGroup", { count: visibleInfos.length })}
                      </div>
                      {visibleInfos.map((info) => (
                        <ManageAgentRow
                          key={info.agent}
                          info={info}
                          isVisible
                          canToggle={visibleOrder.length > 1}
                          disabled={updatePreferences.isPending}
                          onToggle={() => handleToggle(info.agent)}
                        />
                      ))}
                    </div>
                  )}

                  {hiddenInfos.length > 0 && (
                    <div>
                      <button
                        type="button"
                        className="sticky top-0 z-10 flex w-full items-center gap-2 bg-muted/95 px-4 py-2 text-left text-xs font-medium text-muted-foreground backdrop-blur hover:text-foreground"
                        onClick={() => setHiddenExpanded((expanded) => !expanded)}
                        aria-expanded={showHiddenRows}
                      >
                        {showHiddenRows ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                        {t("settings.agentPaths.hiddenGroup", { count: hiddenInfos.length })}
                      </button>
                      {showHiddenRows &&
                        hiddenInfos.map((info) => (
                          <ManageAgentRow
                            key={info.agent}
                            info={info}
                            isVisible={false}
                            canToggle
                            disabled={updatePreferences.isPending}
                            onToggle={() => handleToggle(info.agent)}
                          />
                        ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="shrink-0 border-b border-border/40 px-5 py-3">
              <p className="text-sm font-medium">{t("settings.agentPaths.sortTitle")}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("settings.agentPaths.sortDescription")}
              </p>
            </div>
            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <Reorder.Group
                as="div"
                axis="y"
                values={visibleOrder}
                onReorder={(nextVisibleOrder) => {
                  const nextOrder = [...nextVisibleOrder, ...hiddenOrder];
                  setDraftOrder(nextOrder);
                  draftOrderRef.current = nextOrder;
                }}
                layoutScroll
              >
                {visibleOrder.map((agent, index) => {
                  const info = pathById.get(agent);
                  if (!info) return null;
                  return (
                    <SortableAgentRow
                      key={agent}
                      info={info}
                      index={index}
                      count={visibleOrder.length}
                      disabled={updatePreferences.isPending}
                      onDragStart={() => {
                        dragStartOrderRef.current = draftOrderRef.current;
                        setIsDragging(true);
                      }}
                      onDrag={(_event, panInfo) => updateAutoScroll(panInfo.point.y)}
                      onDragEnd={(event) => {
                        stopAutoScroll();
                        setIsDragging(false);
                        if (event.type === "pointercancel") {
                          setDraftOrder(dragStartOrderRef.current);
                          draftOrderRef.current = dragStartOrderRef.current;
                          return;
                        }
                        commitOrder(draftOrderRef.current);
                      }}
                      onMove={(direction) => handleMove(agent, direction)}
                    />
                  );
                })}
              </Reorder.Group>
            </div>
          </>
        )}

        <DialogFooter className="shrink-0 flex-row justify-end space-x-2 border-t border-border/50 px-5 py-3">
          {mode === "sort" ? (
            <Button
              size="sm"
              onClick={() => setMode("manage")}
              disabled={updatePreferences.isPending || isDragging}
            >
              {t("settings.agentPaths.finishSorting")}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={updatePreferences.isPending}
            >
              {t("settings.agentPaths.done")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

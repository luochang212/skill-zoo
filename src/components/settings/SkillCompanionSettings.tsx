import { Reorder, useDragControls } from "framer-motion";
import { domToPng } from "modern-screenshot";
import {
  Activity,
  BarChart3,
  Camera,
  Check,
  Copy,
  GripVertical,
  Loader2,
  PenLine,
  Plus,
  Settings,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useSaveSkillCompanionItems,
  useSkillCompanionItems,
  useSkillUsage,
  useSkillUsageAgent,
  useUpdateSkillUsageAgent,
} from "@/hooks/useSettings";
import { settingsApi } from "@/lib/api/settings";
import { useAgentConfigs, getAgentLabel } from "@/lib/agents";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DailyCount, SkillCompanionItem, SkillUsagePeriod } from "@/types/skills";

function createItemId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `companion-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function newItem(): SkillCompanionItem {
  return {
    id: createItemId(),
    content: "",
  };
}

function reorderItems(items: SkillCompanionItem[], nextOrder: string[]) {
  const itemById = new Map(items.map((item) => [item.id, item]));
  return nextOrder
    .map((id) => itemById.get(id))
    .filter((item): item is SkillCompanionItem => Boolean(item));
}

function normalizePreview(content: string) {
  return content.split(/\s+/).filter(Boolean).join(" ");
}

type UsageRange = "week" | "month";

const USAGE_RANGES: UsageRange[] = ["week", "month"];

function formatUsageShare(count: number, total: number) {
  if (total <= 0) return "0.0%";
  const share = count / total;
  return new Intl.NumberFormat(undefined, {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(share);
}

function formatCompactDate(date: Date) {
  return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;
}

function usageDateRange(dayCount: number) {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(end.getDate() - Math.max(dayCount - 1, 0));
  return {
    start: formatCompactDate(start),
    end: formatCompactDate(end),
  };
}

function DailyChart({ breakdown }: { breakdown: DailyCount[] }) {
  const max = breakdown.reduce((value, d) => Math.max(value, d.count), 0) || 1;
  const n = breakdown.length;
  const gapPct = Math.max(0.8, Math.min(6, 32 / n));
  const radius = n > 16 ? 1 : 3;

  return (
    <div className="relative pt-2">
      <div
        className="relative w-full"
        style={{ height: 96, display: "flex", alignItems: "flex-end", gap: `${gapPct}%` }}
      >
        {[0.25, 0.5, 0.75, 1].map((g, i) => (
          <div
            key={i}
            className="absolute left-0 right-0 border-t border-border/40"
            style={{ bottom: `${g * 100}%` }}
          />
        ))}
        {breakdown.map((d) => (
          <div
            key={d.date}
            className="flex-1 flex flex-col justify-end min-w-0 self-stretch"
            title={`${d.date}  ${d.count} call(s)`}
          >
            <div
              className="w-full bg-emerald-500/70 hover:bg-emerald-500 transition-colors duration-150"
              style={{
                height: d.count > 0 ? `${Math.max(1, (d.count / max) * 100)}%` : "0%",
                borderRadius: `${radius}px ${radius}px 0 0`,
              }}
            />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: `${gapPct}%`, marginTop: 6 }}>
        {breakdown.map((d) => (
          <div
            key={d.date}
            className="flex-1 text-center font-mono text-[9px] text-muted-foreground whitespace-nowrap"
          >
            {d.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function SkillUsageBars({
  period,
  compact = false,
  agentDisplayName,
}: {
  period: SkillUsagePeriod | undefined;
  compact?: boolean;
  agentDisplayName: string;
}) {
  const { t } = useTranslation();
  const skills = period?.skills ?? [];
  const shown = compact ? skills.slice(0, 3) : skills;
  const max = shown.reduce((value, skill) => Math.max(value, skill.count), 0) || 1;
  const total = period?.totalCalls ?? 0;

  if (shown.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("settings.skillCompanion.usageEmpty", { agent: agentDisplayName })}
      </p>
    );
  }

  return (
    <div className="space-y-2 font-mono text-[11px]">
      {shown.map((skill) => (
        <div
          key={skill.name}
          className="grid grid-cols-[minmax(0,9rem)_1fr_3ch_5ch] items-center gap-3 group cursor-default"
          title={`${skill.name}: ${skill.count} (${formatUsageShare(skill.count, total)})`}
        >
          <span className="truncate text-foreground">{skill.name}</span>
          <div className="h-1.5 overflow-hidden rounded-full bg-border/60">
            <div
              className="h-full rounded-full bg-emerald-500 group-hover:bg-emerald-400 transition-colors duration-150"
              style={{ width: `${(skill.count / max) * 100}%` }}
            />
          </div>
          <span className="text-right tabular-nums font-medium text-muted-foreground">
            {skill.count}
          </span>
          <span className="text-right tabular-nums text-muted-foreground/60">
            {formatUsageShare(skill.count, total)}
          </span>
        </div>
      ))}
    </div>
  );
}

function SkillUsageSummaryTiles({
  period,
  installedSkillCount,
  rangeLabel,
  agentDisplayName,
}: {
  period: SkillUsagePeriod | undefined;
  installedSkillCount: number;
  rangeLabel: string;
  agentDisplayName: string;
}) {
  const { t } = useTranslation();
  const totalCalls = period?.totalCalls ?? 0;
  const activeSkills = period?.skills.length ?? 0;
  const topSkill = period?.skills[0];
  const topShare = topSkill ? formatUsageShare(topSkill.count, totalCalls) : null;

  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
      <div className="min-w-0 rounded-lg border border-border bg-muted/30 px-3.5 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/65">
          {t("settings.skillCompanion.usageStats.active")}
        </p>
        <p className="mt-1 font-mono text-2xl font-semibold leading-none tracking-tight tabular-nums">
          {activeSkills}
        </p>
        <p className="mt-1 truncate text-[11px] text-muted-foreground">
          {installedSkillCount > 0
            ? t("settings.skillCompanion.usageStats.installed", {
                count: installedSkillCount,
                agent: agentDisplayName,
              })
            : t("settings.skillCompanion.usageStats.noInstalled", { agent: agentDisplayName })}
        </p>
      </div>
      <div className="min-w-0 rounded-lg border border-border bg-muted/30 px-3.5 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/65">
          {t("settings.skillCompanion.usageStats.total")}
        </p>
        <p className="mt-1 font-mono text-2xl font-semibold leading-none tracking-tight tabular-nums">
          {totalCalls}
        </p>
        <p className="mt-1 truncate text-[11px] text-muted-foreground">{rangeLabel}</p>
      </div>
      <div className="min-w-0 rounded-lg border border-border bg-muted/30 px-3.5 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/65">
          {t("settings.skillCompanion.usageStats.focus")}
        </p>
        <p className="mt-1 truncate font-mono text-xl font-semibold leading-none tracking-tight">
          {topShare ?? t("settings.skillCompanion.usageStats.none")}
        </p>
        <p className="mt-1 truncate text-[11px] text-muted-foreground">
          {topSkill
            ? t("settings.skillCompanion.usageStats.focusDetail", {
                name: topSkill.name,
              })
            : t("settings.skillCompanion.usageStats.focusEmpty")}
        </p>
      </div>
    </div>
  );
}

function SkillUsageDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { data: persistedAgent } = useSkillUsageAgent();
  const updateAgent = useUpdateSkillUsageAgent();
  const { data: agentConfigs } = useAgentConfigs();
  const usageAgents = useMemo(
    () => (agentConfigs ?? []).filter((a) => a.hasUsageTracking),
    [agentConfigs],
  );
  const agent = useMemo(() => {
    const match = usageAgents.find((a) => a.id === persistedAgent);
    return match?.id ?? usageAgents[0]?.id ?? "claude-code";
  }, [persistedAgent, usageAgents]);
  const agentDisplayName = getAgentLabel(agent, usageAgents);
  const { data: usage, isLoading } = useSkillUsage(agent, { enabled: open });
  const captureRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<UsageRange>("week");
  const [isCapturing, setIsCapturing] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownOpenRef = useRef(false);
  // Tracks whether the dropdown was open at the moment of the last pointerdown.
  // The Dialog defers its outside-click detection to the `click` event
  // (deferPointerDownOutside), but the DropdownMenu closes immediately on
  // `pointerdown`. By the time the Dialog checks, the dropdown is already
  // closed, so we capture the state here to bridge that timing gap.
  const dropdownOpenAtPointerDownRef = useRef(false);

  const handleDropdownOpenChange = useCallback((nextOpen: boolean) => {
    dropdownOpenRef.current = nextOpen;
    setDropdownOpen(nextOpen);
  }, []);

  // Capture-phase listener fires before any DismissableLayer bubble-phase
  // handlers, so we record the dropdown state before it gets cleared.
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = () => {
      dropdownOpenAtPointerDownRef.current = dropdownOpenRef.current;
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [open]);

  const handleDialogOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && dropdownOpenAtPointerDownRef.current) {
        dropdownOpenAtPointerDownRef.current = false;
        return;
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange],
  );
  const period = usage?.[range];
  const rangeLabel = t(`settings.skillCompanion.usageRanges.${range}`);
  const activeSkillCount = period?.skills.length ?? 0;
  const periodDays = period?.dailyBreakdown.length ?? 0;
  const dateRange = usageDateRange(periodDays);

  const saveScreenshot = async () => {
    if (isCapturing) return;
    const dialog = captureRef.current;
    if (!dialog) {
      toast.error(t("settings.skillCompanion.screenshotFailed"));
      return;
    }
    // Capture the inner content wrapper (natural auto-height), not the dialog's
    // fixed viewport — the dialog shell is overflow:hidden at 640px, so skills
    // past the fold would otherwise be clipped. Using the inner wrapper avoids
    // flex-inflated scrollHeight when content is shorter than the dialog.
    const target =
      dialog.querySelector<HTMLElement>("[data-screenshot-content]") ??
      dialog.querySelector<HTMLElement>("[data-screenshot-scroll]") ??
      dialog;
    setIsCapturing(true);
    try {
      const dataUrl = await domToPng(target, {
        scale: 2,
        backgroundColor: getComputedStyle(dialog).backgroundColor,
        width: target.scrollWidth,
        height: target.scrollHeight,
        filter: (node) =>
          !(node instanceof HTMLElement && node.closest("[data-screenshot-exclude]")),
      });
      await settingsApi.saveSkillUsageScreenshot(dataUrl);
      toast.success(t("settings.skillCompanion.screenshotSaved"));
    } catch {
      toast.error(t("settings.skillCompanion.screenshotFailed"));
    } finally {
      setIsCapturing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent
        ref={captureRef}
        className="flex h-[min(640px,calc(100vh-6rem))] w-[calc(100vw-2rem)] max-w-[560px] flex-col gap-0 overflow-hidden p-0 sm:rounded-xl"
        data-selectable
        onPointerDownOutside={(event) => {
          if (dropdownOpenAtPointerDownRef.current) {
            event.preventDefault();
            dropdownOpenAtPointerDownRef.current = false;
          }
        }}
        onEscapeKeyDown={(event) => {
          if (dropdownOpen) event.preventDefault();
        }}
      >
        <DialogHeader className="shrink-0 border-b border-border/50 px-4 py-4 text-left">
          <DialogTitle>{t("settings.skillCompanion.usageTitle")}</DialogTitle>
          <DialogDescription>
            {t("settings.skillCompanion.usageDescription", { agent: agentDisplayName })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex shrink-0 items-center gap-3 border-b border-border/40 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-1 rounded-md bg-muted/60 p-1">
            {USAGE_RANGES.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setRange(item)}
                className={cn(
                  "flex h-8 flex-1 items-center justify-center gap-1.5 rounded px-2 text-xs font-medium transition-colors",
                  range === item
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground",
                )}
              >
                {t(`settings.skillCompanion.usageRanges.${item}`)}
              </button>
            ))}
          </div>
          <DropdownMenu open={dropdownOpen} onOpenChange={handleDropdownOpenChange}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-8 w-8 shrink-0"
                aria-label={t("settings.skillCompanion.usageAgentSelect")}
                title={t("settings.skillCompanion.usageAgentSelect")}
                data-screenshot-exclude
              >
                <Settings className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {usageAgents.map((a) => (
                <DropdownMenuItem key={a.id} onSelect={() => updateAgent.mutate(a.id)}>
                  <Check
                    className={cn("h-3.5 w-3.5", agent === a.id ? "opacity-100" : "opacity-0")}
                  />
                  {a.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-8 w-8 shrink-0"
            disabled={isCapturing}
            onClick={saveScreenshot}
            aria-label={t("settings.skillCompanion.screenshotSave")}
            title={t("settings.skillCompanion.screenshotSave")}
            data-screenshot-exclude
          >
            {isCapturing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Camera className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
        <div data-screenshot-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div data-screenshot-content className="p-4 space-y-4">
            {isLoading ? (
              <>
                <div className="grid grid-cols-3 gap-2.5">
                  <Skeleton className="h-24 rounded-lg" />
                  <Skeleton className="h-24 rounded-lg" />
                  <Skeleton className="h-24 rounded-lg" />
                </div>
                <Skeleton className="h-32 w-full rounded-lg" />
                <div className="h-px bg-border/20 mx-0 my-2.5" />
                <Skeleton className="h-3 w-20 rounded" />
                <div className="space-y-3 py-1">
                  {[82, 60, 45, 32, 18].map((width, i) => (
                    <div
                      key={i}
                      className="grid grid-cols-[minmax(0,9rem)_1fr_3ch_5ch] items-center gap-3"
                    >
                      <Skeleton className="h-3 w-20 rounded" />
                      <Skeleton className="h-3 rounded-full" style={{ width: `${width}%` }} />
                      <Skeleton className="h-3 rounded" />
                      <Skeleton className="h-3 rounded" />
                    </div>
                  ))}
                </div>
                <Skeleton className="h-3 w-2/3 rounded" />
              </>
            ) : (
              <>
                <SkillUsageSummaryTiles
                  period={period}
                  installedSkillCount={usage?.installedSkillCount ?? 0}
                  rangeLabel={rangeLabel}
                  agentDisplayName={agentDisplayName}
                />
                {period && period.dailyBreakdown.length > 0 && (
                  <>
                    <DailyChart breakdown={period.dailyBreakdown} />
                    <div className="h-px bg-border/20 mx-0 my-2.5" />
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                      {t("settings.skillCompanion.usageRanking")}
                    </p>
                  </>
                )}
                <SkillUsageBars period={period} agentDisplayName={agentDisplayName} />
                <p className="border-t border-border/30 pt-3 text-[11px] leading-5 text-muted-foreground">
                  {/* Intentional non-i18n metadata label for a compact product signature. */}
                  {`▸ Skill preferences · ${activeSkillCount} skills · ${dateRange.start} ~ ${dateRange.end}`}
                </p>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SkillUsageSettingsCard() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="group flex items-center justify-between gap-4 rounded-xl border border-border bg-card/50 p-4 transition-colors hover:bg-muted/50">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border">
            <BarChart3 className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-medium leading-none">
              {t("settings.skillCompanion.usageTitle")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("settings.skillCompanion.usageHint")}
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 shrink-0 gap-1.5 text-xs"
          onClick={() => setOpen(true)}
        >
          <BarChart3 className="h-3.5 w-3.5" />
          {t("settings.skillCompanion.usageView")}
        </Button>
      </div>
      <SkillUsageDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function SkillCompanionRow({
  item,
  index,
  disabled,
  isEditing,
  onBeginEdit,
  onUpdate,
  onSave,
  onDelete,
  onDragEnd,
}: {
  item: SkillCompanionItem;
  index: number;
  disabled: boolean;
  isEditing: boolean;
  onBeginEdit: () => void;
  onUpdate: (content: string) => void;
  onSave: () => void;
  onDelete: () => void;
  onDragEnd: () => void;
}) {
  const { t } = useTranslation();
  const dragControls = useDragControls();
  const invalid = item.content.trim().length === 0;
  const preview = normalizePreview(item.content) || t("settings.skillCompanion.emptyPreview");

  return (
    <Reorder.Item
      as="div"
      value={item.id}
      dragListener={false}
      dragControls={dragControls}
      layout="position"
      onDragEnd={onDragEnd}
      className={cn(
        "flex list-none items-start gap-2 border-b border-border/40 bg-background px-4 transition-[min-height,padding] duration-200 ease-out last:border-b-0",
        isEditing ? "min-h-[5.5rem] py-3" : "min-h-11 py-2",
      )}
    >
      <button
        type="button"
        onPointerDown={(event) => !disabled && dragControls.start(event)}
        disabled={disabled || isEditing}
        className="flex h-7 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/55 hover:bg-accent hover:text-muted-foreground active:cursor-grabbing disabled:cursor-default disabled:opacity-40"
        aria-label={t("settings.skillCompanion.reorder", { index: index + 1 })}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">
        {isEditing ? (
          <div className="space-y-1.5">
            <textarea
              value={item.content}
              onChange={(event) => onUpdate(event.target.value)}
              placeholder={t("settings.skillCompanion.contentPlaceholder")}
              disabled={disabled}
              aria-label={t("settings.skillCompanion.itemContent", { index: index + 1 })}
              className={cn(
                "h-16 max-h-16 w-full resize-none overflow-y-auto rounded-md border border-input bg-background px-3 py-2 text-sm leading-5 ring-offset-background transition-colors placeholder:text-muted-foreground focus-visible:border-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
                invalid && "border-destructive/60",
              )}
            />
            {invalid ? (
              <p className="text-xs text-destructive">{t("settings.skillCompanion.validation")}</p>
            ) : null}
          </div>
        ) : (
          <p className="truncate py-1 text-sm leading-5 text-foreground">{preview}</p>
        )}
      </div>
      <div className="flex w-7 shrink-0 flex-col gap-1">
        {isEditing ? (
          <>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              disabled={disabled || invalid}
              onClick={onSave}
              aria-label={t("settings.skillCompanion.saveItem", { index: index + 1 })}
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              disabled={disabled}
              onClick={onDelete}
              aria-label={t("settings.skillCompanion.delete", { index: index + 1 })}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        ) : (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            disabled={disabled}
            onClick={onBeginEdit}
            aria-label={t("settings.skillCompanion.edit", { index: index + 1 })}
          >
            <PenLine className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </Reorder.Item>
  );
}

function SkillCompanionManagerDialog({
  open,
  onOpenChange,
  returnFocusRef,
  savedItems,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
  savedItems: SkillCompanionItem[];
}) {
  const { t } = useTranslation();
  const saveItems = useSaveSkillCompanionItems();
  const [items, setItems] = useState<SkillCompanionItem[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const itemsRef = useRef<SkillCompanionItem[]>([]);

  useEffect(() => {
    if (open) {
      setItems(savedItems);
      setEditingId(null);
    }
  }, [open, savedItems]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const itemOrder = useMemo(() => items.map((item) => item.id), [items]);
  const busy = saveItems.isPending;

  const saveList = (
    nextItems: SkillCompanionItem[],
    onSuccess?: () => void,
    onError?: () => void,
  ) => {
    saveItems.mutate(nextItems, {
      onSuccess: () => {
        onSuccess?.();
      },
      onError: () => {
        onError?.();
      },
    });
  };

  const beginEdit = (item: SkillCompanionItem) => {
    setEditingId(item.id);
  };

  const updateItem = (id: string, content: string) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, content } : item)));
  };

  const saveItem = (item: SkillCompanionItem) => {
    if (item.content.trim().length === 0) {
      toast.error(t("settings.skillCompanion.validation"));
      return;
    }
    saveList(itemsRef.current, () => {
      setEditingId((current) => (current === item.id ? null : current));
    });
  };

  const deleteItem = (id: string) => {
    const previousItems = items;
    const previousEditingId = editingId;
    const nextItems = items.filter((item) => item.id !== id);
    setItems(nextItems);
    if (editingId === id) {
      setEditingId(null);
    }
    saveList(nextItems, undefined, () => {
      setItems(previousItems);
      setEditingId(previousEditingId);
    });
  };

  const addItem = () => {
    const item = newItem();
    setItems((current) => [...current, item]);
    setEditingId(item.id);
  };

  const saveOrder = () => {
    if (editingId !== null) return;
    if (JSON.stringify(itemsRef.current) === JSON.stringify(savedItems)) return;
    saveList(itemsRef.current, undefined, () => setItems(savedItems));
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !busy && onOpenChange(nextOpen)}>
      <DialogContent
        closeDisabled={busy}
        onPointerDownOutside={(event) => busy && event.preventDefault()}
        onEscapeKeyDown={(event) => busy && event.preventDefault()}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
        className="flex h-[min(720px,calc(100vh-6rem))] w-[calc(100vw-2rem)] max-w-[640px] flex-col gap-0 overflow-hidden p-0 sm:rounded-xl"
        data-selectable
      >
        <DialogHeader className="shrink-0 border-b border-border/50 px-4 py-4 text-left">
          <DialogTitle>{t("settings.skillCompanion.manageTitle")}</DialogTitle>
          <DialogDescription>{t("settings.skillCompanion.manageDescription")}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {items.length === 0 ? (
            <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
              {t("settings.skillCompanion.empty")}
            </div>
          ) : (
            <Reorder.Group
              as="div"
              axis="y"
              values={itemOrder}
              onReorder={(nextOrder) =>
                setItems((current) => {
                  const next = reorderItems(current, nextOrder);
                  itemsRef.current = next;
                  return next;
                })
              }
              layoutScroll
            >
              {items.map((item, index) => (
                <SkillCompanionRow
                  key={item.id}
                  item={item}
                  index={index}
                  disabled={busy || (editingId !== null && editingId !== item.id)}
                  isEditing={editingId === item.id}
                  onBeginEdit={() => beginEdit(item)}
                  onUpdate={(content) => updateItem(item.id, content)}
                  onSave={() => saveItem(item)}
                  onDelete={() => deleteItem(item.id)}
                  onDragEnd={saveOrder}
                />
              ))}
            </Reorder.Group>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/40 p-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={busy || editingId !== null}
            onClick={addItem}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("settings.skillCompanion.add")}
          </Button>
          {editingId ? (
            <p className="text-xs text-muted-foreground">
              {t("settings.skillCompanion.editingHint")}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const EMPTY_ITEMS: SkillCompanionItem[] = [];

export function SkillCompanionSettings({
  openManagerRequest = 0,
  onOpenManagerRequestHandled,
}: {
  openManagerRequest?: number;
  onOpenManagerRequestHandled?: () => void;
}) {
  const { t } = useTranslation();
  const { data: savedItems = EMPTY_ITEMS, isLoading } = useSkillCompanionItems();
  const [managerOpen, setManagerOpen] = useState(false);
  const managerTriggerRef = useRef<HTMLButtonElement>(null);
  const handledOpenManagerRequest = useRef(0);

  useEffect(() => {
    if (openManagerRequest === 0 || openManagerRequest === handledOpenManagerRequest.current)
      return;
    handledOpenManagerRequest.current = openManagerRequest;
    setManagerOpen(true);
    onOpenManagerRequestHandled?.();
  }, [onOpenManagerRequestHandled, openManagerRequest]);

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 border-b border-border/40 pb-2">
        <Activity className="h-4 w-4 text-emerald-500" />
        <h3 className="text-sm font-medium">{t("settings.skillCompanion.title")}</h3>
      </div>
      <div className="group flex items-center justify-between gap-4 rounded-xl border border-border bg-card/50 p-4 transition-colors hover:bg-muted/50">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border">
            <Copy className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium leading-none">
              {t("settings.skillCompanion.summary")}
            </p>
            <p className="text-xs text-muted-foreground">
              {isLoading
                ? t("common.loading")
                : t("settings.skillCompanion.summaryDescription", { count: savedItems.length })}
            </p>
          </div>
        </div>
        <Button
          ref={managerTriggerRef}
          type="button"
          size="sm"
          variant="outline"
          className="h-8 shrink-0 gap-1.5 text-xs"
          onClick={() => setManagerOpen(true)}
        >
          <Settings className="h-3.5 w-3.5" />
          {t("settings.skillCompanion.manage")}
        </Button>
      </div>

      <SkillUsageSettingsCard />

      <SkillCompanionManagerDialog
        open={managerOpen}
        onOpenChange={setManagerOpen}
        returnFocusRef={managerTriggerRef}
        savedItems={savedItems}
      />
    </section>
  );
}

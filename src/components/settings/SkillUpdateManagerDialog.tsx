import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { CheckCircle2, Clock3, History, RefreshCw, Trash2, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useClearSkillUpdateHistory,
  useDeleteSkillUpdateHistoryRecord,
  useSkillUpdateHistory,
} from "@/hooks/useSkills";
import { formatApiError } from "@/lib/api/errors";
import type { CheckedSkillUpdate, SkillUpdateHistoryRecord } from "@/lib/api/skills";
import { cn } from "@/lib/utils";

export interface SkillUpdateCandidate extends CheckedSkillUpdate {
  repo: string;
}

interface SkillUpdateManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  updates: SkillUpdateCandidate[];
  isChecking: boolean;
  isUpdating: boolean;
  onCheckUpdates: () => void;
  onUpdate: (updates: SkillUpdateCandidate[]) => void;
}

type Tab = "updates" | "history";

function shortSha(sha: string) {
  return sha.slice(0, 7);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function historyStatusVariant(status: SkillUpdateHistoryRecord["status"]) {
  if (status === "failed") return "destructive";
  if (status === "partial") return "outline";
  return "secondary";
}

function statusIcon(status: SkillUpdateHistoryRecord["status"]) {
  if (status === "failed") return <XCircle className="h-4 w-4 text-destructive" />;
  if (status === "noop") return <Clock3 className="h-4 w-4 text-muted-foreground" />;
  return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
}

export function SkillUpdateManagerDialog({
  open,
  onOpenChange,
  returnFocusRef,
  updates,
  isChecking,
  isUpdating,
  onCheckUpdates,
  onUpdate,
}: SkillUpdateManagerDialogProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("updates");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const historyQuery = useSkillUpdateHistory(open);
  const deleteHistory = useDeleteSkillUpdateHistoryRecord();
  const clearHistory = useClearSkillUpdateHistory();
  const history = historyQuery.data ?? [];
  const historyBusy = deleteHistory.isPending || clearHistory.isPending;
  const busy = isUpdating || historyBusy;

  useEffect(() => {
    if (!open) return;
    setSelected(new Set(updates.map((update) => update.skillName)));
  }, [open, updates]);

  const selectedUpdates = useMemo(
    () => updates.filter((update) => selected.has(update.skillName)),
    [selected, updates],
  );
  const allSelected = updates.length > 0 && selectedUpdates.length === updates.length;

  const setAllSelected = (checked: boolean) => {
    setSelected(checked ? new Set(updates.map((update) => update.skillName)) : new Set());
  };

  const toggleSelected = (skillName: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(skillName);
      } else {
        next.delete(skillName);
      }
      return next;
    });
  };

  const handleDeleteHistory = (id: string) => {
    deleteHistory.mutate(id, {
      onError: (error) => toast.error(formatApiError(error)),
    });
  };

  const handleClearHistory = () => {
    clearHistory.mutate(undefined, {
      onError: (error) => toast.error(formatApiError(error)),
    });
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
          <DialogTitle>{t("settings.maintenance.updateManagerTitle")}</DialogTitle>
          <DialogDescription>{t("settings.maintenance.updateManagerDesc")}</DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 items-center gap-3 border-b border-border/40 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-1 rounded-md bg-muted/60 p-1">
            <button
              type="button"
              className={cn(
                "flex h-8 flex-1 items-center justify-center gap-1.5 rounded px-2 text-xs font-medium transition-colors",
                tab === "updates" ? "bg-background shadow-sm" : "text-muted-foreground",
              )}
              onClick={() => setTab("updates")}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t("settings.maintenance.availableUpdatesTab", { count: updates.length })}
            </button>
            <button
              type="button"
              className={cn(
                "flex h-8 flex-1 items-center justify-center gap-1.5 rounded px-2 text-xs font-medium transition-colors",
                tab === "history" ? "bg-background shadow-sm" : "text-muted-foreground",
              )}
              onClick={() => setTab("history")}
            >
              <History className="h-3.5 w-3.5" />
              {t("settings.maintenance.updateHistoryTab", { count: history.length })}
            </button>
          </div>
          {tab === "updates" ? (
            <Button
              size="sm"
              variant="outline"
              className="h-8 shrink-0 gap-1.5 text-xs"
              onClick={onCheckUpdates}
              disabled={isChecking || isUpdating}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isChecking && "animate-spin")} />
              {isChecking
                ? t("settings.maintenance.checkingBtn")
                : t("settings.maintenance.checkUpdateBtn")}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-8 shrink-0 gap-1.5 text-xs"
              onClick={handleClearHistory}
              disabled={history.length === 0 || historyBusy}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("settings.maintenance.clearHistory")}
            </Button>
          )}
        </div>

        {tab === "updates" ? (
          <>
            <div className="flex shrink-0 items-center justify-between border-b border-border/40 px-4 py-2.5">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(checked) => setAllSelected(Boolean(checked))}
                  disabled={updates.length === 0 || isUpdating}
                  aria-label={t("settings.maintenance.selectAllUpdates")}
                />
                {t("settings.maintenance.selectedUpdates", {
                  selected: selectedUpdates.length,
                  total: updates.length,
                })}
              </label>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => onUpdate(selectedUpdates)}
                  disabled={selectedUpdates.length === 0 || isUpdating}
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", isUpdating && "animate-spin")} />
                  {t("settings.maintenance.updateSelected")}
                </Button>
              </div>
            </div>
            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {updates.length === 0 ? (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                  {t("settings.maintenance.noAvailableUpdates")}
                </div>
              ) : (
                updates.map((update) => (
                  <div
                    key={update.skillName}
                    className="flex min-h-16 items-center gap-3 border-b border-border/40 px-4 py-3 last:border-b-0"
                  >
                    <Checkbox
                      checked={selected.has(update.skillName)}
                      onCheckedChange={(checked) =>
                        toggleSelected(update.skillName, Boolean(checked))
                      }
                      disabled={isUpdating}
                      aria-label={t("settings.maintenance.selectUpdate", {
                        skill: update.skillName,
                      })}
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium leading-none">
                          {update.skillName}
                        </p>
                        <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[10px]">
                          {update.repo}
                        </Badge>
                      </div>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {shortSha(update.currentSha)} -&gt; {shortSha(update.latestSha)}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {historyQuery.isLoading ? (
              <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
                {t("settings.maintenance.loadingHistory")}
              </div>
            ) : history.length === 0 ? (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                {t("settings.maintenance.noUpdateHistory")}
              </div>
            ) : (
              history.map((record) => (
                <HistoryRow
                  key={record.id}
                  record={record}
                  disabled={historyBusy}
                  onDelete={() => handleDeleteHistory(record.id)}
                />
              ))
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function HistoryRow({
  record,
  disabled,
  onDelete,
}: {
  record: SkillUpdateHistoryRecord;
  disabled: boolean;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const summarySkills = [...record.updatedSkills, ...record.failedSkills];
  return (
    <div className="border-b border-border/40 px-4 py-3 last:border-b-0">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/60">
          {statusIcon(record.status)}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium leading-none">
              {t("settings.maintenance.historySummary", {
                success: record.updatedSkills.length,
                fail: record.failedSkills.length,
              })}
            </p>
            <Badge
              variant={historyStatusVariant(record.status)}
              className="h-5 shrink-0 px-1.5 text-[10px]"
            >
              {t(`settings.maintenance.historyStatus.${record.status}`)}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {formatDateTime(record.finishedAt)} ·{" "}
            {t(`settings.maintenance.historyMode.${record.mode}`, {
              defaultValue: record.mode,
            })}
          </p>
          {summarySkills.length > 0 && (
            <p className="line-clamp-2 text-xs text-muted-foreground">{summarySkills.join(", ")}</p>
          )}
          {record.errors.length > 0 && (
            <p className="line-clamp-2 text-xs text-destructive/90">
              {record.errors.map((error) => formatApiError(error)).join("; ")}
            </p>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 shrink-0 px-2"
          onClick={onDelete}
          disabled={disabled}
          aria-label={t("settings.maintenance.deleteHistoryRecord")}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

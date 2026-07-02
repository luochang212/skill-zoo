import { Reorder, useDragControls } from "framer-motion";
import { Check, Copy, GripVertical, PenLine, Plus, Settings, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { useSaveSkillCompanionItems, useSkillCompanionItems } from "@/hooks/useSettings";
import { cn } from "@/lib/utils";
import type { SkillCompanionItem } from "@/types/skills";

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
        toast.error(t("settings.skillCompanion.saveFailed"));
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
    saveList(items, () => {
      setEditingId(null);
    });
  };

  const deleteItem = (id: string) => {
    const previousItems = items;
    const previousEditingId = editingId;
    const nextItems = items.filter((item) => item.id !== id);
    setItems(nextItems);
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
              onReorder={(nextOrder) => setItems((current) => reorderItems(current, nextOrder))}
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

export function SkillCompanionSettings() {
  const { t } = useTranslation();
  const { data: savedItems = EMPTY_ITEMS, isLoading } = useSkillCompanionItems();
  const [managerOpen, setManagerOpen] = useState(false);
  const managerTriggerRef = useRef<HTMLButtonElement>(null);

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 border-b border-border/40 pb-2">
        <Copy className="h-4 w-4 text-emerald-500" />
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

      <SkillCompanionManagerDialog
        open={managerOpen}
        onOpenChange={setManagerOpen}
        returnFocusRef={managerTriggerRef}
        savedItems={savedItems}
      />
    </section>
  );
}

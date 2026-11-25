import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  items?: Array<{ id: string; name: string }>;
  hint?: string;
  confirmLabel: ReactNode;
  confirmVariant?: "default" | "destructive";
  pending?: boolean;
  onConfirm: () => void;
  className?: string;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  items,
  hint,
  confirmLabel,
  confirmVariant = "destructive",
  pending = false,
  onConfirm,
  className,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn("sm:max-w-[380px]", className)}
        data-selectable
        onEscapeKeyDown={(event) => pending && event.preventDefault()}
        onPointerDownOutside={(event) => pending && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        {items && (
          <ScrollArea className="max-h-40 border rounded-md">
            <div className="p-2 space-y-1">
              {items.map((item) => (
                <p
                  key={item.id}
                  className="text-[13px] leading-tight truncate text-muted-foreground"
                >
                  {item.name}
                </p>
              ))}
            </div>
          </ScrollArea>
        )}
        {hint && <p className="text-xs text-muted-foreground px-1">{hint}</p>}
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant={confirmVariant}
            size="sm"
            disabled={pending || items?.length === 0}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

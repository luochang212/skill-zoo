import type { ReactNode, RefObject } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface WorkbenchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  busy?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onCloseAutoFocus?: (event: Event) => void;
  className?: string;
  children: ReactNode;
}

export function WorkbenchDialog({
  open,
  onOpenChange,
  title,
  description,
  busy = false,
  returnFocusRef,
  onCloseAutoFocus,
  className,
  children,
}: WorkbenchDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!busy ? onOpenChange(nextOpen) : undefined)}>
      <DialogContent
        closeDisabled={busy}
        onPointerDownOutside={(event) => busy && event.preventDefault()}
        onEscapeKeyDown={(event) => busy && event.preventDefault()}
        onCloseAutoFocus={
          onCloseAutoFocus ??
          (returnFocusRef
            ? (event) => {
                event.preventDefault();
                returnFocusRef.current?.focus();
              }
            : undefined)
        }
        className={cn(
          "flex w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:rounded-xl",
          className,
        )}
        data-selectable
      >
        <DialogHeader className="shrink-0 border-b border-border/50 px-4 py-4 text-left">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

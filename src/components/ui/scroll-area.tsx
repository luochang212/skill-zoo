import * as React from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { cn } from "@/lib/utils";

const AUTO_HIDE_DELAY = 2000;

const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> & {
    viewportRef?: React.Ref<HTMLDivElement>;
    onScroll?: React.UIEventHandler<HTMLDivElement>;
  }
>(({ className, children, viewportRef, onScroll, ...props }, ref) => {
  const [scrollHidden, setScrollHidden] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const resetTimer = React.useCallback(() => {
    setScrollHidden(false);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setScrollHidden(true), AUTO_HIDE_DELAY);
  }, []);

  React.useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  const handleScroll = React.useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      resetTimer();
      onScroll?.(e);
    },
    [onScroll, resetTimer],
  );

  return (
    <ScrollAreaPrimitive.Root
      ref={ref}
      scrollHideDelay={0}
      className={cn("relative overflow-hidden", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        onScroll={handleScroll}
        onPointerEnter={resetTimer}
        className="h-full w-full rounded-[inherit]"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar hide={scrollHidden} />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
});
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName;

const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar> & {
    hide?: boolean;
  }
>(({ className, orientation = "vertical", hide, ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    data-scrollbar-autohide={hide ? "" : undefined}
    className={cn(
      "flex touch-none select-none transition-opacity duration-300",
      orientation === "vertical" && "h-full w-[6px]",
      orientation === "horizontal" && "h-[6px] flex-col",
      className,
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border hover:bg-muted-foreground transition-colors" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
));
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName;

export { ScrollArea, ScrollBar };

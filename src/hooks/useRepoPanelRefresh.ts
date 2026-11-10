import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
  type PointerEvent,
  type WheelEvent,
} from "react";

const PULL_THRESHOLD = 128;
const PULL_MAX = 150;
const MIN_REFRESH_MS = 700;
const FRESH_TOP_MS = 400;

export function useRepoPanelRefresh({
  viewportRef,
  onRefresh,
  disabled,
}: {
  viewportRef: RefObject<HTMLDivElement | null>;
  onRefresh: () => Promise<unknown>;
  disabled: boolean;
}) {
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const distanceRef = useRef(0);
  const pointerStart = useRef<number | null>(null);
  const busy = useRef(false);
  const mounted = useRef(false);
  const lastScrollAt = useRef(0);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const finishTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const resetPull = useCallback(() => {
    clearTimeout(wheelTimer.current);
    pointerStart.current = null;
    distanceRef.current = 0;
    setDistance(0);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(wheelTimer.current);
      clearTimeout(finishTimer.current);
    };
  }, []);

  useEffect(() => {
    if (disabled) resetPull();
  }, [disabled, resetPull]);

  const refresh = useCallback(() => {
    if (busy.current || disabled) return;
    busy.current = true;
    resetPull();
    setRefreshing(true);
    const started = Date.now();
    void (async () => {
      try {
        await onRefresh();
      } catch {
      } finally {
        if (mounted.current) {
          finishTimer.current = setTimeout(
            () => {
              busy.current = false;
              setRefreshing(false);
              resetPull();
            },
            Math.max(0, MIN_REFRESH_MS - (Date.now() - started)),
          );
        }
      }
    })();
  }, [disabled, onRefresh, resetPull]);

  const atTop = () => (viewportRef.current?.scrollTop ?? 0) <= 0;
  const pull = (next: number) => {
    distanceRef.current = Math.min(PULL_MAX, Math.max(0, next));
    setDistance(distanceRef.current);
  };

  return {
    distance: refreshing ? PULL_THRESHOLD : distance,
    progress: refreshing ? 1 : Math.min(1, distance / PULL_THRESHOLD),
    refreshing,
    refresh,
    handlers: {
      onPointerDown(event: PointerEvent) {
        if (!disabled && !busy.current && event.pointerType !== "mouse" && atTop()) {
          pointerStart.current = event.clientY;
        }
      },
      onPointerMove(event: PointerEvent) {
        if (disabled || busy.current || pointerStart.current === null) return;
        const delta = event.clientY - pointerStart.current;
        if (delta > 0) event.preventDefault();
        pull(delta * 0.42);
      },
      onPointerUp() {
        if (disabled || busy.current || pointerStart.current === null) return;
        if (distanceRef.current >= PULL_THRESHOLD) refresh();
        else resetPull();
      },
      onPointerCancel: resetPull,
      onWheel(event: WheelEvent) {
        if (disabled || busy.current || event.deltaY >= 0) return;
        const now = Date.now();
        if (!atTop()) {
          lastScrollAt.current = now;
          return;
        }
        if (now - lastScrollAt.current < FRESH_TOP_MS) return;
        event.preventDefault();
        clearTimeout(wheelTimer.current);
        pull(distanceRef.current + Math.abs(event.deltaY) * 0.1);
        if (distanceRef.current >= PULL_THRESHOLD) refresh();
        else wheelTimer.current = setTimeout(resetPull, 220);
      },
    },
  };
}

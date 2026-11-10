import { act, renderHook } from "@testing-library/react";
import type { PointerEvent, WheelEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRepoPanelRefresh } from "./useRepoPanelRefresh";

const pointer = (clientY: number) =>
  ({ clientY, pointerType: "touch", preventDefault: vi.fn() }) as unknown as PointerEvent;

function setup(onRefresh = vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined)) {
  const viewportRef = { current: { scrollTop: 0 } as HTMLDivElement };
  const hook = renderHook(
    ({ disabled }) => useRepoPanelRefresh({ viewportRef, onRefresh, disabled }),
    {
      initialProps: { disabled: false },
    },
  );
  const wheel = (deltaY: number) =>
    act(() =>
      hook.result.current.handlers.onWheel({
        deltaY,
        preventDefault: vi.fn(),
      } as unknown as WheelEvent),
    );

  return { ...hook, wheel, viewportRef, onRefresh };
}

describe("useRepoPanelRefresh", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("only accumulates upward wheel movement when the scroller rests at the top, and clears partial pulls", () => {
    const { result, wheel, viewportRef, onRefresh } = setup();
    viewportRef.current.scrollTop = 20;
    wheel(-1000);
    viewportRef.current.scrollTop = 0;
    wheel(1000);
    expect(result.current.distance).toBe(0);
    wheel(-1000);
    expect(result.current.distance).toBe(0);
    act(() => vi.advanceTimersByTime(500));
    wheel(-1000);
    expect(result.current.distance).toBe(100);
    act(() => vi.advanceTimersByTime(220));
    expect(result.current.distance).toBe(0);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("does not treat scroll momentum arriving at the top as a pull, but a fresh flick still refreshes", () => {
    const { result, wheel, viewportRef, onRefresh } = setup();
    viewportRef.current.scrollTop = 40;
    wheel(-450);
    viewportRef.current.scrollTop = 0;
    wheel(-450);
    wheel(-450);
    wheel(-450);
    expect(result.current.distance).toBe(0);
    expect(onRefresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(500));
    wheel(-1300);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(result.current.refreshing).toBe(true);
  });

  it("triggers once per gesture and holds feedback until both request and minimum time finish", async () => {
    let resolve!: () => void;
    const { result, wheel, onRefresh } = setup(
      vi.fn(
        () =>
          new Promise<void>((done) => {
            resolve = done;
          }),
      ),
    );
    wheel(-1300);
    wheel(-1300);
    act(() => result.current.refresh());
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(result.current.refreshing).toBe(true);
    act(() => vi.advanceTimersByTime(800));
    expect(result.current.refreshing).toBe(true);
    await act(async () => resolve());
    act(() => vi.runOnlyPendingTimers());
    expect(result.current.refreshing).toBe(false);
    expect(result.current.distance).toBe(0);
  });

  it("releases failed requests after 700ms and allows another refresh", async () => {
    const { result, onRefresh } = setup(
      vi.fn<() => Promise<unknown>>().mockRejectedValue(new Error("offline")),
    );
    await act(async () => result.current.refresh());
    act(() => vi.advanceTimersByTime(699));
    expect(result.current.refreshing).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.refreshing).toBe(false);
    await act(async () => result.current.refresh());
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it("refreshes touch pulls on release and resets canceled or disabled gestures", () => {
    const { result, rerender, onRefresh } = setup();
    act(() => result.current.handlers.onPointerDown(pointer(0)));
    act(() => result.current.handlers.onPointerMove(pointer(400)));
    expect(onRefresh).not.toHaveBeenCalled();
    act(() => result.current.handlers.onPointerCancel());
    act(() => result.current.handlers.onPointerUp());
    expect(onRefresh).not.toHaveBeenCalled();
    act(() => result.current.handlers.onPointerDown(pointer(0)));
    act(() => result.current.handlers.onPointerMove(pointer(400)));
    rerender({ disabled: true });
    expect(result.current.distance).toBe(0);
    act(() => result.current.handlers.onPointerUp());
    expect(onRefresh).not.toHaveBeenCalled();
    rerender({ disabled: false });
    act(() => result.current.handlers.onPointerDown(pointer(0)));
    act(() => result.current.handlers.onPointerMove(pointer(400)));
    act(() => result.current.handlers.onPointerUp());
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("clears gesture and feedback timers on unmount", async () => {
    const partial = setup();
    partial.wheel(-100);
    partial.unmount();
    expect(vi.getTimerCount()).toBe(0);
    const completed = setup();
    await act(async () => completed.result.current.refresh());
    expect(vi.getTimerCount()).toBe(1);
    completed.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not schedule feedback after an in-flight request is unmounted", async () => {
    let resolve!: () => void;
    const hook = setup(
      vi.fn(
        () =>
          new Promise<void>((done) => {
            resolve = done;
          }),
      ),
    );
    act(() => hook.result.current.refresh());
    hook.unmount();
    await act(async () => resolve());
    expect(vi.getTimerCount()).toBe(0);
  });
});

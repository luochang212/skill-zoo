import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { skeletonCount, useSkeletonCount } from "./useSkeletonCount";

describe("skeletonCount", () => {
  it("fills complete rows including the partially visible bottom row", () => {
    expect(skeletonCount(800, 600, 245, 104, 16)).toBe(18);
    expect(skeletonCount(1400, 1000, 245, 104, 16)).toBe(45);
  });
  it("keeps one column on narrow layouts and fills list height", () => {
    expect(skeletonCount(200, 600, 245, 104, 16)).toBe(6);
    expect(skeletonCount(800, 900, Infinity, 36, 0)).toBe(25);
    expect(skeletonCount(0, 0, 245, 104, 16)).toBe(1);
  });
});

it("updates the placeholder count when the container resizes and disconnects on unmount", () => {
  let resize: () => void = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  let width = 800;
  const widthSpy = vi
    .spyOn(HTMLElement.prototype, "clientWidth", "get")
    .mockImplementation(() => width);
  const heightSpy = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  try {
    const { result, unmount } = renderHook(() => {
      const state = useSkeletonCount(245, 104, 16);
      state.ref.current = document.createElement("div");
      return state;
    });
    expect(result.current.count).toBe(18);
    act(() => {
      width = 1400;
      resize();
    });
    expect(result.current.count).toBe(30);
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  } finally {
    widthSpy.mockRestore();
    heightSpy.mockRestore();
    vi.unstubAllGlobals();
  }
});

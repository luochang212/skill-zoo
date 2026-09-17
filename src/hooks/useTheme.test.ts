import { invoke } from "@tauri-apps/api/core";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme, subscribeToSystemTheme, useTheme } from "@/hooks/useTheme";

vi.mock("@tauri-apps/api/core");

/** Minimal matchMedia stub: jsdom has no matchMedia, so `?.` silently no-ops. */
function installMatchMedia(initialDark: boolean) {
  const listeners = new Set<() => void>();
  let dark = initialDark;

  const mql = {
    get matches() {
      return dark;
    },
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_type: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_type: string, cb: () => void) => listeners.delete(cb),
  };

  window.matchMedia = (() => mql) as unknown as typeof window.matchMedia;

  return {
    mql,
    listenerCount: () => listeners.size,
    changeTo(next: boolean) {
      dark = next;
      listeners.forEach((cb) => cb());
    },
  };
}

describe("applyTheme", () => {
  beforeEach(() => {
    document.documentElement.className = "";
    document.documentElement.removeAttribute("style");
    document.head.innerHTML = '<meta name="color-scheme" content="light dark" />';
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
    installMatchMedia(false);
  });

  it("applies dark without leaving a light color scheme", () => {
    applyTheme("dark");

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(document.querySelector('meta[name="color-scheme"]')).toHaveAttribute("content", "dark");
  });

  it("applies light without leaving a dark color scheme", () => {
    applyTheme("light");

    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(document.querySelector('meta[name="color-scheme"]')).toHaveAttribute("content", "light");
  });

  it("keeps both schemes available while following the system", () => {
    applyTheme("system");

    expect(document.documentElement.style.colorScheme).toBe("light dark");
    expect(document.querySelector('meta[name="color-scheme"]')).toHaveAttribute(
      "content",
      "light dark",
    );
  });
});

describe("subscribeToSystemTheme", () => {
  beforeEach(() => {
    document.documentElement.className = "";
    document.documentElement.removeAttribute("style");
    document.head.innerHTML = '<meta name="color-scheme" content="light dark" />';
    localStorage.clear();
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("follows the OS while the persisted theme is system", () => {
    const media = installMatchMedia(false);
    localStorage.setItem("theme", "system");
    const unsubscribe = subscribeToSystemTheme();

    expect(media.listenerCount()).toBe(1);
    expect(document.documentElement.classList.contains("light")).toBe(true);

    act(() => media.changeTo(true));

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    unsubscribe();
    expect(media.listenerCount()).toBe(0);
  });

  it("does not revert an explicit light choice when the OS changes", () => {
    const media = installMatchMedia(false);
    localStorage.setItem("theme", "light");
    const unsubscribe = subscribeToSystemTheme();

    act(() => media.changeTo(true));

    // The OS went dark; an explicit "light" selection must not follow it.
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    unsubscribe();
  });

  it("takes effect on a view that never mounts the settings hook", () => {
    const media = installMatchMedia(false);
    localStorage.setItem("theme", "system");
    // Deliberately no useTheme consumer: this is the regression. The old listener
    // lived in useTheme, which only the settings view mounts.
    const unsubscribe = subscribeToSystemTheme();

    act(() => media.changeTo(true));

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    unsubscribe();
  });
});

describe("useTheme view transition", () => {
  beforeEach(() => {
    document.documentElement.className = "";
    document.documentElement.removeAttribute("style");
    document.head.innerHTML = '<meta name="color-scheme" content="light dark" />';
    localStorage.clear();
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
    installMatchMedia(false);
  });

  it("has committed the new theme by the time the transition callback returns", async () => {
    const seen: string[] = [];
    const startViewTransition = vi.fn((cb: () => void) => {
      cb();
      seen.push(document.documentElement.className);
      return {
        finished: Promise.resolve(),
        ready: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
      };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    localStorage.setItem("theme", "light");
    const { result } = renderHook(() => useTheme());

    await act(async () => {
      result.current.setTheme("dark");
    });

    expect(startViewTransition).toHaveBeenCalledTimes(1);
    // The browser snapshots the "new" state right after the callback returns, so
    // the callback itself must have already written the theme to the DOM.
    expect(seen[0]).toContain("dark");
  });
});

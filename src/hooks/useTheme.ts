import { useState, useEffect, useCallback } from "react";
import { flushSync } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { settingsApi } from "@/lib/api/settings";

export type Theme = "light" | "dark" | "system";

function systemPrefersDark() {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

/** Read the persisted theme. The store is authoritative; component state is a view of it. */
function storedTheme(): Theme {
  return (localStorage.getItem("theme") as Theme | null) ?? "system";
}

export function applyTheme(theme: Theme) {
  const isDark = theme === "dark" || (theme === "system" && systemPrefersDark());
  // "system" keeps both schemes available so native controls and scrollbars follow
  // the OS; an explicit choice pins the single scheme.
  const scheme = theme === "system" ? "light dark" : isDark ? "dark" : "light";

  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.classList.toggle("light", !isDark);
  document.documentElement.style.colorScheme = scheme;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", scheme);

  // Sync native window theme so the title bar blends in on Windows.
  invoke("set_window_theme", { theme }).catch(() => {});
}

/**
 * Subscribe to OS light/dark changes for the whole app lifetime.
 *
 * This listener cannot live in `useTheme()`: that hook is mounted only by the
 * settings view, so with the default "system" theme an OS switch did nothing
 * while the user was anywhere else. The handler re-reads the persisted theme at
 * event time so it never reverts an explicit light/dark choice.
 *
 * Returns an unsubscribe function.
 */
export function subscribeToSystemTheme(): () => void {
  const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
  if (!mql) return () => {};
  // Apply once on subscribe so callers get a listener that is already in sync
  // with the persisted setting, then keep following the OS.
  if (storedTheme() === "system") applyTheme("system");
  const handler = () => {
    if (storedTheme() === "system") applyTheme("system");
  };
  mql.addEventListener("change", handler);
  return () => mql.removeEventListener("change", handler);
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(storedTheme);

  // Apply theme on mount and when it changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback(
    (newTheme: Theme, event?: React.MouseEvent) => {
      // Skip if same theme
      if (newTheme === theme) return;

      // Record click position as animation origin
      const x = event?.clientX ?? window.innerWidth / 2;
      const y = event?.clientY ?? window.innerHeight / 2;
      document.documentElement.style.setProperty("--theme-transition-x", `${x}px`);
      document.documentElement.style.setProperty("--theme-transition-y", `${y}px`);

      // Use View Transitions API if available, otherwise fall back to instant change.
      // flushSync matters: the browser snapshots the "new" state right after this
      // callback returns, so a plain setState (whose DOM write lands in a later
      // effect) let the transition capture the OLD theme and then snap.
      if (document.startViewTransition) {
        document.startViewTransition(() => {
          flushSync(() => setThemeState(newTheme));
        });
      } else {
        setThemeState(newTheme);
      }

      localStorage.setItem("theme", newTheme);
      // Persist to backend settings
      settingsApi.updateSetting("theme", newTheme).catch(console.error);
    },
    [theme],
  );

  return { theme, setTheme };
}

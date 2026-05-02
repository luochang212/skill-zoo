import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { settingsApi } from "@/lib/api/settings";

export type Theme = "light" | "dark" | "system";

export function applyTheme(theme: Theme) {
  const isDark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);

  // Sync native window theme so the title bar blends in on Windows.
  invoke("set_window_theme", { theme }).catch(() => {});
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem("theme") as Theme | null;
    return stored ?? "light";
  });

  // Apply theme on mount and when it changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Listen for system preference changes when using "system" theme
  useEffect(() => {
    if (theme !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
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

      // Use View Transitions API if available, otherwise fall back to instant change
      if (document.startViewTransition) {
        document.startViewTransition(() => {
          setThemeState(newTheme);
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

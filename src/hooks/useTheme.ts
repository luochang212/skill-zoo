import { useState, useEffect, useCallback } from "react";
import { flushSync } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { settingsApi } from "@/lib/api/settings";

export type Theme = "light" | "dark" | "system";

function systemPrefersDark() {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function storedTheme(): Theme {
  return (localStorage.getItem("theme") as Theme | null) ?? "system";
}

export function applyTheme(theme: Theme) {
  const isDark = theme === "dark" || (theme === "system" && systemPrefersDark());
  const scheme = theme === "system" ? "light dark" : isDark ? "dark" : "light";

  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.classList.toggle("light", !isDark);
  document.documentElement.style.colorScheme = scheme;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", scheme);

  invoke("set_window_theme", { theme }).catch(() => {});
}

export function subscribeToSystemTheme(): () => void {
  const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
  if (!mql) return () => {};
  if (storedTheme() === "system") applyTheme("system");
  const handler = () => {
    if (storedTheme() === "system") applyTheme("system");
  };
  mql.addEventListener("change", handler);
  return () => mql.removeEventListener("change", handler);
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(storedTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback(
    (newTheme: Theme, event?: React.MouseEvent) => {
      if (newTheme === theme) return;

      const x = event?.clientX ?? window.innerWidth / 2;
      const y = event?.clientY ?? window.innerHeight / 2;
      document.documentElement.style.setProperty("--theme-transition-x", `${x}px`);
      document.documentElement.style.setProperty("--theme-transition-y", `${y}px`);

      if (document.startViewTransition) {
        document.startViewTransition(() => {
          flushSync(() => setThemeState(newTheme));
        });
      } else {
        setThemeState(newTheme);
      }

      localStorage.setItem("theme", newTheme);
      settingsApi.updateSetting("theme", newTheme).catch(console.error);
    },
    [theme],
  );

  return { theme, setTheme };
}

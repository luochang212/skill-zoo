import { useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "repo-panel-collapsed";

function read(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) return JSON.parse(raw) as boolean;
  } catch {
    // corrupted data, fall through to default
  }
  return false; // default: expanded
}

export function useRepoPanelCollapsed() {
  const [collapsed, setCollapsed] = useState<boolean>(read);

  const toggle = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, []);

  // Persist to localStorage after state commits, not during state computation
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed));
  }, [collapsed]);

  return { collapsed, toggle } as const;
}

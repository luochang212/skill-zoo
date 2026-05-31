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
  const [rotation, setRotation] = useState(0);

  const handleToggle = useCallback(() => {
    const expanding = collapsed;
    setCollapsed((prev) => !prev);
    setRotation((r) => r + (expanding ? 360 : -360));
  }, [collapsed]);

  // Persist to localStorage after state commits, not during state computation
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed));
  }, [collapsed]);

  return { collapsed, rotation, handleToggle } as const;
}

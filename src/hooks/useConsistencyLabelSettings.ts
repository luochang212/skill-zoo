import { useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "consistency-label-visibility";
const CHANGE_EVENT = "consistency-label-changed";

interface ConsistencyLabelSettings {
  showDuplicate: boolean;
  showConflict: boolean;
  showMismatch: boolean;
}

function read(): ConsistencyLabelSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        showDuplicate: parsed.showDuplicate ?? true,
        showConflict: parsed.showConflict ?? true,
        showMismatch: parsed.showMismatch ?? true,
      };
    }
  } catch {
    // corrupted data, fall through to defaults
  }
  return { showDuplicate: true, showConflict: true, showMismatch: true };
}

function write(settings: ConsistencyLabelSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function useConsistencyLabelSettings() {
  const [settings, setSettings] = useState<ConsistencyLabelSettings>(read);

  // Sync across hook instances: when one component writes to localStorage,
  // all other instances re-read via this custom event.
  useEffect(() => {
    const handler = () => setSettings(read());
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
  }, []);

  const toggleDuplicate = useCallback(() => {
    setSettings((prev) => {
      const next = { ...prev, showDuplicate: !prev.showDuplicate };
      write(next);
      return next;
    });
  }, []);

  const toggleConflict = useCallback(() => {
    setSettings((prev) => {
      const next = { ...prev, showConflict: !prev.showConflict };
      write(next);
      return next;
    });
  }, []);

  const toggleMismatch = useCallback(() => {
    setSettings((prev) => {
      const next = { ...prev, showMismatch: !prev.showMismatch };
      write(next);
      return next;
    });
  }, []);

  return {
    showDuplicate: settings.showDuplicate,
    showConflict: settings.showConflict,
    showMismatch: settings.showMismatch,
    toggleDuplicate,
    toggleConflict,
    toggleMismatch,
  };
}

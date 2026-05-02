import { useState, useCallback } from "react";
import type { DiscoverRepo } from "@/types/skills";

const STORAGE_KEY = "recently-viewed-repos";
const MAX_ITEMS = 6;

export type RecentlyViewedEntry = DiscoverRepo & { viewedAt: number };

function load(): RecentlyViewedEntry[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored) as RecentlyViewedEntry[];
  } catch { /* ignore */ }
  return [];
}

function save(entries: RecentlyViewedEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch { /* ignore */ }
}

export function useRecentlyViewed() {
  const [items, setItems] = useState<RecentlyViewedEntry[]>(load);

  const add = useCallback((repo: DiscoverRepo) => {
    setItems((prev) => {
      const key = `${repo.owner}/${repo.name}`;
      const filtered = prev.filter(
        (e) => `${e.owner}/${e.name}` !== key,
      );
      const entry: RecentlyViewedEntry = {
        ...repo,
        viewedAt: Date.now(),
      };
      const next = [entry, ...filtered].slice(0, MAX_ITEMS);
      save(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
  }, []);

  return { items, add, clear };
}

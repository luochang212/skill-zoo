import { useState, useCallback } from "react";

export type SidebarCategory =
  | { type: "all" }
  | { type: "starred" }
  | { type: "mine" }
  | { type: "consistency" }
  | { type: "repo"; owner: string; name: string };

export function useSidebarFilter() {
  const [category, setCategory] = useState<SidebarCategory>({ type: "all" });

  const selectCategory = useCallback((cat: SidebarCategory) => {
    setCategory((prev) =>
      prev.type === cat.type && JSON.stringify(prev) === JSON.stringify(cat)
        ? { type: "all" }
        : cat
    );
  }, []);

  const clearFilter = useCallback(() => {
    setCategory({ type: "all" });
  }, []);

  return { category, selectCategory, clearFilter };
}

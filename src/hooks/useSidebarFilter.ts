import { useState, useCallback } from "react";

export type SidebarCategory =
  | { type: "all" }
  | { type: "starred" }
  | { type: "import" }
  | { type: "archived" }
  | { type: "mine" }
  | { type: "consistency" }
  | { type: "unassigned" }
  | { type: "repo"; owner: string; name: string };

export function useSidebarFilter() {
  const [category, setCategory] = useState<SidebarCategory>({ type: "all" });

  const selectCategory = useCallback((cat: SidebarCategory) => {
    setCategory(cat);
  }, []);

  const clearFilter = useCallback(() => {
    setCategory({ type: "all" });
  }, []);

  return { category, selectCategory, setCategory, clearFilter };
}

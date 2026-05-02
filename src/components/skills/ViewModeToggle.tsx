import { LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/utils";

export type ViewMode = "grid" | "list";

interface ViewModeToggleProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

export function ViewModeToggle({ value, onChange }: ViewModeToggleProps) {
  const other: ViewMode = value === "grid" ? "list" : "grid";

  return (
    <button
      onClick={() => onChange(other)}
      className="inline-flex items-center bg-muted rounded-lg p-1 gap-1 cursor-pointer"
    >
      <span
        className={cn(
          "p-1.5 rounded-md transition-all duration-200",
          value === "grid"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground"
        )}
      >
        <LayoutGrid className="h-3.5 w-3.5" />
      </span>
      <span
        className={cn(
          "p-1.5 rounded-md transition-all duration-200",
          value === "list"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground"
        )}
      >
        <List className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}

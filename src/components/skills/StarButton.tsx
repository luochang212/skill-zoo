import { useTranslation } from "react-i18next";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface StarButtonProps {
  starred: boolean;
  onToggle: () => void;
  className?: string;
  size?: "sm" | "default";
}

export function StarButton({ starred, onToggle, className, size = "sm" }: StarButtonProps) {
  const { t } = useTranslation();
  const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        "inline-flex items-center justify-center transition-all duration-200 shrink-0",
        size === "sm" && "h-7 w-7 rounded-md hover:bg-accent",
        size === "default" && "h-8 w-8 rounded-md hover:bg-accent",
        starred
          ? "text-amber-500 hover:text-amber-600"
          : "text-muted-foreground/70 hover:text-amber-400",
        className
      )}
      title={starred ? t("star.unstar") : t("star.star")}
    >
      <Star
        className={cn(iconSize, starred && "fill-current")}
      />
    </button>
  );
}

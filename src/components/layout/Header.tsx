import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { View } from "@/types/skills";

interface HeaderProps {
  view: View;
  onViewChange: (view: View) => void;
  hideTabs?: boolean;
  onDragMouseDown?: (e: React.MouseEvent) => void;
}

const tabKeys: { id: View; key: string }[] = [
  { id: "discover", key: "nav.discover" },
  { id: "local", key: "nav.local" },
  { id: "settings", key: "nav.settings" },
];

const LOGO_FONT = '"New York", "Iowan Old Style", "Sitka Text", Cambria, Georgia, serif';

export function Header({
  view,
  onViewChange,
  hideTabs,
  onDragMouseDown,
}: HeaderProps) {
  const { t } = useTranslation();
  const [animating, setAnimating] = useState(false);
  const [initialDone, setInitialDone] = useState(false);

  const handleLogoMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (animating || !initialDone) return;
    setAnimating(true);
  };

  return (
    <header
      className="relative border-b border-border/60 bg-background/80 backdrop-blur-sm shrink-0 select-none"
      onMouseDown={onDragMouseDown}
    >
      <div className="h-[4.5rem] px-5">
        {hideTabs ? (
          <div className="flex items-center justify-between h-full">
            <h1
              className="italic tracking-tight leading-tight shrink-0 pl-[5.25rem]"
              style={{
                fontFamily: LOGO_FONT,
              }}
            >
              <span className="font-bold text-2xl rainbow-text">Skill Zoo</span>
            </h1>
          </div>
        ) : (
          <nav className="grid grid-cols-[1fr_auto_1fr] items-center h-full">
            <div className="flex justify-start pl-[5.25rem]">
              <h1
                className="italic tracking-tight leading-tight"
                style={{
                  fontFamily: LOGO_FONT,
                }}
              >
                <span
                  className={cn(
                    "font-bold text-2xl cursor-pointer rainbow-text",
                    !initialDone && "rainbow-text-initial",
                    animating && "rainbow-text-animate",
                  )}
                  onMouseDown={handleLogoMouseDown}
                  onAnimationEnd={() => {
                    if (!initialDone) {
                      setInitialDone(true);
                    } else {
                      setAnimating(false);
                    }
                  }}
                >
                  Skill Zoo
                </span>
              </h1>
            </div>
            <div className="flex items-center justify-center">
              <div className="inline-flex items-center bg-muted rounded-lg p-1 gap-1 shadow-[inset_0_1px_3px_rgba(0,0,0,0.1)]">
                {tabKeys.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onViewChange(tab.id);
                    }}
                    className={cn(
                      "px-4 py-2 h-8 text-sm leading-none rounded-md transition-all duration-200",
                      view === tab.id
                        ? "bg-background text-foreground font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.1),0_1px_2px_rgba(0,0,0,0.06)]"
                        : "text-muted-foreground font-medium hover:text-foreground",
                    )}
                  >
                    {t(tab.key)}
                  </button>
                ))}
              </div>
            </div>
            <div />
          </nav>
        )}
      </div>
    </header>
  );
}

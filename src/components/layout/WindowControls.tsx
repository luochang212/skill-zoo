import { Minus, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { isWindowsPlatform } from "@/lib/platform";

export const captionButton = "h-8 w-9 rounded-md text-muted-foreground";

function MaximizeIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
    >
      <rect x="3.5" y="3.5" width="9" height="9" rx="1" />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
    >
      <path d="M6 3h6a1 1 0 0 1 1 1v6" />
      <rect x="3" y="6" width="7" height="7" rx="1" />
    </svg>
  );
}

function Controls() {
  const { t } = useTranslation();
  const win = useMemo(() => getCurrentWindow(), []);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    const refresh = async () => {
      const value = await win.isMaximized();
      if (alive) setMaximized(value);
    };
    void refresh();
    void win
      .onResized(() => void refresh())
      .then((off) => {
        if (alive) {
          unlisten = off;
        } else {
          off();
        }
      });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [win]);

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        className={captionButton}
        title={t("windowControls.minimize")}
        aria-label={t("windowControls.minimize")}
        onClick={() => void win.minimize()}
      >
        <Minus className="size-4" strokeWidth={1.875} aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={captionButton}
        title={t(maximized ? "windowControls.restore" : "windowControls.maximize")}
        aria-label={t(maximized ? "windowControls.restore" : "windowControls.maximize")}
        onClick={() => void win.toggleMaximize()}
      >
        {maximized ? <RestoreIcon /> : <MaximizeIcon />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={`${captionButton} hover:bg-destructive/10 hover:text-destructive dark:hover:text-red-300`}
        title={t("windowControls.close")}
        aria-label={t("windowControls.close")}
        onClick={() => void win.close()}
      >
        <X className="size-4" strokeWidth={1.875} aria-hidden="true" />
      </Button>
    </div>
  );
}

export function WindowControls() {
  if (!isWindowsPlatform()) return null;
  return <Controls />;
}

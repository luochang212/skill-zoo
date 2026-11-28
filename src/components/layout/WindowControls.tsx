import { Minus, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { isWindowsPlatform } from "@/lib/platform";

function MaximizeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
    >
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
    >
      <path d="M9 5h4c3.31 0 6 2.68 6 6v4" />
      <rect x="5" y="9" width="10" height="10" rx="2" />
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
    <div className="flex items-start gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-t-none"
        title={t("windowControls.minimize")}
        aria-label={t("windowControls.minimize")}
        onClick={() => void win.minimize()}
      >
        <Minus className="size-4" strokeWidth={1.5} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-t-none"
        title={t(maximized ? "windowControls.restore" : "windowControls.maximize")}
        aria-label={t(maximized ? "windowControls.restore" : "windowControls.maximize")}
        onClick={() => void win.toggleMaximize()}
      >
        {maximized ? <RestoreIcon /> : <MaximizeIcon />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-t-none rounded-r-none hover:bg-destructive hover:text-destructive-foreground"
        title={t("windowControls.close")}
        aria-label={t("windowControls.close")}
        onClick={() => void win.close()}
      >
        <X className="size-4" strokeWidth={1.5} />
      </Button>
    </div>
  );
}

export function WindowControls() {
  if (!isWindowsPlatform()) return null;
  return <Controls />;
}

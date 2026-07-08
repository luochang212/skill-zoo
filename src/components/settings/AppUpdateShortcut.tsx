import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useAppUpdater } from "@/hooks/useAppUpdater";

export const APP_UPDATE_SECTION_ID = "settings-app-update";

function UpdateArrowIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5 text-emerald-600/85 dark:text-emerald-400/85"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill="currentColor"
        d="M8 1.55c.3 0 .58.12.79.34l4.58 4.92c.43.47.1 1.24-.54 1.24h-2.35v5.28c0 .57-.46 1.04-1.04 1.04H6.56c-.58 0-1.04-.47-1.04-1.04V8.05H3.17c-.64 0-.97-.77-.54-1.24l4.58-4.92c.21-.22.49-.34.79-.34Z"
      />
    </svg>
  );
}

export function AppUpdateShortcut() {
  const { t } = useTranslation();
  const updater = useAppUpdater();
  const checkedRef = useRef(false);

  useEffect(() => {
    if (checkedRef.current || updater.status !== "idle") return;
    checkedRef.current = true;
    void updater.checkForUpdate({ notifyUpToDate: false, notifyError: false });
  }, [updater]);

  if (
    updater.status !== "available" &&
    updater.status !== "downloading" &&
    updater.status !== "readyToRestart" &&
    updater.status !== "error"
  ) {
    return null;
  }

  const handleClick = () => {
    document.getElementById(APP_UPDATE_SECTION_ID)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });

    switch (updater.status) {
      case "readyToRestart":
        void updater.restart();
        break;
      case "available":
      case "error":
        void updater.retryDownload();
        break;
    }
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="h-7 shrink-0 gap-1 px-1.5 text-xs font-medium text-muted-foreground shadow-none hover:bg-emerald-500/5 hover:text-foreground"
      disabled={updater.status === "downloading"}
      onClick={handleClick}
    >
      <UpdateArrowIcon />
      {t("common.update")}
    </Button>
  );
}

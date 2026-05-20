import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import type { Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Download, ExternalLink, RefreshCw, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";

const GITHUB_RELEASES = "https://github.com/luochang212/skill-zoo/releases";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type UpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "ready-to-restart"
  | "error";

export function AppUpdateSection() {
  const { t } = useTranslation();
  const [isPortable, setIsPortable] = useState<boolean | null>(null);
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [update, setUpdate] = useState<Update | null>(null);
  const [downloaded, setDownloaded] = useState(0);
  const updateRef = useRef<Update | null>(null);

  useEffect(() => {
    invoke<boolean>("is_portable_build")
      .then(setIsPortable)
      .catch(() => setIsPortable(true));
  }, []);

  const handleCheck = useCallback(async () => {
    setStatus("checking");
    try {
      const result = await check();
      if (result) {
        setUpdate(result);
        updateRef.current = result;
        setStatus("available");
      } else {
        setStatus("up-to-date");
      }
    } catch {
      setStatus("error");
    }
  }, []);

  const handleDownload = useCallback(async () => {
    if (!updateRef.current) return;
    setStatus("downloading");
    setDownloaded(0);
    try {
      await updateRef.current.downloadAndInstall((event) => {
        switch (event.event) {
          case "Progress":
            setDownloaded((prev) => prev + event.data.chunkLength);
            break;
          case "Finished":
            setStatus("ready-to-restart");
            break;
        }
      });
      setStatus("ready-to-restart");
    } catch {
      setStatus("error");
    }
  }, []);

  const handleRestart = useCallback(async () => {
    try {
      await relaunch();
    } catch {
      // relaunch failed — nothing we can do
    }
  }, []);

  if (isPortable === null) return null;

  if (isPortable) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="h-8 text-xs gap-1.5 shrink-0"
        onClick={() => openUrl(GITHUB_RELEASES)}
      >
        <ExternalLink className="h-3.5 w-3.5" />
        {t("settings.updater.openReleases")}
      </Button>
    );
  }

  const renderAction = () => {
    switch (status) {
      case "idle":
        return (
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={handleCheck}>
            <RefreshCw className="h-3.5 w-3.5" />
            {t("settings.updater.checkUpdate")}
          </Button>
        );
      case "checking":
        return (
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" disabled>
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            {t("settings.updater.checking")}
          </Button>
        );
      case "up-to-date":
        return <p className="text-xs text-muted-foreground">{t("settings.updater.upToDate")}</p>;
      case "available":
        return (
          <div className="flex items-center gap-2">
            {update && <span className="text-xs text-muted-foreground">v{update.version}</span>}
            <Button size="sm" className="h-8 text-xs gap-1.5" onClick={handleDownload}>
              <Download className="h-3.5 w-3.5" />
              {t("settings.updater.downloadInstall")}
            </Button>
          </div>
        );
      case "downloading":
        return (
          <span className="text-xs text-muted-foreground">
            {t("settings.updater.downloading")}
            {downloaded > 0 ? ` (${formatBytes(downloaded)})` : ""}
          </span>
        );
      case "ready-to-restart":
        return (
          <Button size="sm" className="h-8 text-xs gap-1.5" onClick={handleRestart}>
            <Rocket className="h-3.5 w-3.5" />
            {t("settings.updater.restartNow")}
          </Button>
        );
      case "error":
        return (
          <div className="flex items-center gap-2">
            <span className="text-xs text-destructive">{t("settings.updater.error")}</span>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5"
              onClick={handleCheck}
            >
              {t("settings.updater.retry")}
            </Button>
          </div>
        );
    }
  };

  return <>{renderAction()}</>;
}

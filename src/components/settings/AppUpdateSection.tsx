import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import type { Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Download, RefreshCw, Rocket } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const GITHUB_URL = "https://github.com/luochang212/skill-zoo";

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type UpdateStatus =
  | "idle"
  | "checking"
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
        toast.success(t("settings.updater.upToDate"));
        setStatus("idle");
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
        onClick={() => openUrl(GITHUB_URL)}
      >
        <GithubIcon className="h-3.5 w-3.5" />
        GitHub
      </Button>
    );
  }

  const updateAction = () => {
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

  return (
    <div className="flex items-center gap-2 shrink-0">
      <Button
        size="sm"
        variant="outline"
        className="h-8 text-xs gap-1.5"
        onClick={() => openUrl(GITHUB_URL)}
      >
        <GithubIcon className="h-3.5 w-3.5" />
        GitHub
      </Button>
      {updateAction()}
    </div>
  );
}

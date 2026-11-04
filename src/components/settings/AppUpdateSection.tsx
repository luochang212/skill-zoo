import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Download, Globe, RefreshCw, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GithubIcon } from "@/components/ui/github-icon";
import { useAppUpdater, type AppUpdateStatus } from "@/hooks/useAppUpdater";

const GITHUB_URL = "https://github.com/luochang212/skill-zoo";
const OFFICIAL_SITE_URL = "https://www.luochang.ink/skill-zoo/";

function WebsiteButton() {
  const { t } = useTranslation();

  return (
    <Button
      size="sm"
      variant="outline"
      className="h-8 text-xs gap-1.5 shrink-0"
      onClick={() => openUrl(OFFICIAL_SITE_URL)}
    >
      <Globe className="h-3.5 w-3.5" />
      {t("settings.about.officialSite")}
    </Button>
  );
}

function GithubButton() {
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

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function StatusLabel({
  status,
  version,
  downloaded,
}: {
  status: AppUpdateStatus;
  version: string | null;
  downloaded: number;
}) {
  const { t } = useTranslation();

  switch (status) {
    case "error":
    case "available":
      return version ? <span className="text-xs text-muted-foreground">v{version}</span> : null;
    case "downloading":
      return (
        <span className="text-xs text-muted-foreground">
          {version ? `v${version} ` : ""}
          {t("settings.updater.downloading")}
          {downloaded > 0 ? ` (${formatBytes(downloaded)})` : ""}
        </span>
      );
    default:
      return null;
  }
}

function UpdateButton({
  status,
  onCheck,
  onDownload,
  onRestart,
}: {
  status: AppUpdateStatus;
  onCheck: () => void;
  onDownload: () => void;
  onRestart: () => void;
}) {
  const { t } = useTranslation();

  switch (status) {
    case "idle":
      return (
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={onCheck}>
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
    case "error":
    case "available":
      return (
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={onDownload}>
          <Download className="h-3.5 w-3.5" />
          {t("settings.updater.downloadInstall")}
        </Button>
      );
    case "downloading":
      return (
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" disabled>
          <Download className="h-3.5 w-3.5" />
          {t("settings.updater.downloading")}
        </Button>
      );
    case "readyToRestart":
      return (
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={onRestart}>
          <Rocket className="h-3.5 w-3.5" />
          {t("settings.updater.restartNow")}
        </Button>
      );
    default:
      return null;
  }
}

export function AppUpdateSection() {
  const updater = useAppUpdater();

  if (updater.status === "loading") return null;

  if (updater.status === "unsupported") {
    return (
      <div className="flex items-center gap-2 shrink-0">
        <WebsiteButton />
        <GithubButton />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 shrink-0">
      <StatusLabel
        status={updater.status}
        version={updater.version}
        downloaded={updater.downloadedBytes}
      />
      <WebsiteButton />
      <GithubButton />
      <UpdateButton
        status={updater.status}
        onCheck={updater.checkAndDownload}
        onDownload={updater.retryDownload}
        onRestart={updater.restart}
      />
    </div>
  );
}

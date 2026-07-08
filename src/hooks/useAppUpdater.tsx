import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import type { Update } from "@tauri-apps/plugin-updater";
import { toast } from "sonner";

export type AppUpdateStatus =
  | "loading"
  | "unsupported"
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "readyToRestart"
  | "error";

type AppUpdateError = "checkFailed" | "downloadFailed" | "restartFailed" | null;

const LAST_KNOWN_UPDATE_VERSION_KEY = "skill-zoo.lastKnownUpdateVersion";

function compareVersions(left: string, right: string) {
  const leftParts = left.replace(/^v/i, "").split(/[.-]/).map(Number);
  const rightParts = right.replace(/^v/i, "").split(/[.-]/).map(Number);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = Number.isFinite(leftParts[index]) ? leftParts[index] : 0;
    const rightPart = Number.isFinite(rightParts[index]) ? rightParts[index] : 0;
    if (leftPart !== rightPart) return leftPart - rightPart;
  }

  return 0;
}

function readLastKnownUpdateVersion() {
  try {
    return localStorage.getItem(LAST_KNOWN_UPDATE_VERSION_KEY);
  } catch {
    return null;
  }
}

function writeLastKnownUpdateVersion(version: string) {
  try {
    localStorage.setItem(LAST_KNOWN_UPDATE_VERSION_KEY, version);
  } catch {
    // Cache failure should not block the update flow.
  }
}

function clearLastKnownUpdateVersion() {
  try {
    localStorage.removeItem(LAST_KNOWN_UPDATE_VERSION_KEY);
  } catch {
    // Cache failure should not block the update flow.
  }
}

interface AppUpdaterState {
  status: AppUpdateStatus;
  version: string | null;
  downloadedBytes: number;
  error: AppUpdateError;
  checkForUpdate: (options?: { notifyUpToDate?: boolean; notifyError?: boolean }) => Promise<void>;
  checkAndDownload: () => Promise<void>;
  retryDownload: () => Promise<void>;
  restart: () => Promise<void>;
}

const AppUpdaterContext = createContext<AppUpdaterState | null>(null);

export function AppUpdaterProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<AppUpdateStatus>("loading");
  const [version, setVersion] = useState<string | null>(null);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [error, setError] = useState<AppUpdateError>(null);
  const updateRef = useRef<Update | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    invoke<boolean>("is_portable_build")
      .then(async (isPortable) => {
        if (!mounted) return;

        if (isPortable) {
          setStatus("unsupported");
          return;
        }

        let currentVersion: string | null = null;
        try {
          currentVersion = await getVersion();
        } catch {
          setStatus("idle");
          return;
        }

        if (!mounted) return;

        const cachedVersion = readLastKnownUpdateVersion();
        if (cachedVersion && compareVersions(cachedVersion, currentVersion) > 0) {
          setVersion(cachedVersion);
          setStatus("available");

          check()
            .then((result) => {
              if (!mounted) return;
              if (result) {
                updateRef.current = result;
                writeLastKnownUpdateVersion(result.version);
                setVersion(result.version);
                setDownloadedBytes(0);
                setStatus("available");
              } else {
                updateRef.current = null;
                clearLastKnownUpdateVersion();
                setVersion(null);
                setDownloadedBytes(0);
                setStatus("idle");
              }
            })
            .catch(() => {
              // Keep the cached update visible when the network is unavailable.
            });
          return;
        }

        if (cachedVersion) clearLastKnownUpdateVersion();
        setStatus("idle");
      })
      .catch(() => {
        if (mounted) setStatus("unsupported");
      });

    return () => {
      mounted = false;
    };
  }, []);

  const downloadUpdate = useCallback(
    async (current: Update) => {
      setStatus("downloading");
      setError(null);
      setDownloadedBytes(0);

      try {
        await current.downloadAndInstall((event) => {
          switch (event.event) {
            case "Progress":
              setDownloadedBytes((prev) => prev + event.data.chunkLength);
              break;
            case "Finished":
              setStatus("readyToRestart");
              break;
          }
        });
        setStatus("readyToRestart");
      } catch {
        setStatus("error");
        setError("downloadFailed");
        toast.error(t("settings.updater.downloadFailed"));
      }
    },
    [t],
  );

  const checkForUpdate = useCallback(
    async ({ notifyUpToDate = true, notifyError = true } = {}) => {
      if (busyRef.current || status === "unsupported" || status === "loading") return;
      busyRef.current = true;
      setStatus("checking");
      setError(null);

      try {
        const result = await check();
        if (result) {
          updateRef.current = result;
          writeLastKnownUpdateVersion(result.version);
          setVersion(result.version);
          setDownloadedBytes(0);
          setStatus("available");
        } else {
          updateRef.current = null;
          clearLastKnownUpdateVersion();
          setVersion(null);
          setDownloadedBytes(0);
          setStatus("idle");
          if (notifyUpToDate) toast.success(t("settings.updater.upToDate"));
        }
      } catch {
        setStatus("idle");
        setError("checkFailed");
        if (notifyError) toast.error(t("settings.updater.checkFailed"));
      } finally {
        busyRef.current = false;
      }
    },
    [status, t],
  );

  const checkAndDownload = useCallback(async () => {
    if (busyRef.current || status === "unsupported" || status === "loading") return;

    if (updateRef.current) {
      busyRef.current = true;
      try {
        await downloadUpdate(updateRef.current);
      } finally {
        busyRef.current = false;
      }
      return;
    }

    busyRef.current = true;
    setStatus("checking");
    setError(null);

    try {
      const result = await check();
      if (result) {
        updateRef.current = result;
        writeLastKnownUpdateVersion(result.version);
        setVersion(result.version);
        await downloadUpdate(result);
      } else {
        updateRef.current = null;
        clearLastKnownUpdateVersion();
        setVersion(null);
        setDownloadedBytes(0);
        setStatus("idle");
        toast.success(t("settings.updater.upToDate"));
      }
    } catch {
      setStatus("idle");
      setError("checkFailed");
      toast.error(t("settings.updater.checkFailed"));
    } finally {
      busyRef.current = false;
    }
  }, [downloadUpdate, status, t]);

  const retryDownload = useCallback(async () => {
    if (busyRef.current) return;
    const current = updateRef.current;
    if (!current) {
      await checkAndDownload();
      return;
    }

    busyRef.current = true;
    try {
      await downloadUpdate(current);
    } finally {
      busyRef.current = false;
    }
  }, [checkAndDownload, downloadUpdate]);

  const restart = useCallback(async () => {
    try {
      await relaunch();
    } catch {
      setError("restartFailed");
      toast.error(t("settings.updater.restartFailed"));
    }
  }, [t]);

  const value = useMemo<AppUpdaterState>(
    () => ({
      status,
      version,
      downloadedBytes,
      error,
      checkForUpdate,
      checkAndDownload,
      retryDownload,
      restart,
    }),
    [
      checkAndDownload,
      checkForUpdate,
      downloadedBytes,
      error,
      restart,
      retryDownload,
      status,
      version,
    ],
  );

  return <AppUpdaterContext.Provider value={value}>{children}</AppUpdaterContext.Provider>;
}

export function useAppUpdater() {
  const context = useContext(AppUpdaterContext);
  if (!context) {
    throw new Error("useAppUpdater must be used within AppUpdaterProvider");
  }
  return context;
}

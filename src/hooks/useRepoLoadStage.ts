import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

export type RepoLoadStage = "downloading" | "extracting" | "scanning";

interface RepoLoadStagePayload {
  owner: string;
  repo: string;
  stage: RepoLoadStage;
}

interface RepoDownloadProgressPayload {
  owner: string;
  repo: string;
  downloaded: number;
  total: number | null;
}

interface RepoLoadDonePayload {
  owner: string;
  repo: string;
}

export interface RepoLoadState {
  stage: RepoLoadStage;
  downloaded: number;
  total: number | null;
}

/**
 * Listen for repo loading progress events for a specific repo.
 * Returns null when no loading is in progress for the given owner/name.
 * Lifecycle: null → {stage} → null (reset on repo-load-done or owner/name change)
 */
export function useRepoLoadProgress(owner: string | null, name: string | null) {
  const [state, setState] = useState<RepoLoadState | null>(null);

  useEffect(() => {
    if (!owner || !name) {
      setState(null);
      return;
    }

    let unlistenStage: (() => void) | undefined;
    let unlistenProgress: (() => void) | undefined;
    let unlistenDone: (() => void) | undefined;

    (async () => {
      unlistenStage = await listen<RepoLoadStagePayload>("repo-load-stage", (event) => {
        if (event.payload.owner === owner && event.payload.repo === name) {
          setState((prev) => ({
            stage: event.payload.stage,
            downloaded: prev?.downloaded ?? 0,
            total: prev?.total ?? null,
          }));
        }
      });

      unlistenProgress = await listen<RepoDownloadProgressPayload>(
        "repo-download-progress",
        (event) => {
          if (event.payload.owner === owner && event.payload.repo === name) {
            setState((prev) => ({
              stage: prev?.stage ?? "downloading",
              downloaded: event.payload.downloaded,
              total: event.payload.total,
            }));
          }
        },
      );

      unlistenDone = await listen<RepoLoadDonePayload>("repo-load-done", (event) => {
        if (event.payload.owner === owner && event.payload.repo === name) {
          setState(null);
        }
      });
    })();

    return () => {
      unlistenStage?.();
      unlistenProgress?.();
      unlistenDone?.();
      setState(null);
    };
  }, [owner, name]);

  return state;
}

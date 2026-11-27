import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SetStateAction,
} from "react";
import { queryOptions, useQueries, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { skillsApi } from "@/lib/api/skills";
import type { DiscoverRepo, RepoSkillsResult } from "@/types/skills";
import { RepoTasksContext } from "./repoTasksContext";

type RepoLoadStage = "downloading" | "extracting" | "scanning";
interface RepoProgress {
  stage: RepoLoadStage;
  downloaded: number;
  total: number | null;
}
interface RepoEvent {
  owner: string;
  repo: string;
  branch?: string | null;
  path?: string | null;
}
interface RepoEntry {
  repo: DiscoverRepo;
  dismissed: boolean;
  cancelled: boolean;
}

function repoRef(repo: DiscoverRepo) {
  return [repo.owner, repo.name, repo.branch || null] as const;
}

export function repoTaskKey(repo: DiscoverRepo) {
  return JSON.stringify([...repoRef(repo), repo.path || null]);
}

function queryKey(repo: DiscoverRepo) {
  return ["repos", "skills", ...repoRef(repo), repo.path || null] as const;
}

function useSessionTasks(activeRepo: DiscoverRepo | null, onOpen: (repo: DiscoverRepo) => void) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [entries, setEntries] = useState<RepoEntry[]>([]);
  const [selection, setSelection] = useState<Record<string, Set<string>>>({});
  const [progress, setProgress] = useState<Record<string, RepoProgress>>({});
  const [listening, setListening] = useState(false);
  const inFlight = useRef(new Map<string, Promise<RepoSkillsResult>>());
  const notified = useRef(new Set<string>());
  const activeKey = activeRepo ? repoTaskKey(activeRepo) : null;

  const register = useCallback((repo: DiscoverRepo) => {
    setEntries((previous) =>
      previous.some((entry) => repoTaskKey(entry.repo) === repoTaskKey(repo))
        ? previous
        : [...previous, { repo, dismissed: false, cancelled: false }],
    );
  }, []);

  const dismiss = useCallback((repo: DiscoverRepo) => {
    setEntries((previous) => {
      if (
        !previous.some((entry) => repoTaskKey(entry.repo) === repoTaskKey(repo) && !entry.dismissed)
      ) {
        return previous;
      }
      return previous.map((entry) =>
        repoTaskKey(entry.repo) === repoTaskKey(repo) ? { ...entry, dismissed: true } : entry,
      );
    });
  }, []);

  const select = useCallback((repo: DiscoverRepo, update: SetStateAction<Set<string>>) => {
    const key = JSON.stringify(repoRef(repo));
    setSelection((previous) => ({
      ...previous,
      [key]: typeof update === "function" ? update(previous[key] ?? EMPTY_SELECTION) : update,
    }));
  }, []);

  useEffect(() => {
    let disposed = false;
    const unlistens: Array<() => void> = [];
    const update = (event: RepoEvent, changes: Partial<RepoProgress>) => {
      if (disposed) return;
      const key = repoTaskKey({
        owner: event.owner,
        name: event.repo,
        branch: event.branch ?? undefined,
        path: event.path ?? undefined,
      });
      if (!inFlight.current.has(key)) return;
      setProgress((previous) => ({
        ...previous,
        [key]: { stage: "downloading", downloaded: 0, total: null, ...previous[key], ...changes },
      }));
    };
    const registerListener = async <T,>(name: string, handler: (payload: T) => void) => {
      const unlisten = await listen<T>(name, ({ payload }) => handler(payload));
      if (disposed) unlisten();
      else unlistens.push(unlisten);
    };
    void Promise.all([
      registerListener<RepoEvent & { stage: RepoLoadStage }>("repo-load-stage", (event) =>
        update(event, { stage: event.stage }),
      ),
      registerListener<RepoEvent & { downloaded: number; total: number | null }>(
        "repo-download-progress",
        (event) => update(event, { downloaded: event.downloaded, total: event.total }),
      ),
    ])
      .catch((error) => console.error("Repository progress listener failed", error))
      .finally(() => {
        if (!disposed) setListening(true);
      });
    return () => {
      disposed = true;
      unlistens.forEach((unlisten) => unlisten());
    };
  }, []);

  const load = useCallback((repo: DiscoverRepo, force = false) => {
    const key = repoTaskKey(repo);
    const pending = inFlight.current.get(key);
    if (pending) return pending;
    setProgress((previous) => ({
      ...previous,
      [key]: { stage: "downloading", downloaded: 0, total: null },
    }));
    setEntries((previous) =>
      previous.map((entry) =>
        repoTaskKey(entry.repo) === key ? { ...entry, dismissed: false, cancelled: false } : entry,
      ),
    );
    const request = skillsApi
      .getRepoSkills(repo.owner, repo.name, repo.branch || undefined, force, repo.path)
      .finally(() => inFlight.current.delete(key));
    inFlight.current.set(key, request);
    return request;
  }, []);

  const queries = useQueries({
    queries: entries.map(({ repo }) =>
      queryOptions({
        queryKey: queryKey(repo),
        queryFn: () => load(repo),
        staleTime: Infinity,
        retry: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        enabled: (query) =>
          listening &&
          query.state.status !== "error" &&
          (activeKey === repoTaskKey(repo) || query.state.data === undefined),
      }),
    ),
  });
  const tasks = entries.map((entry, index) => {
    const query = queries[index]!;
    return {
      repo: entry.repo,
      selectedKeys: selection[JSON.stringify(repoRef(entry.repo))] ?? EMPTY_SELECTION,
      dismissed: entry.dismissed,
      cancelled: entry.cancelled,
      key: repoTaskKey(entry.repo),
      query,
      progress: query.isFetching ? (progress[repoTaskKey(entry.repo)] ?? null) : null,
    };
  });

  useEffect(() => {
    for (const task of tasks) {
      if (task.query.isFetching || task.query.isPending) continue;
      if (task.query.isSuccess && task.key === activeKey) dismiss(task.repo);
      if (!task.query.isError || task.key === activeKey || task.dismissed) continue;
      const notice = `${task.key}:${task.query.errorUpdatedAt}`;
      if (notified.current.has(notice)) continue;
      notified.current.add(notice);
      toast.error(t("repoTasks.failedNotice", { repo: `${task.repo.owner}/${task.repo.name}` }));
    }
  }, [tasks, activeKey, dismiss, t]);

  const cancel = useCallback((repo: DiscoverRepo) => {
    void skillsApi
      .cancelRepoSkills(repo.owner, repo.name, repo.branch || undefined, repo.path)
      .catch(() => {});
    setEntries((previous) =>
      previous.map((entry) =>
        repoTaskKey(entry.repo) === repoTaskKey(repo)
          ? { ...entry, dismissed: true, cancelled: true }
          : entry,
      ),
    );
  }, []);

  const refresh = useCallback(
    (repo: DiscoverRepo) => {
      register(repo);
      return qc
        .fetchQuery({
          queryKey: queryKey(repo),
          queryFn: () => load(repo, true),
          staleTime: 0,
          retry: false,
        })
        .then((data) => {
          void qc.invalidateQueries({
            queryKey: ["repos", "skills", ...repoRef(repo)],
            predicate: (query) => query.queryKey[5] !== (repo.path || null),
            refetchType: "none",
          });
          void qc.invalidateQueries({ queryKey: ["repos", "metadata", repo.owner, repo.name] });
          return data;
        });
    },
    [qc, register, load],
  );

  return { tasks, register, select, dismiss, cancel, refresh, onOpen };
}

export type RepoTasksState = ReturnType<typeof useSessionTasks>;

export function RepoTasksProvider({
  children,
  activeRepo,
  onOpen,
}: {
  children: ReactNode;
  activeRepo: DiscoverRepo | null;
  onOpen: (repo: DiscoverRepo) => void;
}) {
  const value = useSessionTasks(activeRepo, onOpen);
  return <RepoTasksContext.Provider value={value}>{children}</RepoTasksContext.Provider>;
}

export function useRepoTasks() {
  const context = useContext(RepoTasksContext);
  if (!context) throw new Error("RepoTasksProvider is required");
  return context;
}

const EMPTY_SELECTION = new Set<string>();

export function useRepoTask(repo: DiscoverRepo) {
  const { tasks, register, select, refresh } = useRepoTasks();
  const key = repoTaskKey(repo);
  useEffect(() => {
    register(repo);
  }, [register, key]);
  const task = tasks.find((entry) => entry.key === key);
  return {
    data: task?.query.data,
    isLoading: task?.query.isPending ?? true,
    isFetching: task?.query.isFetching ?? true,
    isError: task?.query.isError ?? false,
    error: task?.query.error,
    progress: task?.progress ?? null,
    selectedKeys: task?.selectedKeys ?? EMPTY_SELECTION,
    setSelectedKeys: (update: SetStateAction<Set<string>>) => select(repo, update),
    refresh: () => refresh(repo),
  };
}

import "@/i18n";
import { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { skillsApi } from "@/lib/api/skills";
import { RepoTasksProvider, useRepoTasks } from "./useRepoTasks";
import type { DiscoverRepo, RepoSkillsResult } from "@/types/skills";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@/lib/api/skills", () => ({ skillsApi: { getRepoSkills: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function deferred() {
  let resolve!: (value: RepoSkillsResult) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<RepoSkillsResult>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const repo: DiscoverRepo = { owner: "owner", name: "repo" };
const data: RepoSkillsResult = { skills: [], total: 0 };
const handlers = new Map<string, (event: { payload: unknown }) => void>();

function setup(initialActive: DiscoverRepo | null = repo) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  let active = initialActive;
  let onOpen = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <RepoTasksProvider activeRepo={active} onOpen={onOpen}>
        {children}
      </RepoTasksProvider>
    </QueryClientProvider>
  );
  const hook = renderHook(() => useRepoTasks(), { wrapper });
  return {
    ...hook,
    client,
    navigate(next: DiscoverRepo | null) {
      active = next;
      hook.rerender();
    },
  };
}

describe("repository session tasks", () => {
  beforeEach(() => {
    handlers.clear();
    vi.mocked(skillsApi.getRepoSkills).mockReset();
    vi.mocked(listen)
      .mockReset()
      .mockImplementation(async (name, callback) => {
        handlers.set(name, callback as (event: { payload: unknown }) => void);
        return vi.fn<() => void>();
      });
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it("continues loading off page, retains selection, and reuses completed results", async () => {
    const request = deferred();
    vi.mocked(skillsApi.getRepoSkills).mockReturnValue(request.promise);
    const hook = setup();
    act(() => hook.result.current.register(repo));
    await waitFor(() => expect(skillsApi.getRepoSkills).toHaveBeenCalledOnce());
    act(() => hook.result.current.select(repo, new Set(["skills/example"])));
    hook.navigate(null);
    act(() =>
      handlers.get("repo-download-progress")!({
        payload: { owner: "owner", repo: "repo", branch: null, downloaded: 50, total: 100 },
      }),
    );
    expect(hook.result.current.tasks[0]?.progress).toMatchObject({ downloaded: 50, total: 100 });
    await act(async () => request.resolve(data));
    await waitFor(() => expect(hook.result.current.tasks[0]?.query.isSuccess).toBe(true));
    expect(hook.result.current.tasks[0]?.dismissed).toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
    hook.navigate(repo);
    await waitFor(() => expect(hook.result.current.tasks[0]?.dismissed).toBe(true));
    expect(hook.result.current.tasks[0]?.selectedKeys.has("skills/example")).toBe(true);
    expect(skillsApi.getRepoSkills).toHaveBeenCalledOnce();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("isolates default and named branch progress", async () => {
    vi.mocked(skillsApi.getRepoSkills).mockImplementation(() => new Promise(() => {}));
    const hook = setup();
    act(() => {
      hook.result.current.register(repo);
      hook.result.current.register({ ...repo, branch: "main" });
      hook.result.current.register({ ...repo, branch: "dev" });
    });
    await waitFor(() => expect(skillsApi.getRepoSkills).toHaveBeenCalledTimes(3));
    act(() =>
      handlers.get("repo-download-progress")!({
        payload: { owner: "owner", repo: "repo", branch: "dev", downloaded: 42, total: null },
      }),
    );
    expect(hook.result.current.tasks[2]?.progress?.downloaded).toBe(42);
    expect(hook.result.current.tasks[0]?.progress?.downloaded).toBe(0);
    expect(hook.result.current.tasks[1]?.progress?.downloaded).toBe(0);
    act(() =>
      handlers.get("repo-load-stage")!({
        payload: { owner: "owner", repo: "repo", branch: null, stage: "scanning" },
      }),
    );
    expect(hook.result.current.tasks[0]?.progress?.stage).toBe("scanning");
    expect(hook.result.current.tasks[0]?.query.isPending).toBe(true);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("does not refresh hidden completed tasks until their invalidated status is revisited", async () => {
    vi.mocked(skillsApi.getRepoSkills).mockResolvedValue(data);
    const hook = setup();
    act(() => hook.result.current.register(repo));
    await waitFor(() => expect(hook.result.current.tasks[0]?.query.isSuccess).toBe(true));
    hook.navigate(null);
    await act(async () => {
      await hook.client.invalidateQueries({ queryKey: ["repos", "skills"] });
    });
    expect(skillsApi.getRepoSkills).toHaveBeenCalledOnce();
    hook.navigate(repo);
    await waitFor(() => expect(skillsApi.getRepoSkills).toHaveBeenCalledTimes(2));
  });

  it("keeps failures until explicit retry and does not restart them on navigation", async () => {
    vi.mocked(skillsApi.getRepoSkills)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(data);
    const hook = setup(null);
    act(() => hook.result.current.register(repo));
    await waitFor(() => expect(hook.result.current.tasks[0]?.query.isError).toBe(true));
    expect(toast.error).toHaveBeenCalledOnce();
    hook.navigate(repo);
    expect(skillsApi.getRepoSkills).toHaveBeenCalledOnce();
    await act(async () => {
      await hook.result.current.refresh(repo);
    });
    await waitFor(() => expect(hook.result.current.tasks[0]?.query.isSuccess).toBe(true));
    expect(skillsApi.getRepoSkills).toHaveBeenLastCalledWith("owner", "repo", undefined, true);
  });

  it("shares IPC work when invalidation restarts an observer during a refresh", async () => {
    const request = deferred();
    vi.mocked(skillsApi.getRepoSkills).mockResolvedValueOnce(data).mockReturnValue(request.promise);
    const hook = setup();
    act(() => hook.result.current.register(repo));
    await waitFor(() => expect(hook.result.current.tasks[0]?.query.isSuccess).toBe(true));
    let refresh!: Promise<unknown>;
    act(() => {
      refresh = hook.result.current.refresh(repo).catch(() => {});
    });
    await waitFor(() => expect(skillsApi.getRepoSkills).toHaveBeenCalledTimes(2));
    let invalidation!: Promise<unknown>;
    act(() => {
      invalidation = hook.client.invalidateQueries({ queryKey: ["repos", "skills"] });
    });
    await act(async () => {
      request.resolve(data);
      await Promise.all([refresh, invalidation]);
    });
    expect(skillsApi.getRepoSkills).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(hook.result.current.tasks[0]?.query.isFetching).toBe(false));
  });

  it("waits for progress listeners and cleans late registrations after unmount", async () => {
    const resolves: Array<(unlisten: () => void) => void> = [];
    const unlistens = [vi.fn(), vi.fn()];
    vi.mocked(listen).mockImplementation(() => new Promise((resolve) => resolves.push(resolve)));
    const hook = setup();
    act(() => hook.result.current.register(repo));
    expect(skillsApi.getRepoSkills).not.toHaveBeenCalled();
    expect(listen).toHaveBeenCalledTimes(2);
    hook.unmount();
    await act(async () => {
      resolves.forEach((resolve, index) => resolve(unlistens[index]!));
      await Promise.resolve();
    });
    unlistens.forEach((unlisten) => expect(unlisten).toHaveBeenCalledOnce());
    expect(skillsApi.getRepoSkills).not.toHaveBeenCalled();
  });
});

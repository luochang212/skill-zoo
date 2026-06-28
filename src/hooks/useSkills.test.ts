import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import {
  useRepoReadme,
  useRestoreArchivedSkill,
  useStarSkill,
  useUnstarSkill,
  useUpdateAllSkills,
  useUpdateSkill,
} from "./useSkills";
import { createQueryWrapper } from "@/test/utils";
import type { InstalledSkill } from "@/types/skills";

vi.mock("@tauri-apps/api/core");

const mockSkills: InstalledSkill[] = [
  {
    id: "skill-1",
    name: "Test Skill",
    directory: "/path/to/skill-1",
    apps: { "claude-code": true },
    origin: "ssot",
    starred: false,
    isMine: false,
    installedAt: 1000,
    updatedAt: 2000,
  },
  {
    id: "skill-2",
    name: "Another Skill",
    directory: "/path/to/skill-2",
    apps: { "claude-code": true },
    origin: "ssot",
    starred: true,
    isMine: false,
    installedAt: 3000,
    updatedAt: 4000,
  },
];

describe("useStarSkill", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("optimistically updates starred to true before server responds", async () => {
    let resolveMutation!: () => void;
    vi.mocked(invoke).mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolveMutation = r;
        }),
    );
    const { wrapper, queryClient } = createQueryWrapper();

    queryClient.setQueryData(["skills", "installed"], mockSkills);

    const { result } = renderHook(() => useStarSkill(), { wrapper });
    result.current.mutate("skill-1");

    await waitFor(() => {
      const cached = queryClient.getQueryData<InstalledSkill[]>(["skills", "installed"]);
      expect(cached?.find((s) => s.id === "skill-1")?.starred).toBe(true);
    });

    resolveMutation();
  });

  it("rolls back on error", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("Failed"));
    const { wrapper, queryClient } = createQueryWrapper();

    queryClient.setQueryData(["skills", "installed"], mockSkills);

    const { result } = renderHook(() => useStarSkill(), { wrapper });
    result.current.mutate("skill-1");

    await waitFor(() => expect(result.current.isError).toBe(true));

    const cached = queryClient.getQueryData<InstalledSkill[]>(["skills", "installed"]);
    expect(cached?.find((s) => s.id === "skill-1")?.starred).toBe(false);
  });

  it("does not invalidate installed skills after a successful metadata update", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    queryClient.setQueryData(["skills", "installed"], mockSkills);

    const { result } = renderHook(() => useStarSkill(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync("skill-1");
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
    const cached = queryClient.getQueryData<InstalledSkill[]>(["skills", "installed"]);
    expect(cached?.find((s) => s.id === "skill-1")?.starred).toBe(true);
  });
});

describe("useUnstarSkill", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("optimistically updates starred to false before server responds", async () => {
    let resolveMutation!: () => void;
    vi.mocked(invoke).mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolveMutation = r;
        }),
    );
    const { wrapper, queryClient } = createQueryWrapper();

    queryClient.setQueryData(["skills", "installed"], mockSkills);

    const { result } = renderHook(() => useUnstarSkill(), { wrapper });
    result.current.mutate("skill-2");

    await waitFor(() => {
      const cached = queryClient.getQueryData<InstalledSkill[]>(["skills", "installed"]);
      expect(cached?.find((s) => s.id === "skill-2")?.starred).toBe(false);
    });

    resolveMutation();
  });

  it("rolls back on error", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("Failed"));
    const { wrapper, queryClient } = createQueryWrapper();

    queryClient.setQueryData(["skills", "installed"], mockSkills);

    const { result } = renderHook(() => useUnstarSkill(), { wrapper });
    result.current.mutate("skill-2");

    await waitFor(() => expect(result.current.isError).toBe(true));

    const cached = queryClient.getQueryData<InstalledSkill[]>(["skills", "installed"]);
    expect(cached?.find((s) => s.id === "skill-2")?.starred).toBe(true);
  });
});

describe("useRestoreArchivedSkill", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("writes the restored skill into the installed skills cache before refetch completes", async () => {
    const restoredSkill: InstalledSkill = {
      id: "skill-3",
      name: "Restored Skill",
      directory: "restored-skill",
      apps: { "claude-code": true },
      origin: "ssot",
      starred: false,
      isMine: false,
      installedAt: 5000,
      updatedAt: 6000,
    };
    vi.mocked(invoke).mockResolvedValue(restoredSkill);
    const { wrapper, queryClient } = createQueryWrapper();

    queryClient.setQueryData(["skills", "installed"], mockSkills);

    const { result } = renderHook(() => useRestoreArchivedSkill(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync("restored-skill-archive-id");
    });

    const cached = queryClient.getQueryData<InstalledSkill[]>(["skills", "installed"]);
    expect(cached?.find((s) => s.id === "skill-3")).toEqual(restoredSkill);
  });
});

describe("useUpdateSkill", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("invalidates update history even when the update fails", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("update failed"));
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdateSkill(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync("skill-1")).rejects.toThrow("update failed");
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["skills", "updateHistory"] });
  });
});

describe("useUpdateAllSkills", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("invalidates update history even when the batch update fails", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("batch update failed"));
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdateAllSkills(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync(undefined)).rejects.toThrow("batch update failed");
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["skills", "updateHistory"] });
  });
});

describe("useRepoReadme", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("waits for the repository branch before requesting the README", async () => {
    vi.mocked(invoke).mockResolvedValue("# README");
    const { wrapper } = createQueryWrapper();
    const { rerender } = renderHook(
      ({ branch }: { branch?: string }) => useRepoReadme("owner", "repo", branch),
      { wrapper, initialProps: { branch: undefined as string | undefined } },
    );

    expect(invoke).not.toHaveBeenCalled();

    rerender({ branch: "master" });

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("get_repo_readme", {
        owner: "owner",
        name: "repo",
        branch: "master",
        force: undefined,
      }),
    );
  });
});

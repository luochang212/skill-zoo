import { act, renderHook } from "@testing-library/react";
import { listen } from "@tauri-apps/api/event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useRepoLoadProgress } from "./useRepoLoadStage";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

describe("useRepoLoadProgress", () => {
  beforeEach(() => {
    vi.mocked(listen).mockReset();
  });

  it("unlistens listeners that resolve after the hook unmounts", async () => {
    const resolves: Array<(unlisten: () => void) => void> = [];
    const unlistens = [vi.fn(), vi.fn(), vi.fn()];
    vi.mocked(listen).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolves.push(resolve);
        }),
    );

    const { unmount } = renderHook(() => useRepoLoadProgress("owner", "repo"));
    expect(listen).toHaveBeenCalledTimes(3);

    unmount();

    await act(async () => {
      resolves.forEach((resolve, index) => resolve(unlistens[index]));
      await Promise.resolve();
    });

    expect(unlistens[0]).toHaveBeenCalledOnce();
    expect(unlistens[1]).toHaveBeenCalledOnce();
    expect(unlistens[2]).toHaveBeenCalledOnce();
  });
});

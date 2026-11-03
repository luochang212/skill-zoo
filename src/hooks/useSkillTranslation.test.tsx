import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { translationApi, type TranslationEvent } from "@/lib/api/translation";
import { useSkillTranslation } from "./useSkillTranslation";
vi.mock("@/lib/api/translation", () => ({
  translationApi: { start: vi.fn(), cancel: vi.fn(), translate: vi.fn(), cached: vi.fn() },
}));
const input = {
  skillId: "demo",
  path: "SKILL.md",
  source: "# Hello",
  providerId: "p",
  modelId: "m",
  targetLanguage: "zh-CN",
};
let send: (e: TranslationEvent) => void;
let finish: () => void;
let id: string;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(translationApi.cached).mockResolvedValue(null);
  vi.mocked(translationApi.start).mockResolvedValue();
  vi.mocked(translationApi.cancel).mockResolvedValue();
  vi.mocked(translationApi.translate).mockImplementation((r, callback) => {
    id = r.taskId;
    send = callback;
    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
});
describe("manual translation lifecycle", () => {
  it("shows cached text without registering or generating a translation and respects manual original selection", async () => {
    vi.mocked(translationApi.cached).mockResolvedValue("# 你好");
    const hook = renderHook(() => useSkillTranslation(input, { preferCached: true }));
    await waitFor(() => expect(hook.result.current.text).toBe("# 你好"));
    expect(translationApi.cached).toHaveBeenCalledWith(input);
    expect(hook.result.current.showTranslation).toBe(true);
    expect(translationApi.start).not.toHaveBeenCalled();
    expect(translationApi.translate).not.toHaveBeenCalled();
    act(() => hook.result.current.toggle());
    hook.rerender();
    expect(hook.result.current.showTranslation).toBe(false);
  });
  it("leaves cache misses on the original without starting inference", async () => {
    const hook = renderHook(() => useSkillTranslation(input, { preferCached: true }));
    await waitFor(() => expect(translationApi.cached).toHaveBeenCalledTimes(1));
    expect(hook.result.current.status).toBe("idle");
    expect(hook.result.current.text).toBe("");
    expect(hook.result.current.showTranslation).toBe(false);
    expect(translationApi.start).not.toHaveBeenCalled();
    expect(translationApi.translate).not.toHaveBeenCalled();
  });
  it("ignores a late cached result after switching files", async () => {
    let complete!: (text: string) => void;
    vi.mocked(translationApi.cached).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const hook = renderHook((value) => useSkillTranslation(value, { preferCached: true }), {
      initialProps: input,
    });
    hook.rerender({ ...input, path: "references/other.md", source: "Other" });
    await act(async () => {
      complete("old translation");
    });
    expect(hook.result.current.text).toBe("");
    expect(hook.result.current.showTranslation).toBe(false);
    expect(translationApi.start).not.toHaveBeenCalled();
  });
  it("rereads the cache when the effective model configuration changes", async () => {
    vi.mocked(translationApi.cached)
      .mockResolvedValueOnce("first configuration")
      .mockResolvedValueOnce("second configuration");
    const hook = renderHook(
      (configurationKey: string) =>
        useSkillTranslation(input, { preferCached: true, configurationKey }),
      { initialProps: "first" },
    );
    await waitFor(() => expect(hook.result.current.text).toBe("first configuration"));
    hook.rerender("second");
    await waitFor(() => expect(hook.result.current.text).toBe("second configuration"));
    expect(translationApi.cached).toHaveBeenCalledTimes(2);
    expect(translationApi.translate).not.toHaveBeenCalled();
  });
  it("keeps the original when cache reading fails without generating or showing an error", async () => {
    vi.mocked(translationApi.cached).mockRejectedValue("cacheRead");
    const hook = renderHook(() => useSkillTranslation(input, { preferCached: true }));
    await act(async () => {});
    expect(translationApi.cached).toHaveBeenCalledWith(input);
    expect(hook.result.current.status).toBe("idle");
    expect(hook.result.current.showTranslation).toBe(false);
    expect(hook.result.current.error).toBeNull();
    expect(translationApi.translate).not.toHaveBeenCalled();
  });
  it("does not let a cached read overwrite a manually started translation", async () => {
    let complete!: (text: string) => void;
    vi.mocked(translationApi.cached).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const hook = renderHook(() => useSkillTranslation(input, { preferCached: true }));
    act(() => {
      void hook.result.current.translate();
    });
    await waitFor(() => expect(send).toBeDefined());
    await act(async () => {
      complete("stale cached text");
    });
    expect(hook.result.current.status).toBe("streaming");
    expect(hook.result.current.text).toBe("");
    act(() => {
      send({ type: "completed", taskId: id, text: "new translation" });
      finish();
    });
    expect(hook.result.current.text).toBe("new translation");
  });
  it("does not request automatically and ignores late results after file switching", async () => {
    const hook = renderHook((value) => useSkillTranslation(value), { initialProps: input });
    expect(translationApi.start).not.toHaveBeenCalled();
    expect(translationApi.cached).not.toHaveBeenCalled();
    act(() => {
      void hook.result.current.translate();
    });
    await waitFor(() => expect(send).toBeDefined());
    const oldId = id;
    const oldSend = send;
    act(() => send({ type: "preview", taskId: id, text: "# 你好" }));
    expect(hook.result.current.text).toBe("# 你好");
    hook.rerender({ ...input, path: "references/guide.md", source: "Different" });
    expect(translationApi.cancel).toHaveBeenCalledWith(oldId);
    act(() => {
      oldSend({ type: "completed", taskId: oldId, text: "stale" });
      finish();
    });
    expect(hook.result.current.text).toBe("");
    expect(hook.result.current.status).toBe("idle");
  });
  it("cancels registration that finishes after unmount", async () => {
    let registered!: () => void;
    vi.mocked(translationApi.start).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          registered = resolve;
        }),
    );
    const hook = renderHook(() => useSkillTranslation(input));
    act(() => {
      void hook.result.current.translate();
    });
    const taskId = vi.mocked(translationApi.start).mock.calls[0]![0];
    hook.unmount();
    await act(async () => {
      registered();
    });
    expect(translationApi.translate).not.toHaveBeenCalled();
    expect(translationApi.cancel).toHaveBeenLastCalledWith(taskId);
  });
  it("keeps successful translation during retranslation and restores it on failure", async () => {
    const hook = renderHook(() => useSkillTranslation(input));
    act(() => {
      void hook.result.current.translate();
    });
    await waitFor(() => expect(translationApi.translate).toHaveBeenCalledTimes(1));
    act(() => {
      send({ type: "completed", taskId: id, text: "previous" });
      finish();
    });
    act(() => {
      void hook.result.current.translate(true);
    });
    await waitFor(() => expect(translationApi.translate).toHaveBeenCalledTimes(2));
    act(() => send({ type: "preview", taskId: id, text: "partial replacement" }));
    expect(hook.result.current.text).toBe("previous");
    act(() => {
      send({ type: "failed", taskId: id, code: "truncated" });
      finish();
    });
    expect(hook.result.current.text).toBe("previous");
    expect(hook.result.current.error).toBe("truncated");
  });
});

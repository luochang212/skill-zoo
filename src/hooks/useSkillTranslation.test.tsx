import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { translationApi, type TranslationEvent } from "@/lib/api/translation";
import { useSkillTranslation } from "./useSkillTranslation";
vi.mock("@/lib/api/translation", () => ({
  translationApi: { start: vi.fn(), cancel: vi.fn(), translate: vi.fn() },
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
  it("does not request automatically and ignores late results after file switching", async () => {
    const hook = renderHook((value) => useSkillTranslation(value), { initialProps: input });
    expect(translationApi.start).not.toHaveBeenCalled();
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

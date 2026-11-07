import "@/i18n";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import i18n from "@/i18n";
import { translationApi, type TranslationEvent } from "@/lib/api/translation";
import { useSkillTranslation } from "./useSkillTranslation";
import { createQueryWrapper } from "@/test/utils";
let wrapper: ReturnType<typeof createQueryWrapper>["wrapper"];
vi.mock("@/lib/api/translation", () => ({
  translationApi: { start: vi.fn(), cancel: vi.fn(), translate: vi.fn(), cached: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), dismiss: vi.fn() } }));
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
  wrapper = createQueryWrapper().wrapper;
  vi.clearAllMocks();
  i18n.changeLanguage("en");
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
  it.each(["quotaExceeded", "rateLimit", "authentication", "timeout", "unknownFailure"])(
    "shows a concise localized reason for %s without echoing unknown errors",
    async (code) => {
      await i18n.changeLanguage("zh");
      const hook = renderHook(() => useSkillTranslation(input), { wrapper });
      await act(() => {
        void hook.result.current.translate();
      });
      await waitFor(() => expect(translationApi.translate).toHaveBeenCalledOnce());
      await act(() => send({ type: "failed", taskId: id, code }));
      const reason =
        code === "unknownFailure"
          ? i18n.t("translation.failed")
          : i18n.t(`translation.errors.${code}`);
      expect(toast.error).toHaveBeenCalledWith(reason, { id: `translation-error-${id}` });
      await waitFor(() => expect(hook.result.current.error).toBe(code));
    },
  );

  it("automatically restores a disk-cached translation with a fresh application query client", async () => {
    vi.mocked(translationApi.cached).mockResolvedValue("# 你好");
    const first = renderHook(() => useSkillTranslation(input), { wrapper });
    await waitFor(() => expect(first.result.current.showTranslation).toBe(true));
    first.unmount();

    const restarted = renderHook(() => useSkillTranslation(input), {
      wrapper: createQueryWrapper().wrapper,
    });
    await waitFor(() => expect(restarted.result.current.text).toBe("# 你好"));
    expect(restarted.result.current.showTranslation).toBe(true);
    expect(translationApi.cached).toHaveBeenCalledTimes(2);
    expect(translationApi.start).not.toHaveBeenCalled();
    expect(translationApi.translate).not.toHaveBeenCalled();
  });

  it("preserves an explicit original selection when returning to a cache-loaded document", async () => {
    vi.mocked(translationApi.cached).mockResolvedValue("# 你好");
    const first = renderHook(() => useSkillTranslation(input), { wrapper });
    await waitFor(() => expect(first.result.current.showTranslation).toBe(true));
    await act(() => first.result.current.toggle());
    first.unmount();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const returned = renderHook(() => useSkillTranslation(input), {
      wrapper,
    });
    expect(returned.result.current.text).toBe("# 你好");
    expect(returned.result.current.showTranslation).toBe(false);
    expect(translationApi.cached).toHaveBeenCalledOnce();
    expect(translationApi.start).not.toHaveBeenCalled();
  });

  it("waits until the document is eligible before reading cached translations", async () => {
    vi.mocked(translationApi.cached).mockResolvedValue("# 你好");
    const hook = renderHook((cacheEnabled) => useSkillTranslation(input, { cacheEnabled }), {
      wrapper,
      initialProps: false,
    });
    expect(translationApi.cached).not.toHaveBeenCalled();
    expect(hook.result.current.cachePending).toBe(false);
    hook.rerender(true);
    await waitFor(() => expect(hook.result.current.showTranslation).toBe(true));
    expect(translationApi.start).not.toHaveBeenCalled();
    expect(translationApi.translate).not.toHaveBeenCalled();
  });

  it("shows cached text without registering or generating a translation and respects manual original selection", async () => {
    vi.mocked(translationApi.cached).mockResolvedValue("# 你好");
    const hook = renderHook(() => useSkillTranslation(input), { wrapper });
    await waitFor(() => expect(hook.result.current.text).toBe("# 你好"));
    expect(translationApi.cached).toHaveBeenCalledWith(input);
    await waitFor(() => expect(hook.result.current.showTranslation).toBe(true));
    expect(translationApi.start).not.toHaveBeenCalled();
    expect(translationApi.translate).not.toHaveBeenCalled();
    await act(() => hook.result.current.toggle());
    hook.rerender();
    await waitFor(() => expect(hook.result.current.showTranslation).toBe(false));
  });
  it("leaves cache misses on the original without starting inference", async () => {
    const hook = renderHook(() => useSkillTranslation(input), { wrapper });
    await waitFor(() => expect(translationApi.cached).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(hook.result.current.status).toBe("idle"));
    await waitFor(() => expect(hook.result.current.text).toBe(""));
    await waitFor(() => expect(hook.result.current.showTranslation).toBe(false));
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
    const hook = renderHook((value) => useSkillTranslation(value), {
      wrapper,
      initialProps: input,
    });
    hook.rerender({ ...input, path: "references/other.md", source: "Other" });
    await act(async () => {
      complete("old translation");
    });
    await waitFor(() => expect(hook.result.current.text).toBe(""));
    await waitFor(() => expect(hook.result.current.showTranslation).toBe(false));
    expect(translationApi.start).not.toHaveBeenCalled();
  });
  it("rereads the cache when the effective model configuration changes", async () => {
    vi.mocked(translationApi.cached)
      .mockResolvedValueOnce("first configuration")
      .mockResolvedValueOnce("second configuration");
    const hook = renderHook(
      (configurationKey: string) => useSkillTranslation(input, { configurationKey }),
      { wrapper, initialProps: "first" },
    );
    await waitFor(() => expect(hook.result.current.text).toBe("first configuration"));
    hook.rerender("second");
    await waitFor(() => expect(hook.result.current.text).toBe("second configuration"));
    expect(translationApi.cached).toHaveBeenCalledTimes(2);
    expect(translationApi.translate).not.toHaveBeenCalled();
  });
  it("keeps the original when cache reading fails without generating or showing an error", async () => {
    vi.mocked(translationApi.cached).mockRejectedValue("cacheRead");
    const hook = renderHook(() => useSkillTranslation(input), { wrapper });
    await act(async () => {});
    expect(translationApi.cached).toHaveBeenCalledWith(input);
    await waitFor(() => expect(hook.result.current.status).toBe("idle"));
    await waitFor(() => expect(hook.result.current.showTranslation).toBe(false));
    await waitFor(() => expect(hook.result.current.error).toBeNull());
    expect(translationApi.translate).not.toHaveBeenCalled();
  });
  it("holds the loading gate while the cache lookup is pending and releases it on a hit", async () => {
    let complete!: (text: string) => void;
    vi.mocked(translationApi.cached).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const hook = renderHook(() => useSkillTranslation(input), { wrapper });
    await waitFor(() => expect(hook.result.current.cachePending).toBe(true));
    await act(async () => {
      complete("# 你好");
    });
    await waitFor(() => expect(hook.result.current.cachePending).toBe(false));
    await waitFor(() => expect(hook.result.current.text).toBe("# 你好"));
    await waitFor(() => expect(hook.result.current.showTranslation).toBe(true));
  });
  it("releases the loading gate on a cache miss or failure so the original renders", async () => {
    vi.mocked(translationApi.cached).mockRejectedValue("cacheRead");
    const hook = renderHook(() => useSkillTranslation(input), { wrapper });
    await waitFor(() => expect(hook.result.current.cachePending).toBe(true));
    await waitFor(() => expect(hook.result.current.cachePending).toBe(false));
    await waitFor(() => expect(hook.result.current.status).toBe("idle"));
    await waitFor(() => expect(hook.result.current.showTranslation).toBe(false));
    await waitFor(() => expect(hook.result.current.text).toBe(""));
  });
  it("drops the loading gate as soon as a manual translation starts", async () => {
    let complete!: (text: string) => void;
    vi.mocked(translationApi.cached).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const hook = renderHook(() => useSkillTranslation(input), { wrapper });
    await waitFor(() => expect(hook.result.current.cachePending).toBe(true));
    await act(() => {
      void hook.result.current.translate();
    });
    await waitFor(() => expect(hook.result.current.cachePending).toBe(false));
    await act(async () => {
      complete("stale cached text");
    });
    await waitFor(() => expect(hook.result.current.status).toBe("streaming"));
    await waitFor(() => expect(hook.result.current.text).toBe(""));
  });
  it("does not let a cached read overwrite a manually started translation", async () => {
    let complete!: (text: string) => void;
    vi.mocked(translationApi.cached).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const hook = renderHook(() => useSkillTranslation(input), { wrapper });
    await act(() => {
      void hook.result.current.translate();
    });
    await waitFor(() => expect(send).toBeDefined());
    await act(async () => {
      complete("stale cached text");
    });
    await waitFor(() => expect(hook.result.current.status).toBe("streaming"));
    await waitFor(() => expect(hook.result.current.text).toBe(""));
    await act(() => {
      send({ type: "completed", taskId: id, text: "new translation" });
      finish();
    });
    await waitFor(() => expect(hook.result.current.text).toBe("new translation"));
  });
  it("continues in the background without leaking results into another file", async () => {
    const hook = renderHook((value) => useSkillTranslation(value), {
      wrapper,
      initialProps: input,
    });
    expect(translationApi.start).not.toHaveBeenCalled();
    await waitFor(() => expect(hook.result.current.cachePending).toBe(false));
    expect(translationApi.cached).toHaveBeenCalledWith(input);
    await act(() => {
      void hook.result.current.translate();
    });
    await waitFor(() => expect(send).toBeDefined());
    const oldId = id;
    const oldSend = send;
    await act(() => send({ type: "preview", taskId: id, text: "# 你好" }));
    await waitFor(() => expect(hook.result.current.text).toBe("# 你好"));
    hook.rerender({ ...input, path: "references/guide.md", source: "Different" });
    expect(translationApi.cancel).not.toHaveBeenCalled();
    await act(() => {
      oldSend({ type: "completed", taskId: oldId, text: "stale" });
      finish();
    });
    await waitFor(() => expect(hook.result.current.text).toBe(""));
    await waitFor(() => expect(hook.result.current.status).toBe("idle"));
    hook.rerender(input);
    await waitFor(() => expect(hook.result.current.text).toBe("stale"));
    await waitFor(() => expect(hook.result.current.status).toBe("completed"));
  });
  it("announces the targeted repair round with a toast and dismisses it when the task settles", async () => {
    const hook = renderHook(() => useSkillTranslation(input), { wrapper });
    await act(() => {
      void hook.result.current.translate();
    });
    await waitFor(() => expect(send).toBeDefined());
    await act(() => send({ type: "repairing", taskId: id }));
    expect(toast.info).toHaveBeenCalledWith("Repairing translation…", {
      id: `repair-${id}`,
      duration: Infinity,
    });
    await act(() => {
      send({ type: "completed", taskId: id, text: "fixed" });
      finish();
    });
    expect(toast.dismiss).toHaveBeenCalledWith(`repair-${id}`);
    await waitFor(() => expect(hook.result.current.text).toBe("fixed"));
  });
  it("keeps the preview and accepts repaired text when command resolution precedes channel delivery", async () => {
    const hook = renderHook(() => useSkillTranslation(input), { wrapper });
    await act(() => {
      void hook.result.current.translate();
    });
    await waitFor(() => expect(translationApi.translate).toHaveBeenCalledOnce());
    await act(() => {
      send({ type: "preview", taskId: id, text: "部分译文" });
      send({ type: "repairing", taskId: id });
    });
    await act(async () => {
      finish();
    });
    await waitFor(() => expect(hook.result.current.error).toBeNull());
    await waitFor(() => expect(hook.result.current.status).toBe("streaming"));
    await waitFor(() => expect(hook.result.current.text).toBe("部分译文"));
    await waitFor(() => expect(hook.result.current.showTranslation).toBe(true));
    await act(() => send({ type: "completed", taskId: id, text: "修复后的译文" }));
    await waitFor(() => expect(hook.result.current.text).toBe("修复后的译文"));
    await waitFor(() => expect(hook.result.current.status).toBe("completed"));
    await waitFor(() => expect(hook.result.current.error).toBeNull());
    expect(toast.dismiss).toHaveBeenCalledWith(`repair-${id}`);
  });
  it("allows retry after a failed event delivered after command resolution", async () => {
    const hook = renderHook(() => useSkillTranslation(input), { wrapper });
    await act(() => {
      void hook.result.current.translate();
    });
    await waitFor(() => expect(translationApi.translate).toHaveBeenCalledOnce());
    await act(async () => {
      finish();
    });
    await act(() => send({ type: "failed", taskId: id, code: "fidelity" }));
    await waitFor(() => expect(hook.result.current.error).toBe("fidelity"));
    await act(() => {
      void hook.result.current.translate();
    });
    await waitFor(() => expect(translationApi.translate).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(hook.result.current.error).toBeNull());
    await act(() => send({ type: "completed", taskId: id, text: "重试成功" }));
    await waitFor(() => expect(hook.result.current.text).toBe("重试成功"));
  });
  it("keeps the background repair toast until the task settles", async () => {
    const hook = renderHook((value: typeof input) => useSkillTranslation(value), {
      wrapper,
      initialProps: input,
    });
    await act(() => {
      void hook.result.current.translate();
    });
    await waitFor(() => expect(send).toBeDefined());
    await act(() => send({ type: "repairing", taskId: id }));
    expect(toast.info).toHaveBeenCalled();
    await act(() => hook.rerender({ ...input, path: "other.md" }));
    expect(toast.dismiss).not.toHaveBeenCalled();
    expect(translationApi.cancel).not.toHaveBeenCalled();
    await act(() => send({ type: "completed", taskId: id, text: "fixed in background" }));
    expect(toast.dismiss).toHaveBeenCalledWith(`repair-${id}`);
  });
  it("continues registration after unmount and restores the session on return", async () => {
    let registered!: () => void;
    vi.mocked(translationApi.start).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          registered = resolve;
        }),
    );
    const hook = renderHook(() => useSkillTranslation(input), { wrapper });
    await act(() => {
      void hook.result.current.translate();
    });
    const taskId = vi.mocked(translationApi.start).mock.calls[0]![0];
    hook.unmount();
    await act(async () => {
      registered();
    });
    expect(translationApi.translate).toHaveBeenCalledOnce();
    expect(translationApi.cancel).not.toHaveBeenCalled();
    const returned = renderHook(() => useSkillTranslation(input), { wrapper });
    await waitFor(() => expect(returned.result.current.status).toBe("streaming"));
    await act(() => send({ type: "completed", taskId, text: "background result" }));
    await waitFor(() => expect(returned.result.current.text).toBe("background result"));
  });
  it("does not retain idle document and draft sessions after leaving", async () => {
    const { wrapper: localWrapper, queryClient } = createQueryWrapper();
    const hook = renderHook(() => useSkillTranslation(input), { wrapper: localWrapper });
    hook.unmount();
    await waitFor(() => expect(queryClient.getQueryCache().getAll()).toHaveLength(0));
  });
  it("restores a result completed while no document view was mounted", async () => {
    const hook = renderHook(() => useSkillTranslation(input), { wrapper });
    await act(() => {
      void hook.result.current.translate();
    });
    await waitFor(() => expect(translationApi.translate).toHaveBeenCalledOnce());
    await act(() => send({ type: "preview", taskId: id, text: "partial" }));
    hook.unmount();
    await act(async () => {
      // Let the abandoned view's garbage-collection timer run before delivery.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      send({ type: "completed", taskId: id, text: "finished away" });
      finish();
    });
    const returned = renderHook(() => useSkillTranslation(input), { wrapper });
    expect(returned.result.current.text).toBe("finished away");
    expect(returned.result.current.showTranslation).toBe(true);
    expect(translationApi.start).toHaveBeenCalledOnce();
    expect(translationApi.cancel).not.toHaveBeenCalled();
  });
  it("explicitly cancels registration before acknowledgement and ignores late success", async () => {
    let registered!: () => void;
    vi.mocked(translationApi.start).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          registered = resolve;
        }),
    );
    const hook = renderHook(() => useSkillTranslation(input), { wrapper });
    await act(() => {
      void hook.result.current.translate();
    });
    const taskId = vi.mocked(translationApi.start).mock.calls[0]![0];
    await act(() => hook.result.current.cancel());
    await act(async () => {
      registered();
    });
    expect(translationApi.cancel).toHaveBeenLastCalledWith(taskId);
    expect(translationApi.translate).not.toHaveBeenCalled();
    await waitFor(() => expect(hook.result.current.status).toBe("cancelled"));
  });
  it("shares one task between views and preserves manual original selection on completion", async () => {
    const hook = renderHook(() => useSkillTranslation(input), { wrapper });
    const other = renderHook(() => useSkillTranslation(input), { wrapper });
    await act(() => {
      void hook.result.current.translate();
      void other.result.current.translate();
    });
    await waitFor(() => expect(translationApi.translate).toHaveBeenCalledOnce());
    await act(() => send({ type: "preview", taskId: id, text: "partial" }));
    await waitFor(() => expect(other.result.current.text).toBe("partial"));
    await act(() => other.result.current.toggle());
    await act(() => send({ type: "completed", taskId: id, text: "finished" }));
    await waitFor(() => expect(hook.result.current.text).toBe("finished"));
    expect(hook.result.current.showTranslation).toBe(false);
    expect(other.result.current.showTranslation).toBe(false);
  });
  it("ignores superseded task events after an explicit retranslation", async () => {
    const hook = renderHook(() => useSkillTranslation(input), { wrapper });
    await act(() => {
      void hook.result.current.translate();
    });
    await waitFor(() => expect(translationApi.translate).toHaveBeenCalledOnce());
    const oldSend = send;
    const oldId = id;
    await act(() => {
      void hook.result.current.translate(true);
    });
    await waitFor(() => expect(translationApi.translate).toHaveBeenCalledTimes(2));
    await act(() => oldSend({ type: "completed", taskId: oldId, text: "superseded" }));
    await act(() => send({ type: "completed", taskId: id, text: "replacement" }));
    await waitFor(() => expect(hook.result.current.text).toBe("replacement"));
    expect(translationApi.cancel).toHaveBeenCalledWith(oldId);
  });
  it("keeps successful translation during retranslation and restores it on failure", async () => {
    const hook = renderHook(() => useSkillTranslation(input), { wrapper });
    await act(() => {
      void hook.result.current.translate();
    });
    await waitFor(() => expect(translationApi.translate).toHaveBeenCalledTimes(1));
    await act(() => {
      send({ type: "completed", taskId: id, text: "previous" });
      finish();
    });
    await act(() => {
      void hook.result.current.translate(true);
    });
    await waitFor(() => expect(translationApi.translate).toHaveBeenCalledTimes(2));
    await act(() => send({ type: "preview", taskId: id, text: "partial replacement" }));
    await waitFor(() => expect(hook.result.current.text).toBe("previous"));
    await act(() => {
      send({ type: "failed", taskId: id, code: "truncated" });
      finish();
    });
    await waitFor(() => expect(hook.result.current.text).toBe("previous"));
    await waitFor(() => expect(hook.result.current.error).toBe("truncated"));
  });
});

it("identifies parallel background tasks in error and repair toasts after navigation", async () => {
  const tasks = new Map<string, { id: string; send: (e: TranslationEvent) => void }>();
  vi.mocked(translationApi.translate).mockImplementation((request, callback) => {
    tasks.set(request.skillId, { id: request.taskId, send: callback });
    return new Promise(() => {});
  });
  const first = renderHook(
    () =>
      useSkillTranslation(
        { ...input, skillId: "skill-a", path: "references/guide.md" },
        { skillName: "Alpha skill" },
      ),
    { wrapper },
  );
  const second = renderHook(
    () => useSkillTranslation({ ...input, skillId: "skill-b" }, { skillName: "Beta skill" }),
    { wrapper },
  );
  await act(() => {
    void first.result.current.translate();
    void second.result.current.translate();
  });
  await waitFor(() => expect(tasks.size).toBe(2));
  first.unmount();
  const a = tasks.get("skill-a")!;
  const b = tasks.get("skill-b")!;
  await act(() => {
    a.send({ type: "repairing", taskId: a.id });
    b.send({ type: "failed", taskId: b.id, code: "network" });
    a.send({ type: "failed", taskId: a.id, code: "fidelity" });
  });
  expect(toast.info).toHaveBeenCalledWith(
    "Alpha skill · Repairing translation…",
    expect.objectContaining({ id: `repair-${a.id}` }),
  );
  expect(toast.error).toHaveBeenCalledWith(
    `Beta skill · ${i18n.t("translation.errors.network")}`,
    expect.objectContaining({ id: `translation-error-${b.id}` }),
  );
  expect(toast.error).toHaveBeenCalledWith(
    `Alpha skill · ${i18n.t("translation.errors.fidelity")}`,
    expect.objectContaining({ id: `translation-error-${a.id}` }),
  );
});

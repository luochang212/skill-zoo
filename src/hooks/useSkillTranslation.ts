import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { translationApi, type TranslationRequest } from "@/lib/api/translation";
import { translationErrorCode } from "@/lib/translation";

type Input = Omit<TranslationRequest, "taskId" | "force">;
type Status = "idle" | "streaming" | "completed" | "failed" | "cancelled";
interface View {
  identity: string;
  status: Status;
  text: string;
  showTranslation: boolean;
  error: string | null;
}
const empty = (identity: string): View => ({
  identity,
  status: "idle",
  text: "",
  showTranslation: false,
  error: null,
});

export function useSkillTranslation(input: Input) {
  const identity = JSON.stringify(input);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const task = useRef<{ id: string; identity: string; previous: string } | null>(null);
  const [view, setView] = useState<View>(() => empty(identity));
  const viewRef = useRef(view);
  viewRef.current = view;
  const cancelTask = useCallback(() => {
    const current = task.current;
    task.current = null;
    if (current) void translationApi.cancel(current.id).catch(() => {});
    return current;
  }, []);
  useLayoutEffect(() => {
    setView(empty(identity));
    return () => {
      cancelTask();
    };
  }, [identity, cancelTask]);

  const cancel = useCallback(() => {
    const current = cancelTask();
    if (current)
      setView((v) => ({
        ...v,
        status: "cancelled",
        text: current.previous,
        showTranslation: !!current.previous,
        error: null,
      }));
  }, [cancelTask]);

  const translate = useCallback(
    async (force = false) => {
      cancelTask();
      const id = crypto.randomUUID();
      const previous =
        viewRef.current.identity === identity && viewRef.current.status !== "streaming"
          ? viewRef.current.text
          : "";
      const current = { id, identity, previous };
      task.current = current;
      setView({
        identity,
        status: "streaming",
        text: previous,
        showTranslation: true,
        error: null,
      });
      const active = () => task.current === current && currentIdentity.current === identity;
      const fail = (code: string) => {
        if (!active()) return;
        task.current = null;
        setView({
          identity,
          status: "failed",
          text: previous,
          showTranslation: !!previous,
          error: code,
        });
      };
      try {
        await translationApi.start(id);
        // Cleanup can run while registration is in flight. Cancel again after its acknowledgement.
        if (!active()) {
          await translationApi.cancel(id);
          return;
        }
        await translationApi.translate({ ...input, taskId: id, force }, (event) => {
          if (!active() || event.taskId !== id) return;
          if (event.type === "failed") {
            fail(event.code);
            return;
          }
          if (event.type === "completed") {
            task.current = null;
            setView({
              identity,
              status: "completed",
              text: event.text,
              showTranslation: true,
              error: null,
            });
          } else if (!previous) {
            setView((v) => ({ ...v, text: event.text }));
          }
        });
        if (active()) fail("incomplete");
      } catch (error) {
        fail(translationErrorCode(error));
        void translationApi.cancel(id).catch(() => {});
      }
    },
    [identity, input, cancelTask],
  );

  return {
    ...(view.identity === identity ? view : empty(identity)),
    translate,
    cancel,
    toggle: () => setView((v) => ({ ...v, showTranslation: !v.showTranslation })),
  };
}

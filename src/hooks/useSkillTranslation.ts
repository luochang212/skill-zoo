import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
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

export function useSkillTranslation(
  input: Input,
  {
    preferCached = false,
    configurationKey = "",
  }: { preferCached?: boolean; configurationKey?: string } = {},
) {
  const { t } = useTranslation();
  const identity = JSON.stringify([input, configurationKey]);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const task = useRef<{ id: string; identity: string; previous: string } | null>(null);
  const cacheVersion = useRef(0);
  const [view, setView] = useState<View>(() => empty(identity));
  // Identity whose initial cache lookup has settled; null while one is in flight.
  const [cacheSettled, setCacheSettled] = useState<string | null>(null);
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
    setCacheSettled(null);
    return () => {
      cancelTask();
    };
  }, [identity, cancelTask]);

  useEffect(() => {
    if (!preferCached) return;
    let active = true;
    const version = cacheVersion.current;
    const [request] = JSON.parse(identity) as [Input, string];
    void translationApi
      .cached(request)
      .then((text) => {
        if (
          !active ||
          !text ||
          currentIdentity.current !== identity ||
          cacheVersion.current !== version ||
          task.current
        )
          return;
        setView((current) =>
          current.identity === identity && current.status === "idle"
            ? { identity, status: "completed", text, showTranslation: true, error: null }
            : current,
        );
      })
      .catch(() => {})
      .finally(() => {
        if (currentIdentity.current === identity) setCacheSettled(identity);
      });
    return () => {
      active = false;
    };
  }, [identity, preferCached]);

  const cancel = useCallback(() => {
    const current = cancelTask();
    if (current) {
      toast.dismiss(`repair-${current.id}`);
      setView((v) => ({
        ...v,
        status: "cancelled",
        text: current.previous,
        showTranslation: !!current.previous,
        error: null,
      }));
    }
  }, [cancelTask]);

  const translate = useCallback(
    async (force = false) => {
      cacheVersion.current += 1;
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
      const dismissRepair = () => toast.dismiss(`repair-${id}`);
      const fail = (code: string) => {
        if (!active()) return;
        task.current = null;
        dismissRepair();
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
          if (event.type === "repairing") {
            // The targeted repair round must never run silently.
            toast.info(t("translation.repairing"), { id: `repair-${id}` });
            return;
          }
          if (event.type === "completed") {
            dismissRepair();
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
    [identity, input, cancelTask, t],
  );

  const current = view.identity === identity ? view : empty(identity);
  return {
    ...current,
    translate,
    cancel,
    toggle: () => {
      cacheVersion.current += 1;
      setView((v) => ({ ...v, showTranslation: !v.showTranslation }));
    },
    // While the initial cache lookup is unresolved, the pane holds its loading
    // state so a hit renders the translation directly without an original flash.
    cachePending: preferCached && cacheSettled !== identity && current.status === "idle",
  };
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { translationApi, type TranslationRequest } from "@/lib/api/translation";
import { translationErrorCode } from "@/lib/translation";

type Input = Omit<TranslationRequest, "taskId" | "force">;
type Status = "idle" | "streaming" | "completed" | "failed" | "cancelled";
interface Session {
  status: Status;
  text: string;
  showTranslation: boolean;
  error: string | null;
  task: { id: string; previous: string } | null;
  cacheVersion: number;
}
const empty = (): Session => ({
  status: "idle",
  text: "",
  showTranslation: false,
  error: null,
  task: null,
  cacheVersion: 0,
});

export function useSkillTranslation(
  input: Input,
  {
    preferCached = false,
    configurationKey = "",
    skillName = "",
  }: { preferCached?: boolean; configurationKey?: string; skillName?: string } = {},
) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const identity = JSON.stringify([input, configurationKey]);
  const key = useMemo(() => ["translation-session", identity] as const, [identity]);
  // The application owns the session; leaving a document only unsubscribes its view.
  const { data: view = empty() } = useQuery<Session>({
    queryKey: key,
    queryFn: skipToken,
    initialData: empty,
    gcTime: 0,
  });
  const getView = useCallback(() => client.getQueryData<Session>(key) ?? empty(), [client, key]);
  const setView = useCallback(
    (update: (current: Session) => Session) =>
      client.setQueryData<Session>(key, (current) => update(current ?? empty())),
    [client, key],
  );
  const [cacheSettled, setCacheSettled] = useState<string | null>(null);
  const cancelTask = useCallback(() => {
    const current = getView().task;
    if (current) {
      setView((v) => ({ ...v, task: null }));
      void translationApi.cancel(current.id).catch(() => {});
      toast.dismiss(`repair-${current.id}`);
    }
    return current;
  }, [getView, setView]);

  useEffect(() => {
    if (!preferCached || getView().status !== "idle") return;
    let active = true;
    const version = getView().cacheVersion;
    const [request] = JSON.parse(identity) as [Input, string];
    void translationApi
      .cached(request)
      .then((text) => {
        if (!active || !text) return;
        setView((current) =>
          current.status === "idle" && current.cacheVersion === version
            ? { ...current, status: "completed", text, showTranslation: true, error: null }
            : current,
        );
      })
      .catch(() => {})
      .finally(() => {
        if (active) setCacheSettled(identity);
      });
    return () => {
      active = false;
    };
  }, [identity, preferCached, getView, setView]);

  const cancel = useCallback(() => {
    const current = cancelTask();
    if (current) {
      setView((v) => ({
        ...v,
        status: "cancelled",
        text: current.previous,
        showTranslation: !!current.previous && v.showTranslation,
        error: null,
      }));
    }
  }, [cancelTask, setView]);

  const translate = useCallback(
    async (force = false) => {
      const old = getView();
      // Multiple views of the same session must not start duplicate requests.
      if (old.task && !force) return;
      cancelTask();
      // Only manually started sessions outlive their views; unused drafts can be collected.
      const query = client.getQueryCache().find({ queryKey: key, exact: true });
      query?.setOptions({ ...query.options, gcTime: Infinity });
      const id = crypto.randomUUID();
      const previous = old.task ? old.task.previous : old.text;
      setView((v) => ({
        ...v,
        status: "streaming",
        text: previous,
        showTranslation: true,
        error: null,
        task: { id, previous },
        cacheVersion: v.cacheVersion + 1,
      }));
      const active = () => getView().task?.id === id;
      const dismissRepair = () => toast.dismiss(`repair-${id}`);
      const notificationPrefix = skillName ? `${skillName} · ` : "";
      const fail = (code: string) => {
        if (!active()) return;
        dismissRepair();
        toast.error(
          `${notificationPrefix}${t(`translation.errors.${code}`, { defaultValue: t("translation.failed") })}`,
          {
            id: `translation-error-${id}`,
          },
        );
        setView((v) => ({
          ...v,
          status: "failed",
          task: null,
          text: previous,
          showTranslation: !!previous && v.showTranslation,
          error: code,
        }));
      };
      try {
        await translationApi.start(id);
        // Explicit cancellation can precede registration's acknowledgement.
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
            toast.info(`${notificationPrefix}${t("translation.repairing")}`, {
              id: `repair-${id}`,
              duration: Infinity,
            });
            return;
          }
          if (event.type === "completed") {
            dismissRepair();
            setView((v) => ({
              ...v,
              status: "completed",
              task: null,
              text: event.text,
              error: null,
            }));
          } else if (!previous) {
            setView((v) => ({ ...v, text: event.text }));
          }
        });
        // Command resolution can precede Channel delivery; only terminal events settle the task.
      } catch (error) {
        fail(translationErrorCode(error));
        void translationApi.cancel(id).catch(() => {});
      }
    },
    [input, getView, setView, cancelTask, client, key, skillName, t],
  );

  return {
    identity,
    status: view.status,
    text: view.text,
    showTranslation: view.showTranslation,
    error: view.error,
    translate,
    cancel,
    toggle: () => {
      setView((v) => ({
        ...v,
        cacheVersion: v.cacheVersion + 1,
        showTranslation: !v.showTranslation,
      }));
    },
    cachePending: preferCached && cacheSettled !== identity && view.status === "idle",
  };
}

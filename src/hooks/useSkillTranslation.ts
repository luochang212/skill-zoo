import { useCallback, useEffect, useMemo, useState } from "react";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  translationApi,
  type TranslationRequest,
  type TranslationCacheRequest,
} from "@/lib/api/translation";
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
    cacheEnabled = true,
    preferTranslations = false,
    skillName = "",
  }: {
    cacheEnabled?: boolean;
    preferTranslations?: boolean;
    skillName?: string;
  } = {},
) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const identity = JSON.stringify({
    skillId: input.skillId,
    path: input.path,
    source: input.source,
    targetLanguage: input.targetLanguage,
  } satisfies TranslationCacheRequest);
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
  const selectionKey = JSON.stringify([identity, preferTranslations]);
  const [selectedView, setSelectedView] = useState<string | null>(null);
  const [cacheSettled, setCacheSettled] = useState<string | null>(null);
  useEffect(() => {
    setSelectedView(null);
    setCacheSettled(null);
  }, [selectionKey]);
  const showTranslation =
    view.showTranslation && (preferTranslations || selectedView === selectionKey);
  const cancelTask = useCallback(() => {
    const current = getView().task;
    if (current) {
      setView((v) => ({ ...v, task: null }));
      void translationApi.cancel(current.id).catch(() => {});
    }
    return current;
  }, [getView, setView]);

  useEffect(() => {
    if (!preferTranslations || !cacheEnabled || getView().status !== "idle") return;
    let active = true;
    const version = getView().cacheVersion;
    const request = JSON.parse(identity) as TranslationCacheRequest;
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
  }, [identity, cacheEnabled, preferTranslations, getView, setView]);

  const showCached = useCallback(async () => {
    if (!cacheEnabled) return false;
    const version = getView().cacheVersion;
    try {
      const text = await translationApi.cached(JSON.parse(identity) as TranslationCacheRequest);
      const current = getView();
      if (current.task || current.cacheVersion !== version) return !!current.text || !!current.task;
      if (!text) return false;
      setSelectedView(selectionKey);
      const query = client.getQueryCache().find({ queryKey: key, exact: true });
      query?.setOptions({ ...query.options, gcTime: Infinity });
      setView((v) => ({
        ...v,
        status: "completed",
        text,
        showTranslation: true,
        error: null,
        cacheVersion: v.cacheVersion + 1,
      }));
      return true;
    } catch {
      return false;
    }
  }, [cacheEnabled, identity, getView, selectionKey, client, key, setView]);

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
      setSelectedView(selectionKey);
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
      const notificationPrefix = skillName ? `${skillName} · ` : "";
      const fail = (code: string) => {
        if (!active()) return;
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
          if (event.type === "completed") {
            setView((v) => ({
              ...v,
              status: "completed",
              task: null,
              text: event.text,
              error: null,
            }));
          } else if (event.text.trim()) {
            setView((v) => ({ ...v, text: event.text }));
          }
        });
        // Command resolution can precede Channel delivery; only terminal events settle the task.
      } catch (error) {
        fail(translationErrorCode(error));
        void translationApi.cancel(id).catch(() => {});
      }
    },
    [input, getView, setView, cancelTask, client, key, selectionKey, skillName, t],
  );

  return {
    identity,
    status: view.status,
    text: view.text,
    showTranslation,
    error: view.error,
    translate,
    cancel,
    showCached,
    toggle: () => {
      setSelectedView(selectionKey);
      const query = client.getQueryCache().find({ queryKey: key, exact: true });
      query?.setOptions({ ...query.options, gcTime: Infinity });
      setView((v) => ({
        ...v,
        cacheVersion: v.cacheVersion + 1,
        showTranslation: !showTranslation,
      }));
    },
    cachePending:
      preferTranslations && cacheEnabled && cacheSettled !== identity && view.status === "idle",
  };
}

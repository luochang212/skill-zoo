import { useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { translationApi, type LlmModel } from "@/lib/api/translation";

const parseLimit = (value: string) => {
  if (!value.trim()) return null;
  const number = Number(value);
  return /^\d+$/.test(value) &&
    Number.isSafeInteger(number) &&
    number > 0 &&
    number <= 4_294_967_295
    ? number
    : undefined;
};

export function ModelEditorDialog({
  mode = "edit",
  model,
  baseUrl,
  otherModelIds,
  onConfirm,
  onClose,
  returnFocusRef,
}: {
  mode?: "add" | "edit";
  model: LlmModel;
  baseUrl: string;
  otherModelIds: string[];
  onConfirm: (model: LlmModel) => void;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [modelId, setModelId] = useState(model.id);
  const composing = useRef(false);
  const [context, setContext] = useState(model.contextWindow?.toString() ?? "");
  const [output, setOutput] = useState(model.maxOutputTokens?.toString() ?? "");
  const manual = useRef({
    context: model.contextWindow != null,
    output: model.maxOutputTokens != null,
  });
  const [error, setError] = useState<"modelId" | "contextWindow" | "maxOutputTokens" | null>(null);
  const identity = useMemo(() => ({}), [baseUrl, modelId]);
  const activeIdentity = useRef(identity);
  activeIdentity.current = identity;
  useEffect(() => {
    let current = true;
    if (!modelId.trim()) return;
    const timer = setTimeout(() => {
      void translationApi
        .resolveModel(baseUrl, modelId.trim())
        .then((result) => {
          // A→B→A and closing are different editing sessions even when the final ID is identical.
          if (!current || activeIdentity.current !== identity) return;
          if (result) {
            if (!manual.current.context && result.contextWindow != null)
              setContext(String(result.contextWindow));
            if (!manual.current.output && result.maxOutputTokens != null)
              setOutput(String(result.maxOutputTokens));
            toast.success(t("llm.configurationMatched"), { id: `${id}-model-config` });
          }
        })
        .catch(() => undefined);
    }, 400);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [baseUrl, modelId, identity, id, t]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="flex max-h-[calc(100vh-4rem)] w-[calc(100vw-2rem)] max-w-[440px] flex-col gap-0 overflow-hidden p-0 sm:rounded-xl"
        onCloseAutoFocus={(event) => {
          if (returnFocusRef.current) {
            event.preventDefault();
            returnFocusRef.current.focus();
          }
        }}
      >
        <DialogHeader className="shrink-0 border-b border-border/50 p-4 text-left">
          <DialogTitle className="pr-6">
            {t(mode === "add" ? "llm.addModel" : "llm.editModel")}
          </DialogTitle>
          <DialogDescription>{t("llm.modelParametersHint")}</DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-col"
          onCompositionStartCapture={() => {
            composing.current = true;
          }}
          onCompositionEndCapture={() => {
            composing.current = false;
          }}
          onKeyDownCapture={(event) => {
            // 候选确认只完成输入，不提交参数；兼容 WebKit 提前派发 compositionend。
            if (
              event.key === "Enter" &&
              (composing.current ||
                event.nativeEvent.isComposing ||
                event.nativeEvent.keyCode === 229)
            )
              event.preventDefault();
          }}
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const nextId = modelId.trim();
            const nextContext = parseLimit(context);
            const nextOutput = parseLimit(output);
            if (!nextId || otherModelIds.includes(nextId)) {
              setError("modelId");
              return;
            }
            if (nextContext === undefined) {
              setError("contextWindow");
              return;
            }
            if (
              nextOutput === undefined ||
              (nextOutput != null && nextContext != null && nextOutput > nextContext)
            ) {
              setError("maxOutputTokens");
              return;
            }
            const next = { ...model, id: nextId, maxOutputTokens: nextOutput };
            if (nextContext != null) next.contextWindow = nextContext;
            else delete next.contextWindow;
            onConfirm(next);
          }}
        >
          <div className="min-h-0 space-y-5 overflow-y-auto p-4">
            <div className="space-y-2">
              <label htmlFor={`${id}-model`} className="block text-xs font-medium">
                {t("llm.modelIdentifier")}
              </label>
              <Input
                id={`${id}-model`}
                className="h-9 font-mono text-xs"
                autoFocus
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={modelId}
                aria-invalid={error === "modelId"}
                onChange={(event) => {
                  setModelId(event.target.value);
                  setError(null);
                  if (!manual.current.context) setContext("");
                  if (!manual.current.output) setOutput("");
                }}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              {(
                [
                  { field: "contextWindow", value: context, set: setContext, manualKey: "context" },
                  { field: "maxOutputTokens", value: output, set: setOutput, manualKey: "output" },
                ] as const
              ).map(({ field, value, set, manualKey }) => (
                <div className="min-w-0 space-y-2" key={field}>
                  <label htmlFor={`${id}-${field}`} className="block text-xs font-medium">
                    {t(`llm.${field}`)}
                  </label>
                  <Input
                    id={`${id}-${field}`}
                    className="h-9 text-xs"
                    inputMode="numeric"
                    value={value}
                    placeholder={t("llm.unsetLimit")}
                    aria-invalid={error === field}
                    onChange={(event) => {
                      manual.current[manualKey] = true;
                      set(event.target.value);
                      setError(null);
                    }}
                  />
                </div>
              ))}
            </div>
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {t(`llm.modelErrors.${error}`)}
              </p>
            )}
          </div>
          <div className="flex shrink-0 justify-end gap-2 border-t border-border/40 p-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={onClose}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" size="sm" className="h-8 text-xs" disabled={!modelId.trim()}>
              {t("llm.confirmModel")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

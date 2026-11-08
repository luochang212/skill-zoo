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
  const modelInputRef = useRef<HTMLInputElement>(null);
  const [modelId, setModelId] = useState(model.id);
  const normalizedModelId = modelId.trim();
  const [composing, setComposing] = useState(false);
  const [context, setContext] = useState(model.contextWindow?.toString() ?? "");
  const [output, setOutput] = useState(model.maxOutputTokens?.toString() ?? "");
  // Values typed this session are never cleared or overwritten. Values saved on
  // the model give way only when a lookup succeeds for the new ID; values a
  // lookup matched earlier in the session are stale on the next ID change.
  const manual = useRef({ context: false, output: false });
  const inherited = useRef({
    context: model.contextWindow != null,
    output: model.maxOutputTokens != null,
  });
  // The model ID whose configuration the replaceable fields currently show.
  const resolvedId = useRef<string | null>(
    inherited.current.context || inherited.current.output ? model.id.trim() : null,
  );
  const [error, setError] = useState<"modelId" | "contextWindow" | "maxOutputTokens" | null>(null);
  const identity = useMemo(() => ({}), [baseUrl, normalizedModelId, composing]);
  const activeIdentity = useRef(identity);
  activeIdentity.current = identity;
  useEffect(() => {
    let current = true;
    if (composing || !normalizedModelId || manual.current.context || manual.current.output) return;
    if (resolvedId.current === normalizedModelId) return;
    const timer = setTimeout(() => {
      void translationApi
        .resolveModel(baseUrl, normalizedModelId)
        .then((result) => {
          // A→B→A and closing are different editing sessions even when the final ID is identical.
          if (!current || activeIdentity.current !== identity) return;
          if (result) {
            if (!manual.current.context && result.contextWindow != null) {
              setContext(String(result.contextWindow));
              inherited.current.context = false;
            }
            if (!manual.current.output && result.maxOutputTokens != null) {
              setOutput(String(result.maxOutputTokens));
              inherited.current.output = false;
            }
            resolvedId.current = normalizedModelId;
            toast.success(t("llm.configurationMatched"), { id: `${id}-model-config` });
          }
        })
        .catch(() => undefined);
    }, 400);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [baseUrl, normalizedModelId, composing, context, output, identity, id, t]);
  const confirmModel = () => {
    const nextId = normalizedModelId;
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
    const next = {
      ...model,
      id: nextId,
      maxOutputTokens: nextOutput,
    };
    if (nextContext != null) next.contextWindow = nextContext;
    else delete next.contextWindow;
    onConfirm(next);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="flex max-h-[calc(100vh-4rem)] w-[calc(100vw-2rem)] max-w-[440px] flex-col gap-0 overflow-hidden p-0 sm:rounded-xl"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const input = modelInputRef.current;
          if (input) {
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
          }
        }}
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
          onSubmit={(event) => {
            // 回车不确认参数，避免输入法选字或快速输入提前关闭弹窗并取消自动匹配。
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <div className="min-h-0 space-y-5 overflow-y-auto p-4">
            <div className="space-y-2">
              <label htmlFor={`${id}-model`} className="block text-xs font-medium">
                {t("llm.modelIdentifier")}
              </label>
              <Input
                ref={modelInputRef}
                id={`${id}-model`}
                className="h-9 font-mono text-xs"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={modelId}
                aria-invalid={error === "modelId"}
                onCompositionStart={() => setComposing(true)}
                onCompositionEnd={() => setComposing(false)}
                onChange={(event) => {
                  setModelId(event.target.value);
                  if (event.target.value.trim() === normalizedModelId) return;
                  setError(null);
                  // Only values a lookup matched in this session are stale when
                  // the ID changes; hand-typed and saved values must survive.
                  if (!manual.current.context && !inherited.current.context) setContext("");
                  if (!manual.current.output && !inherited.current.output) setOutput("");
                }}
              />
            </div>
            <div className="space-y-5">
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
                      manual.current[manualKey] = Boolean(event.target.value.trim());
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
            <Button
              type="button"
              onClick={confirmModel}
              size="sm"
              className="h-8 text-xs"
              disabled={!normalizedModelId}
            >
              {t("llm.confirmModel")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

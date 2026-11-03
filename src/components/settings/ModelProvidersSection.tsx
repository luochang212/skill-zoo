import { useContext, useEffect, useId, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowRight, Eye, EyeOff, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ModelEditorDialog } from "./ModelEditorDialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { SettingsPickerContext, SettingsSelect } from "./SettingsSelect";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  PROVIDERS_KEY,
  useDeleteSkillProvider,
  useSkillProviders,
  useSaveSkillProvider,
} from "@/hooks/useSkillProviders";
import {
  translationApi,
  type LlmProtocol,
  type LlmProvider,
  type LlmModel,
  type ProviderUpdate,
} from "@/lib/api/translation";
import { translationErrorCode } from "@/lib/translation";

export interface ProviderTemplate {
  name: string;
  protocol: LlmProtocol;
  baseUrl: string;
}

export const providerTemplates: ProviderTemplate[] = [
  {
    name: "OpenAI",
    protocol: "openai-responses",
    baseUrl: "https://api.openai.com/v1/",
  },
  {
    name: "Anthropic",
    protocol: "anthropic-messages",
    baseUrl: "https://api.anthropic.com/v1/",
  },
  {
    name: "DeepSeek",
    protocol: "openai-chat-completions",
    baseUrl: "https://api.deepseek.com/v1/",
  },
  {
    name: "ZCode",
    protocol: "openai-chat-completions",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4/",
  },
  {
    name: "Moonshot",
    protocol: "openai-chat-completions",
    baseUrl: "https://api.moonshot.cn/v1/",
  },
  { name: "Custom", protocol: "openai-chat-completions", baseUrl: "" },
];

export function ProviderTemplatePicker({
  onSelect,
}: {
  onSelect: (template: ProviderTemplate) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {providerTemplates.map((template) => {
        const custom = template.name === "Custom";
        const name = custom ? t("llm.customTemplate") : template.name;
        return (
          <button
            key={template.name}
            type="button"
            aria-label={name}
            className={cn(
              "flex min-h-20 min-w-0 items-center gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              custom
                ? "border-blue-500/15 bg-blue-500/[0.04] hover:border-blue-500/25 hover:bg-blue-500/[0.075]"
                : "border-teal-500/20 bg-teal-500/5 hover:border-teal-500/30 hover:bg-teal-500/10",
            )}
            onClick={() => onSelect(template)}
          >
            <span
              aria-hidden="true"
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold",
                custom
                  ? "bg-blue-500/[0.075] text-blue-600/85 dark:text-blue-400/85"
                  : "bg-teal-500/10 text-teal-700 dark:text-teal-400",
              )}
            >
              {custom ? <Plus className="h-4 w-4" /> : template.name.slice(0, 1)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium">{name}</span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">
                {custom ? t("llm.customTemplateHint") : new URL(template.baseUrl).host}
              </span>
            </span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

export function ModelProvidersSection({
  onAdd,
  initialProviderId,
}: {
  onAdd: () => void;
  initialProviderId?: string | null;
}) {
  const { t } = useTranslation();
  const providers = useSkillProviders();
  const onPickerOpenChange = useContext(SettingsPickerContext);
  const remove = useDeleteSkillProvider();
  const qc = useQueryClient();
  const recover = useMutation({
    mutationFn: translationApi.recoverProviders,
    onSuccess: () => qc.invalidateQueries({ queryKey: PROVIDERS_KEY }),
  });
  const [deleting, setDeleting] = useState<LlmProvider | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(initialProviderId ?? null);
  const selected = providers.data?.find((p) => p.id === selectedId) ?? providers.data?.[0];
  const navigationRef = useRef<HTMLElement>(null);
  useEffect(() => {
    navigationRef.current
      ?.querySelector<HTMLElement>('[aria-current="true"]')
      ?.scrollIntoView?.({ block: "nearest" });
  }, [selected?.id]);
  const save = useSaveSkillProvider();
  const formId = useId();
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<{ id: string } | "add" | null>(null);
  const navigate = (next: { id: string } | "add") => {
    if (dirty) {
      setPendingNavigation(next);
      return;
    }
    save.reset();
    if (next === "add") onAdd();
    else setSelectedId(next.id);
  };
  const resetDraft = () => {
    save.reset();
    setRevision((value) => value + 1);
    setDirty(false);
  };
  return (
    <section className="flex min-h-0 flex-col">
      {providers.isPending ? (
        <p className="text-xs">{t("loading")}</p>
      ) : providers.isError ? (
        <div className="space-y-2 text-xs" role="status">
          <p>
            {t(`translation.errors.${translationErrorCode(providers.error)}`, {
              defaultValue: t("translation.errors.configRead"),
            })}
          </p>
          <Button size="sm" variant="outline" onClick={() => providers.refetch()}>
            {t("translation.retry")}
          </Button>
          {translationErrorCode(providers.error) === "configCorrupt" && (
            <Button size="sm" variant="outline" onClick={() => setRecovering(true)}>
              {t("llm.recover")}
            </Button>
          )}
        </div>
      ) : providers.data?.length ? (
        <div className="grid max-h-[min(560px,calc(100vh-12rem))] min-h-0 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] sm:grid-cols-[180px_minmax(0,1fr)] sm:grid-rows-[minmax(0,1fr)]">
          <div className="relative flex min-h-0 flex-col border-b border-border/50 sm:border-b-0 sm:border-r">
            <div className="flex min-h-0 flex-col sm:absolute sm:inset-0">
              <div className="max-h-36 min-h-0 overflow-y-auto sm:max-h-none sm:flex-1">
                <nav ref={navigationRef} aria-label={t("llm.services")} className="space-y-1 p-2">
                  {providers.data.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      aria-label={t("llm.editNamed", { name: p.name })}
                      aria-current={selected?.id === p.id ? "true" : undefined}
                      disabled={save.isPending}
                      className={cn(
                        "flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-muted/60 disabled:opacity-50",
                        selected?.id === p.id && "bg-muted",
                      )}
                      onClick={() => {
                        if (p.id !== selected?.id) navigate({ id: p.id });
                      }}
                    >
                      <span
                        aria-hidden="true"
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-xs font-medium"
                      >
                        {p.name.slice(0, 1)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">{p.name}</span>
                        <span className="mt-1 block truncate text-xs text-muted-foreground">
                          {p.enabled
                            ? t("llm.enabledModels", {
                                count: p.models.filter((m) => m.enabled).length,
                              })
                            : t("llm.disabled")}
                        </span>
                      </span>
                    </button>
                  ))}
                </nav>
              </div>
              <div className="shrink-0 border-t border-border/40 p-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={save.isPending}
                  className="h-8 w-full gap-1.5 text-xs"
                  onClick={() => navigate("add")}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("llm.add")}
                </Button>
              </div>
            </div>
          </div>
          {selected && (
            <div className="flex min-h-0 min-w-0 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="space-y-5 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="min-w-0 truncate text-sm font-semibold">{selected.name}</h3>
                    <DropdownMenu onOpenChange={onPickerOpenChange}>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          aria-label={t("llm.moreNamed", { name: selected.name })}
                          disabled={save.isPending}
                        >
                          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setDeleting(selected)}>
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          {t("llm.deleteNamed", { name: selected.name })}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <ProviderEditor
                    key={`${selected.id}-${revision}`}
                    provider={selected}
                    formId={formId}
                    error={save.error}
                    onDirty={() => setDirty(true)}
                    onSave={(update) => save.mutate(update, { onSuccess: resetDraft })}
                  />
                </div>
              </div>
              <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border/40 p-3">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  disabled={save.isPending}
                  onClick={resetDraft}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  type="submit"
                  form={formId}
                  size="sm"
                  className="h-8 text-xs"
                  disabled={save.isPending}
                >
                  {t("llm.save")}
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("llm.empty")}</p>
      )}
      <Dialog
        open={pendingNavigation !== null}
        onOpenChange={(open) => {
          if (!open) setPendingNavigation(null);
        }}
      >
        <DialogContent>
          <DialogTitle>{t("llm.unsavedTitle")}</DialogTitle>
          <DialogDescription>{t("llm.unsavedHint")}</DialogDescription>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPendingNavigation(null)}
            >
              {t("llm.keepEditing")}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                const next = pendingNavigation;
                setPendingNavigation(null);
                resetDraft();
                if (next === "add") onAdd();
                else if (next) setSelectedId(next.id);
              }}
            >
              {t("llm.discardChanges")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null);
            remove.reset();
          }
        }}
      >
        <DialogContent>
          <DialogTitle>{t("llm.deleteNamed", { name: deleting?.name })}</DialogTitle>
          <DialogDescription>{t("llm.deleteHint")}</DialogDescription>
          {remove.isError && (
            <p role="status" className="text-xs">
              {t("translation.errors.configWrite")}
            </p>
          )}
          <Button
            disabled={remove.isPending}
            onClick={() =>
              deleting && remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })
            }
          >
            {t("llm.confirmDelete")}
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog open={recovering} onOpenChange={setRecovering}>
        <DialogContent>
          <DialogTitle>{t("llm.recover")}</DialogTitle>
          <DialogDescription>{t("llm.recoverHint")}</DialogDescription>
          {recover.isError && <p role="status">{t("translation.errors.configWrite")}</p>}
          <Button
            disabled={recover.isPending}
            onClick={() => recover.mutate(undefined, { onSuccess: () => setRecovering(false) })}
          >
            {t("llm.recover")}
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function ProviderEditor({
  provider,
  error,
  onSave,
  template,
  formId,
  onDirty,
}: {
  provider: LlmProvider | null;
  template?: ProviderTemplate;
  formId: string;
  onDirty?: () => void;
  error: unknown;
  onSave: (p: ProviderUpdate) => void;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const [draft, updateDraft] = useState<ProviderUpdate>(() => ({
    id: provider?.id ?? null,
    name:
      provider?.name ?? (template?.name === "Custom" ? t("llm.custom") : (template?.name ?? "")),
    enabled: provider?.enabled ?? true,
    protocol: provider?.protocol ?? template?.protocol ?? "openai-chat-completions",
    baseUrl: provider?.baseUrl ?? template?.baseUrl ?? "",
    apiKey: null,
    models: provider?.models ?? [],
  }));
  const setDraft = (next: ProviderUpdate) => {
    updateDraft(next);
    onDirty?.();
  };
  const [keyMode, updateKeyMode] = useState(provider?.hasApiKey ? "unchanged" : "replace");
  const setKeyMode = (next: string) => {
    updateKeyMode(next);
    onDirty?.();
  };
  const [keyVisible, setKeyVisible] = useState(false);
  const [editingModel, setEditingModel] = useState<{
    index: number | null;
    model: LlmModel;
  } | null>(null);
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const fieldError = error ? translationErrorCode(error) : null;
  const field = (name: string) => `${uid}-${name}`;
  const addModel = (trigger: HTMLButtonElement) => {
    modelTriggerRef.current = trigger;
    setEditingModel({ index: null, model: { id: "", enabled: true, maxOutputTokens: null } });
  };
  return (
    <form
      id={formId}
      className="@container space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          ...draft,
          apiKey: keyMode === "clear" ? "" : keyMode === "replace" ? (draft.apiKey ?? "") : null,
        });
      }}
    >
      <div className="flex items-end gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <label className="block text-xs font-medium" htmlFor={field("name")}>
            {t("llm.name")}
          </label>
          <Input
            className="h-9 text-xs"
            id={field("name")}
            name="name"
            required
            value={draft.name}
            aria-invalid={fieldError === "name"}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>
        <Switch
          className="mb-1.5"
          aria-label={t("llm.enabled")}
          checked={draft.enabled}
          onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
        />
      </div>
      <div className="grid gap-5 @min-[480px]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <SettingsSelect
          id={field("protocol")}
          label={t("llm.protocol")}
          value={draft.protocol}
          options={(
            ["openai-chat-completions", "openai-responses", "anthropic-messages"] as const
          ).map((value) => ({
            value,
            label: {
              "openai-chat-completions": "OpenAI Chat Completions",
              "openai-responses": "OpenAI Responses",
              "anthropic-messages": "Anthropic Messages",
            }[value],
          }))}
          onValueChange={(protocol) => setDraft({ ...draft, protocol: protocol as LlmProtocol })}
        />
        <div className="space-y-2">
          <label className="block text-xs font-medium" htmlFor={field("baseUrl")}>
            {t("llm.baseUrl")}
          </label>
          <Input
            className="h-9 text-xs"
            id={field("baseUrl")}
            name="baseUrl"
            required
            type="url"
            value={draft.baseUrl}
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={fieldError === "baseUrl"}
            onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
          />
        </div>
      </div>
      <div className="space-y-2">
        <label
          className="block text-xs font-medium"
          htmlFor={keyMode === "replace" ? field("key") : undefined}
        >
          {t(provider?.hasApiKey && keyMode === "replace" ? "llm.newKey" : "llm.apiKey")}
        </label>
        {keyMode === "replace" ? (
          <div className="relative">
            <Input
              className="h-9 pr-10 text-xs"
              id={field("key")}
              type={keyVisible ? "text" : "password"}
              autoComplete="new-password"
              spellCheck={false}
              value={draft.apiKey ?? ""}
              placeholder={t("llm.keyPlaceholder")}
              onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
            />
            <button
              type="button"
              className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t(keyVisible ? "llm.hideKey" : "llm.showKey")}
              onClick={() => setKeyVisible(!keyVisible)}
            >
              {keyVisible ? (
                <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t(keyMode === "clear" ? "llm.keyWillClear" : "llm.keyConfigured")}
          </p>
        )}
        {provider?.hasApiKey && (
          <div className="flex gap-3">
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setKeyMode(keyMode === "unchanged" ? "replace" : "unchanged")}
            >
              {t(keyMode === "unchanged" ? "llm.replaceKey" : "common.cancel")}
            </button>
            {keyMode !== "clear" && (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-destructive"
                onClick={() => setKeyMode("clear")}
              >
                {t("llm.clearKey")}
              </button>
            )}
          </div>
        )}
      </div>
      <div
        role="group"
        aria-labelledby={field("models")}
        className="min-w-0 space-y-2 border-t border-border/50 pt-4"
      >
        <div className="flex items-center justify-between gap-3">
          <h4 id={field("models")} className="text-xs font-medium">
            {t("llm.models")}
          </h4>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 shrink-0 gap-1.5 text-xs"
            onClick={(event) => addModel(event.currentTarget)}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {t("llm.addModel")}
          </Button>
        </div>
        {draft.models.map((model, i) => (
          <div
            key={i}
            className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-xs">{model.id}</p>
              {(model.contextWindow || model.maxOutputTokens) && (
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {[
                    model.contextWindow && t("llm.contextSummary", { count: model.contextWindow }),
                    model.maxOutputTokens &&
                      t("llm.outputSummary", { count: model.maxOutputTokens }),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            </div>
            <button
              type="button"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t("llm.editModelNamed", { name: model.id })}
              onClick={(event) => {
                modelTriggerRef.current = event.currentTarget;
                setEditingModel({ index: i, model });
              }}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            {!model.enabled && (
              <span className="shrink-0 text-xs text-muted-foreground">{t("llm.disabled")}</span>
            )}
            <button
              type="button"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t("llm.removeModel", { index: i + 1 })}
              onClick={() => setDraft({ ...draft, models: draft.models.filter((_, j) => j !== i) })}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      {editingModel && (
        <ModelEditorDialog
          mode={editingModel.index === null ? "add" : "edit"}
          model={editingModel.model}
          baseUrl={draft.baseUrl}
          otherModelIds={draft.models
            .filter((_, index) => index !== editingModel.index)
            .map((model) => model.id)}
          returnFocusRef={modelTriggerRef}
          onClose={() => setEditingModel(null)}
          onConfirm={(model) => {
            setDraft({
              ...draft,
              models:
                editingModel.index === null
                  ? [...draft.models, model]
                  : draft.models.map((item, index) =>
                      index === editingModel.index ? model : item,
                    ),
            });
            setEditingModel(null);
          }}
        />
      )}
      {fieldError && (
        <p role="status" className="text-xs text-destructive">
          {t(`translation.errors.${fieldError}`, {
            defaultValue: t("translation.errors.configWrite"),
          })}
        </p>
      )}
    </form>
  );
}

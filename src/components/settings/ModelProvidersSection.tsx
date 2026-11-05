import {
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowRight,
  Cable,
  Eye,
  EyeOff,
  Info,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
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

export type ProviderNavigationGuard = (action: () => void) => void;

export const providerTemplates: ProviderTemplate[] = [
  {
    name: "OpenAI",
    protocol: "openai-responses",
    baseUrl: "https://api.openai.com/v1/",
  },
  {
    name: "DeepSeek",
    protocol: "openai-chat-completions",
    baseUrl: "https://api.deepseek.com/v1/",
  },
  {
    name: "Volcengine",
    protocol: "openai-chat-completions",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3/",
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
              <span className="block text-base font-semibold">{name}</span>
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
  navigationGuardRef,
}: {
  navigationGuardRef?: RefObject<ProviderNavigationGuard | null>;
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = providers.data?.find((p) => p.id === selectedId) ?? providers.data?.[0];
  const [addPage, setAddPage] = useState<"templates" | ProviderTemplate | null>(null);
  const adding = addPage !== null || !selected;
  const newTemplate = addPage && addPage !== "templates" ? addPage : null;
  const choosingTemplate = adding && !newTemplate;
  const createdId = useRef<string | null>(null);
  const editing: LlmProvider | undefined = newTemplate
    ? {
        id: "",
        name: newTemplate.name === "Custom" ? t("llm.custom") : newTemplate.name,
        protocol: newTemplate.protocol,
        baseUrl: newTemplate.baseUrl,
        enabled: true,
        hasApiKey: false,
        models: [],
      }
    : selected;
  const navigationRef = useRef<HTMLElement>(null);
  useEffect(() => {
    navigationRef.current
      ?.querySelector<HTMLElement>('[aria-current="true"]')
      ?.scrollIntoView?.({ block: "nearest" });
  }, [selected?.id, newTemplate]);
  const save = useSaveSkillProvider();
  const formId = useId();
  const [revision, setRevision] = useState(0);
  const dirtyRef = useRef(false);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null);
  const updateDirty = (next: boolean) => {
    if (next && save.isError) save.reset();
    dirtyRef.current = next;
  };
  const saveDraft = (update: ProviderUpdate) => {
    const next = saveQueue.current
      .catch(() => undefined)
      .then(async () => {
        const id = update.id ?? createdId.current;
        const updated = await save.mutateAsync({ ...update, id });
        if (!id) {
          const added = updated.find((item) => !providers.data?.some((old) => old.id === item.id));
          createdId.current = added?.id ?? null;
          setSelectedId(createdId.current);
          setAddPage(null);
        }
        return updated;
      });
    saveQueue.current = next;
    return next;
  };
  const navigate = async (action: () => void) => {
    const form = document.getElementById(formId);
    if (form?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    let pending;
    do {
      pending = saveQueue.current;
      // Wait for ordered writes, including edits queued during the previous write.
      // eslint-disable-next-line no-await-in-loop
      await pending.catch(() => undefined);
    } while (pending !== saveQueue.current);
    if (dirtyRef.current) {
      setPendingNavigation(() => action);
      return;
    }
    save.reset();
    action();
  };
  useEffect(() => {
    if (!navigationGuardRef) return;
    navigationGuardRef.current = navigate;
    return () => {
      navigationGuardRef.current = null;
    };
  });
  const resetDraft = () => {
    save.reset();
    setRevision((value) => value + 1);
    updateDirty(false);
  };
  return (
    <section
      className={cn("flex min-h-0 flex-col", (providers.isPending || providers.isError) && "p-4")}
    >
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
      ) : (
        <div
          className={cn(
            "grid max-h-[min(560px,calc(100vh-12rem))] min-h-0 grid-cols-1",
            !choosingTemplate &&
              "grid-rows-[auto_minmax(0,1fr)] sm:grid-cols-[180px_minmax(0,1fr)] sm:grid-rows-[minmax(0,1fr)]",
          )}
        >
          {!choosingTemplate && (
            <div className="relative flex min-h-0 flex-col border-b border-border/50 sm:border-b-0 sm:border-r">
              <div className="flex min-h-0 flex-col sm:absolute sm:inset-0">
                <div className="max-h-36 min-h-0 overflow-y-auto sm:max-h-none sm:flex-1">
                  <nav ref={navigationRef} aria-label={t("llm.services")} className="space-y-1 p-2">
                    {providers.data?.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        aria-label={t("llm.editNamed", { name: p.name })}
                        aria-current={!adding && selected?.id === p.id ? "true" : undefined}
                        className={cn(
                          "flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-muted/60 disabled:opacity-50",
                          !adding && selected?.id === p.id && "bg-muted",
                        )}
                        onClick={() => {
                          if (adding || p.id !== selected?.id)
                            void navigate(() => {
                              setAddPage(null);
                              setSelectedId(p.id);
                              setRevision((value) => value + 1);
                            });
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
                    {newTemplate && (
                      <div aria-current="true" className="rounded-lg bg-muted px-2 py-2.5 text-xs">
                        <span className="block truncate font-medium">
                          {newTemplate.name === "Custom" ? t("llm.custom") : newTemplate.name}
                        </span>
                        <span className="mt-1 block text-muted-foreground">
                          {t("llm.notSaved")}
                        </span>
                      </div>
                    )}
                  </nav>
                </div>
                <div className="shrink-0 border-t border-border/40 p-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 w-full gap-1.5 text-xs"
                    onClick={() => void navigate(() => setAddPage("templates"))}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    {t("llm.add")}
                  </Button>
                </div>
              </div>
            </div>
          )}
          {choosingTemplate ? (
            <div className="min-h-0 overflow-y-auto p-4">
              {selected && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="mb-3 gap-1.5 text-xs"
                  onClick={() => setAddPage(null)}
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("aiSettings.backToProviders")}
                </Button>
              )}
              <p className="mb-4 text-xs text-muted-foreground">{t("llm.chooseService")}</p>
              <ProviderTemplatePicker
                onSelect={(template) => {
                  save.reset();
                  createdId.current = null;
                  setAddPage(template);
                }}
              />
            </div>
          ) : (
            editing && (
              <div className="flex min-h-0 min-w-0 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <div className="space-y-5 p-4">
                    <ProviderEditor
                      key={revision}
                      provider={newTemplate ? null : (selected ?? null)}
                      template={newTemplate ?? undefined}
                      formId={formId}
                      error={save.error}
                      onDirty={updateDirty}
                      onSave={saveDraft}
                      headerActions={
                        <DropdownMenu onOpenChange={onPickerOpenChange}>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              aria-label={t("llm.moreNamed", { name: editing.name })}
                              disabled={save.isPending}
                            >
                              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setDeleting(editing)}>
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              {t("llm.deleteNamed", { name: editing.name })}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      }
                    />
                  </div>
                </div>
                {(save.isPending || save.isError) && (
                  <div className="flex shrink-0 items-center justify-end gap-2 p-3">
                    <p
                      role="status"
                      className={cn(
                        "text-xs",
                        save.isError ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {t(save.isPending ? "saving" : "llm.saveFailed")}
                    </p>
                    {save.isError && (
                      <Button
                        type="submit"
                        form={formId}
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                      >
                        {t("translation.retry")}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )
          )}
        </div>
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
                next?.();
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
            onClick={async () => {
              if (!deleting) return;
              await saveQueue.current.catch(() => undefined);
              const id = deleting.id || createdId.current;
              const finish = () => {
                setDeleting(null);
                resetDraft();
                if (!deleting.id) setAddPage("templates");
              };
              if (id) remove.mutate(id, { onSuccess: finish });
              else finish();
            }}
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
  headerActions,
}: {
  provider: LlmProvider | null;
  template?: ProviderTemplate;
  formId: string;
  onDirty?: (dirty: boolean) => void;
  headerActions: ReactNode;
  error: unknown;
  onSave: (p: ProviderUpdate) => void | Promise<unknown>;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const draftRevision = useRef(0);
  const connection = useMutation({ mutationFn: translationApi.testConnection, retry: false });
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
  const draftRef = useRef(draft);
  const submittedDraft = useRef<ProviderUpdate | null>(draft);
  useEffect(() => {
    if (!provider?.id || draftRef.current.id === provider.id) return;
    const next = { ...draftRef.current, id: provider.id };
    if (submittedDraft.current === draftRef.current) submittedDraft.current = next;
    draftRef.current = next;
    updateDraft(next);
  }, [provider?.id]);
  const formRef = useRef<HTMLFormElement>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const commit = (next: ProviderUpdate, retry = false) => {
    if (keyLoading || savedKey.isError) return;
    if (!retry && submittedDraft.current === next) return;
    if (!formRef.current?.checkValidity()) {
      setValidationError(
        formRef.current?.querySelector<HTMLInputElement>(":invalid")?.name ?? "baseUrl",
      );
      return;
    }
    setValidationError(null);
    submittedDraft.current = next;
    const revision = draftRevision.current;
    void Promise.resolve(onSave({ ...next, id: provider?.id ?? next.id }))
      .then(() => {
        if (draftRevision.current === revision) onDirty?.(false);
      })
      .catch(() => undefined);
  };
  const setDraft = (next: ProviderUpdate, completed = false) => {
    draftRevision.current += 1;
    draftRef.current = next;
    updateDraft(next);
    setValidationError(null);
    onDirty?.(true);
    if (completed) commit(next);
  };
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const renaming = nameDraft !== null;
  const renameTrigger = useRef<HTMLButtonElement>(null);
  const restoreNameFocus = useRef(false);
  const nameComposing = useRef(false);
  const cancelRename = useRef(false);
  useEffect(() => {
    if (!renaming && restoreNameFocus.current) {
      renameTrigger.current?.focus();
      restoreNameFocus.current = false;
    }
  }, [renaming]);
  const confirmName = () => {
    if (cancelRename.current) return;
    const name = nameDraft?.trim();
    if (name && name !== draft.name) setDraft({ ...draft, name }, true);
    setNameDraft(null);
  };
  const savedKey = useQuery({
    queryKey: ["llmProviderApiKey", provider?.id],
    queryFn: () => translationApi.providerApiKey(provider!.id),
    enabled: !!provider,
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const [keyVisible, setKeyVisible] = useState(false);
  const keyValue = draft.apiKey ?? savedKey.data ?? "";
  const keyLoading = !!provider && savedKey.isPending;
  const [editingModel, setEditingModel] = useState<{
    index: number | null;
    model: LlmModel;
  } | null>(null);
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const fieldError = savedKey.error
    ? "configRead"
    : (validationError ?? (error ? translationErrorCode(error) : null));
  const field = (name: string) => `${uid}-${name}`;
  const addModel = (trigger: HTMLButtonElement) => {
    modelTriggerRef.current = trigger;
    setEditingModel({ index: null, model: { id: "", enabled: true, maxOutputTokens: null } });
  };
  return (
    <form
      ref={formRef}
      id={formId}
      className="@container space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (keyLoading || savedKey.isError) return;
        commit(draftRef.current, true);
      }}
    >
      <fieldset disabled={keyLoading || savedKey.isError} className="min-w-0 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <h3 aria-label={draft.name} className="min-w-0 flex-1 text-sm font-semibold">
            {renaming ? (
              <Input
                data-provider-rename
                aria-label={t("llm.name")}
                autoFocus
                className="h-8 max-w-xs text-sm font-semibold"
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                onBlur={confirmName}
                onCompositionStart={() => {
                  nameComposing.current = true;
                }}
                onCompositionEnd={() => {
                  nameComposing.current = false;
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (
                      nameComposing.current ||
                      event.nativeEvent.isComposing ||
                      event.nativeEvent.keyCode === 229
                    )
                      return;
                    restoreNameFocus.current = true;
                    confirmName();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    restoreNameFocus.current = true;
                    setNameDraft(null);
                  }
                }}
              />
            ) : (
              <button
                ref={renameTrigger}
                type="button"
                aria-label={t("llm.renameProvider")}
                title={t("llm.renameProvider")}
                className="group flex max-w-full items-center gap-1.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  nameComposing.current = false;
                  cancelRename.current = false;
                  setNameDraft(draft.name);
                }}
              >
                <span className="truncate">{draft.name}</span>
                <Pencil
                  className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                  aria-hidden="true"
                />
              </button>
            )}
          </h3>
          <div className="flex shrink-0 items-center gap-2">
            <Switch
              aria-label={t("llm.enabled")}
              checked={draft.enabled}
              onCheckedChange={(enabled) => setDraft({ ...draft, enabled }, true)}
            />
            {headerActions}
          </div>
        </div>
        <div className="space-y-5">
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
              onBlur={() => {
                commit(draftRef.current);
              }}
              aria-describedby={fieldError === "baseUrl" ? field("error") : undefined}
            />
          </div>
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
            onValueChange={(protocol) =>
              setDraft({ ...draft, protocol: protocol as LlmProtocol }, true)
            }
          />
        </div>
        <div className="space-y-2">
          <label className="block text-xs font-medium" htmlFor={field("key")}>
            {t("llm.apiKey")}
          </label>
          <div className="relative">
            <Input
              className="h-9 pr-10 text-xs"
              id={field("key")}
              type={keyVisible ? "text" : "password"}
              disabled={keyLoading || savedKey.isError}
              autoComplete="new-password"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={keyValue}
              placeholder={t("llm.keyPlaceholder")}
              onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
              onBlur={() => {
                commit(draftRef.current);
              }}
            />
            <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1">
              {keyValue && (
                <button
                  type="button"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={t(keyVisible ? "llm.hideKey" : "llm.showKey")}
                  onClick={() => setKeyVisible(!keyVisible)}
                >
                  {keyVisible ? (
                    <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </button>
              )}
            </div>
          </div>
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
          {draft.models.length === 0 && (
            <div className="flex min-h-12 items-center gap-2 rounded-lg border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
              <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
              <p>{t("llm.modelsEmpty")}</p>
            </div>
          )}
          {draft.models.map((model, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-xs">{model.id}</p>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                aria-label={t("llm.testNamed", { name: model.id })}
                aria-busy={connection.isPending && connection.variables?.modelId === model.id}
                title={
                  connection.isPending && connection.variables?.modelId === model.id
                    ? t("llm.testing")
                    : t("llm.testHint", { tokens: draft.protocol === "openai-responses" ? 16 : 1 })
                }
                disabled={connection.isPending || keyLoading || savedKey.isError}
                onClick={() => {
                  const revision = draftRevision.current;
                  connection.mutate(
                    {
                      provider: draft,
                      modelId: model.id,
                    },
                    {
                      onSuccess: (ms) => {
                        if (revision === draftRevision.current)
                          toast.success(t("llm.testSuccess", { name: model.id, ms }));
                      },
                      onError: (testError) => {
                        if (revision === draftRevision.current)
                          toast.error(
                            t("llm.testFailed", {
                              name: model.id,
                              reason: t(`translation.errors.${translationErrorCode(testError)}`, {
                                defaultValue: t("translation.errors.providerResponse"),
                              }),
                            }),
                          );
                      },
                    },
                  );
                }}
              >
                {connection.isPending && connection.variables?.modelId === model.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Cable className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </Button>
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
                onClick={() =>
                  setDraft({ ...draft, models: draft.models.filter((_, j) => j !== i) }, true)
                }
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
            protocol={draft.protocol}
            otherModelIds={draft.models
              .filter((_, index) => index !== editingModel.index)
              .map((model) => model.id)}
            returnFocusRef={modelTriggerRef}
            onClose={() => setEditingModel(null)}
            onConfirm={(model) => {
              setDraft(
                {
                  ...draft,
                  models:
                    editingModel.index === null
                      ? [...draft.models, model]
                      : draft.models.map((item, index) =>
                          index === editingModel.index ? model : item,
                        ),
                },
                true,
              );
              setEditingModel(null);
            }}
          />
        )}
      </fieldset>
      {fieldError && (
        <p id={field("error")} role="status" className="text-xs text-destructive">
          {t(`translation.errors.${fieldError}`, {
            defaultValue: t("translation.errors.configWrite"),
          })}
        </p>
      )}
      {savedKey.isError && (
        <Button type="button" size="sm" variant="outline" onClick={() => savedKey.refetch()}>
          {t("translation.retry")}
        </Button>
      )}
    </form>
  );
}

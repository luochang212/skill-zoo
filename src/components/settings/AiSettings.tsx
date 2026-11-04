import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { ArrowLeft, Cpu, Languages, ListTree, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useSaveSkillProvider,
  useSkillProviders,
  useTranslationPreferences,
} from "@/hooks/useSkillProviders";
import { translationLanguages } from "@/lib/translation";
import { cn } from "@/lib/utils";
import type { LlmProvider } from "@/lib/api/translation";
import {
  ModelProvidersSection,
  ProviderEditor,
  ProviderTemplatePicker,
  type ProviderTemplate,
  type ProviderNavigationGuard,
} from "./ModelProvidersSection";
import { TranslationSettings } from "./TranslationSettings";
import { SettingsPickerContext } from "./SettingsSelect";

type SettingsPage = "providers" | "translation";
type DetailPage =
  | { kind: SettingsPage | "templates" }
  | {
      kind: "editor";
      provider: LlmProvider | null;
      template?: ProviderTemplate;
      returnTo: "providers" | "templates";
    };

/** Two independent entry rows; configuration forms only mount inside the detail dialog. */
export function AiSettingsRows() {
  const { t } = useTranslation();
  const providers = useSkillProviders();
  const preferences = useTranslationPreferences();
  const [page, setPage] = useState<SettingsPage | null>(null);
  const returnFocusRef = useRef<HTMLButtonElement>(null);
  const selected = providers.data?.find((p) => p.id === preferences.data?.providerId && p.enabled);
  const model = selected?.models.find((m) => m.id === preferences.data?.modelId && m.enabled);
  const language = translationLanguages.find(
    ([id]) => id === preferences.data?.targetLanguage,
  )?.[1];
  const providerSummary = providers.isPending
    ? t("loading")
    : providers.isError
      ? t("translation.errors.configRead")
      : t("llm.rowSummary", { count: providers.data?.length ?? 0 });
  const translationSummary =
    preferences.isPending || providers.isPending
      ? t("loading")
      : preferences.isError || providers.isError
        ? t("translation.errors.configRead")
        : selected && model
          ? `${selected.name} · ${model.id} · ${language ?? t("translation.deviceLanguage")}`
          : t(
              preferences.data?.providerId
                ? "translation.unavailableModel"
                : "translation.chooseModel",
            );

  return (
    <>
      {(
        [
          {
            page: "providers",
            title: t("llm.title"),
            summary: providerSummary,
            Icon: Cpu,
          },
          {
            page: "translation",
            title: t("translation.settings"),
            summary: translationSummary,
            Icon: Languages,
          },
        ] as const
      ).map(({ page: targetPage, title, summary, Icon }) => (
        <div
          key={targetPage}
          className="group flex items-center justify-between gap-4 rounded-xl border border-border bg-card/50 p-4 transition-colors hover:bg-muted/50"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border">
              <Icon className="h-4 w-4 text-[#a66f82] dark:text-[#c49aaa]" aria-hidden="true" />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium leading-none">{title}</p>
              <p className="truncate text-xs text-muted-foreground" title={summary}>
                {summary}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 shrink-0 gap-1.5 text-xs"
            aria-label={t("aiSettings.openNamed", { name: title })}
            onClick={(event) => {
              returnFocusRef.current = event.currentTarget;
              setPage(targetPage);
            }}
          >
            {targetPage === "providers" ? (
              <ListTree className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {t(targetPage === "providers" ? "aiSettings.manage" : "aiSettings.configure")}
          </Button>
        </div>
      ))}
      <AiSettingsDialog
        open={page !== null}
        initialPage={page ?? "translation"}
        onOpenChange={(open) => {
          if (!open) setPage(null);
        }}
        returnFocusRef={returnFocusRef}
      />
    </>
  );
}

export function AiSettingsDialog({
  open,
  onOpenChange,
  initialPage = "translation",
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPage?: SettingsPage;
  returnFocusRef?: RefObject<HTMLButtonElement | null>;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerOpenRef = useRef(false);
  const pickerOpenAtPointerDown = useRef(false);
  const providerNavigationRef = useRef<ProviderNavigationGuard | null>(null);
  const handlePickerOpenChange = (next: boolean) => {
    pickerOpenRef.current = next;
    setPickerOpen(next);
  };
  useEffect(() => {
    if (!open) {
      pickerOpenRef.current = false;
      pickerOpenAtPointerDown.current = false;
      setPickerOpen(false);
      return;
    }
    // Match Usage habits: Dialog handles the later click, after the menu has closed.
    const capture = () => {
      pickerOpenAtPointerDown.current = pickerOpenRef.current;
    };
    document.addEventListener("pointerdown", capture, true);
    return () => document.removeEventListener("pointerdown", capture, true);
  }, [open]);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pickerOpenAtPointerDown.current) {
          pickerOpenAtPointerDown.current = false;
          return;
        }
        if (!next && providerNavigationRef.current) {
          providerNavigationRef.current(() => onOpenChange(false));
        } else onOpenChange(next);
      }}
    >
      {open && (
        <AiSettingsDetail
          initialPage={initialPage}
          returnFocusRef={returnFocusRef}
          pickerOpen={pickerOpen}
          onPickerOpenChange={handlePickerOpenChange}
          pickerOpenAtPointerDown={pickerOpenAtPointerDown}
          providerNavigationRef={providerNavigationRef}
        />
      )}
    </Dialog>
  );
}

function AiSettingsDetail({
  initialPage,
  returnFocusRef,
  pickerOpen,
  onPickerOpenChange,
  pickerOpenAtPointerDown,
  providerNavigationRef,
}: {
  initialPage: SettingsPage;
  pickerOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
  pickerOpenAtPointerDown: RefObject<boolean>;
  providerNavigationRef: RefObject<ProviderNavigationGuard | null>;
  returnFocusRef?: RefObject<HTMLButtonElement | null>;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState<DetailPage>({ kind: initialPage });
  const [fromTranslation, setFromTranslation] = useState(false);
  const save = useSaveSkillProvider();
  const providers = useSkillProviders();
  const formId = useId();
  const [preferredProviderId, setPreferredProviderId] = useState<string | null>(null);
  const choosingFirstService =
    page.kind === "providers" &&
    !providers.isPending &&
    !providers.isError &&
    providers.data?.length === 0;
  const managingServices =
    page.kind === "providers" && !!providers.data?.length && !providers.isError;
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [page]);
  const back =
    page.kind === "editor"
      ? page.returnTo
      : page.kind === "templates"
        ? "providers"
        : page.kind === "providers" && fromTranslation
          ? "translation"
          : null;
  const title =
    page.kind === "editor"
      ? page.provider
        ? t("llm.edit")
        : page.template?.name === "Custom"
          ? t("llm.custom")
          : t("llm.connectService", { name: page.template?.name })
      : page.kind === "templates"
        ? t("llm.add")
        : t(page.kind === "providers" ? "llm.title" : "translation.settings");
  const description =
    page.kind === "templates" || choosingFirstService
      ? t("llm.chooseService")
      : page.kind === "editor"
        ? t("llm.connectionHint")
        : t(page.kind === "providers" ? "llm.listHint" : "translation.manualHint");
  const cancelEdit = () => {
    save.reset();
    if (back) setPage({ kind: back });
  };
  return (
    <SettingsPickerContext.Provider value={onPickerOpenChange}>
      <DialogContent
        onEscapeKeyDown={(event) => {
          if (
            pickerOpen ||
            (event.target instanceof HTMLElement &&
              event.target.hasAttribute("data-provider-rename"))
          )
            event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (pickerOpenAtPointerDown.current) {
            event.preventDefault();
            pickerOpenAtPointerDown.current = false;
          }
        }}
        className={cn(
          "flex w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:rounded-xl",
          page.kind === "translation"
            ? "max-w-[480px]"
            : managingServices
              ? "max-w-[684px]"
              : "max-w-[640px]",
          "max-h-[calc(100vh-6rem)]",
        )}
        data-selectable
        onCloseAutoFocus={(event) => {
          if (returnFocusRef?.current) {
            event.preventDefault();
            returnFocusRef.current.focus();
          }
        }}
      >
        <DialogHeader className="shrink-0 border-b border-border/50 px-4 py-4 text-left">
          <div className="flex items-center gap-2 pr-6">
            {back && (
              <button
                type="button"
                disabled={save.isPending}
                className="-my-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                aria-label={t(
                  back === "translation"
                    ? "aiSettings.backToTranslation"
                    : back === "templates" || (page.kind === "editor" && !page.provider)
                      ? "llm.backToServices"
                      : "aiSettings.backToProviders",
                )}
                onClick={() => {
                  if (managingServices && providerNavigationRef.current)
                    providerNavigationRef.current(cancelEdit);
                  else cancelEdit();
                }}
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
            <DialogTitle ref={headingRef} tabIndex={-1} className="outline-none">
              {title}
            </DialogTitle>
          </div>
          <DialogDescription className={cn("pr-5", back && "pl-10")}>
            {description}
          </DialogDescription>
        </DialogHeader>
        <div
          key={page.kind}
          className={cn("min-h-0", managingServices ? "overflow-hidden" : "overflow-y-auto")}
        >
          <div className={managingServices ? undefined : "space-y-4 p-4"}>
            {page.kind === "translation" && (
              <TranslationSettings
                onConfigureModels={() => {
                  setFromTranslation(true);
                  setPage({ kind: "providers" });
                }}
              />
            )}
            {(page.kind === "templates" || choosingFirstService) && (
              <ProviderTemplatePicker
                onSelect={(template) => {
                  save.reset();
                  setPage({
                    kind: "editor",
                    provider: null,
                    template,
                    returnTo: page.kind === "templates" ? "templates" : "providers",
                  });
                }}
              />
            )}
            {page.kind === "providers" && !choosingFirstService && (
              <ModelProvidersSection
                initialProviderId={preferredProviderId}
                onAdd={() => setPage({ kind: "templates" })}
                navigationGuardRef={providerNavigationRef}
              />
            )}
            {page.kind === "editor" && (
              <ProviderEditor
                key={page.provider?.id ?? page.template?.name}
                provider={page.provider}
                template={page.template}
                formId={formId}
                error={save.error}
                onSave={(provider) =>
                  save.mutate(provider, {
                    onSuccess: (updated) => {
                      const added = updated.find(
                        (item) => !providers.data?.some((old) => old.id === item.id),
                      );
                      setPreferredProviderId(added?.id ?? provider.id);
                      setPage({ kind: "providers" });
                    },
                  })
                }
              />
            )}
          </div>
        </div>
        {page.kind === "editor" && (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border/40 p-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              disabled={save.isPending}
              onClick={cancelEdit}
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
        )}
      </DialogContent>
    </SettingsPickerContext.Provider>
  );
}

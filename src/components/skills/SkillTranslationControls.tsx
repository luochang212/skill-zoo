import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Languages, ChevronDown, LoaderCircle, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { AiSettingsDialog } from "@/components/settings/AiSettings";
import { translationLanguages } from "@/lib/translation";
import type { useSkillTranslation } from "@/hooks/useSkillTranslation";
import { cn } from "@/lib/utils";

export function SkillTranslationControls({
  translation,
  language,
  setLanguage,
  unavailable,
  disabledReason,
  preferencePending,
}: {
  translation: ReturnType<typeof useSkillTranslation>;
  language: string;
  setLanguage: (language: string) => void;
  unavailable: boolean;
  disabledReason?: string;
  preferencePending: boolean;
}) {
  const { t } = useTranslation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const streaming = translation.status === "streaming";
  const label = translationLanguages.find(([id]) => id === language)?.[1] ?? language;
  return (
    <>
      <span aria-hidden="true" className="mx-0.5 h-3.5 w-px shrink-0 bg-border/70" />
      <DropdownMenu>
        <span
          className={cn(
            "inline-flex h-7 shrink-0 items-center overflow-hidden rounded-xl border border-border/60 text-[11px] font-medium text-muted-foreground",
            translation.showTranslation && "bg-muted text-foreground",
          )}
        >
          <button
            type="button"
            disabled={!!disabledReason || preferencePending || streaming}
            title={
              disabledReason ??
              (translation.showTranslation
                ? t("translation.showing", { language: label })
                : t("translation.translateTo", { language: label }))
            }
            className="inline-flex h-full items-center justify-center gap-1 px-2 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 focus-visible:outline-none"
            onClick={() => {
              if (translation.text) translation.toggle();
              else if (unavailable) setSettingsOpen(true);
              else void translation.translate();
            }}
          >
            {streaming ? (
              <LoaderCircle
                aria-hidden="true"
                className="h-3 w-3 shrink-0 animate-spin motion-reduce:animate-none"
              />
            ) : (
              <Languages aria-hidden="true" className="h-3 w-3 shrink-0" />
            )}
            <span className="truncate">
              {t(
                streaming
                  ? "translation.button"
                  : translation.showTranslation
                    ? "translation.original"
                    : translation.text
                      ? "translation.translated"
                      : "translation.button",
              )}
            </span>
          </button>
          <span aria-hidden="true" className="h-3 w-px shrink-0 bg-border/70" />
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              ref={triggerRef}
              disabled={!!disabledReason}
              title={disabledReason ?? t("translation.settings")}
              aria-label={t("translation.settings")}
              className="inline-flex h-full w-5 shrink-0 items-center justify-center transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 focus-visible:outline-none"
            >
              <ChevronDown aria-hidden="true" className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
        </span>
        <DropdownMenuContent align="start" className="max-h-[70vh] overflow-y-auto">
          {translation.text && (
            <DropdownMenuItem onSelect={translation.toggle}>
              {t(
                translation.showTranslation
                  ? "translation.showOriginal"
                  : "translation.showTranslation",
              )}
            </DropdownMenuItem>
          )}
          {streaming ? (
            <DropdownMenuItem onSelect={translation.cancel}>
              {t("translation.cancel")}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              disabled={preferencePending}
              onSelect={() =>
                unavailable ? setSettingsOpen(true) : void translation.translate(!!translation.text)
              }
            >
              {unavailable
                ? t("translation.configure")
                : translation.text
                  ? t("translation.retranslate")
                  : t("translation.translateTo", { language: label })}
            </DropdownMenuItem>
          )}
          <hr className="my-1 border-border" />
          <div role="group" aria-label={t("translation.language")}>
            {translationLanguages.map(([id, name]) => (
              <DropdownMenuItem
                key={id}
                role="menuitemradio"
                aria-checked={id === language}
                disabled={preferencePending}
                onSelect={() => setLanguage(id)}
              >
                <span className="flex h-3 w-3 items-center justify-center">
                  {id === language && <Check aria-hidden="true" className="h-3 w-3" />}
                </span>
                {name}
              </DropdownMenuItem>
            ))}
          </div>
          <hr className="my-1 border-border" />
          <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
            {t("translation.settings")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AiSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        returnFocusRef={triggerRef}
      />
    </>
  );
}

import { useId, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useSaveTranslationPreferences,
  useSkillProviders,
  useTranslationPreferences,
} from "@/hooks/useSkillProviders";
import { translationApi } from "@/lib/api/translation";
import {
  initialTranslationLanguage,
  translationErrorCode,
  translationLanguages,
} from "@/lib/translation";
import { SettingsSelect } from "./SettingsSelect";

export function TranslationSettings({ onConfigureModels }: { onConfigureModels: () => void }) {
  const { t, i18n } = useTranslation();
  const uid = useId();
  const providers = useSkillProviders();
  const prefs = useTranslationPreferences();
  const save = useSaveTranslationPreferences();
  const [confirmClear, setConfirmClear] = useState(false);
  const clear = useMutation({
    mutationFn: translationApi.clearCache,
    onSuccess: () => toast.success(t("translation.cacheCleared")),
    onSettled: () => setConfirmClear(false),
  });
  const language =
    prefs.data?.targetLanguage ?? initialTranslationLanguage(navigator.languages, i18n.language);
  const choices =
    providers.data
      ?.filter((p) => p.enabled)
      .flatMap((p) => p.models.filter((m) => m.enabled).map((m) => ({ provider: p, model: m }))) ??
    [];
  const selected = choices.findIndex(
    (c) => c.provider.id === prefs.data?.providerId && c.model.id === prefs.data?.modelId,
  );
  const error = prefs.error ?? providers.error ?? save.error ?? clear.error;
  return (
    <section className="space-y-5">
      <SettingsSelect
        id={`${uid}-language`}
        label={t("translation.language")}
        value={language}
        options={translationLanguages.map(([value, label]) => ({ value, label }))}
        disabled={!prefs.data || save.isPending}
        onValueChange={(targetLanguage) =>
          prefs.data && save.mutate({ ...prefs.data, targetLanguage })
        }
      />
      {providers.isSuccess && choices.length === 0 ? (
        <div className="space-y-2">
          <label
            id={`${uid}-model-label`}
            htmlFor={`${uid}-model`}
            className="block text-xs font-medium"
          >
            {t("translation.model")}
          </label>
          <Button
            id={`${uid}-model`}
            type="button"
            className="h-9 w-full justify-between rounded-md px-3 text-xs"
            aria-labelledby={`${uid}-model-label ${uid}-configure-label`}
            onClick={onConfigureModels}
          >
            <span id={`${uid}-configure-label`}>{t("translation.configureModels")}</span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          </Button>
        </div>
      ) : (
        <SettingsSelect
          id={`${uid}-model`}
          label={t("translation.model")}
          value={selected < 0 ? "" : String(selected)}
          placeholder={t(
            prefs.data?.providerId ? "translation.unavailableModel" : "translation.chooseModel",
          )}
          options={choices.map((c, index) => ({
            value: String(index),
            label: `${c.provider.name} · ${c.model.id}`,
          }))}
          disabled={
            !prefs.data ||
            providers.isPending ||
            providers.isError ||
            save.isPending ||
            choices.length === 0
          }
          onValueChange={(value) => {
            const choice = choices[Number(value)];
            if (prefs.data && choice)
              save.mutate({
                ...prefs.data,
                targetLanguage: language,
                providerId: choice.provider.id,
                modelId: choice.model.id,
              });
          }}
        />
      )}
      <div className="flex items-center justify-between gap-4 border-t border-border/40 pt-4">
        <div className="space-y-1">
          <p className="text-xs font-medium">{t("translation.cacheTitle")}</p>
          <p className="text-[11px] text-muted-foreground">{t("translation.cacheHint")}</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant={confirmClear ? "default" : "outline"}
          className={`h-8 w-[4.5rem] shrink-0 rounded-md border text-xs ${confirmClear ? "border-primary" : "border-input"}`}
          disabled={clear.isPending}
          onClick={() => {
            if (confirmClear) clear.mutate();
            else setConfirmClear(true);
          }}
        >
          {t(confirmClear ? "translation.confirmClearCache" : "translation.clearCache")}
        </Button>
      </div>
      {error && (
        <p role="status" className="text-xs text-destructive">
          {t(`translation.errors.${translationErrorCode(error)}`, {
            defaultValue: t("translation.errors.configRead"),
          })}
        </p>
      )}
    </section>
  );
}

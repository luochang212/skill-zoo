import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
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

export function TranslationSettings() {
  const { t, i18n } = useTranslation();
  const uid = useId();
  const providers = useSkillProviders();
  const prefs = useTranslationPreferences();
  const save = useSaveTranslationPreferences();
  const clear = useMutation({ mutationFn: translationApi.clearCache });
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
      {selected >= 0 && (
        <p className="text-xs text-muted-foreground">
          {t("translation.sendHint", { provider: choices[selected]?.provider.name })}
        </p>
      )}
      <div className="flex items-center justify-between gap-4 border-t border-border/40 pt-4">
        <div className="space-y-1">
          <p className="text-xs font-medium">{t("translation.cacheTitle")}</p>
          <p className="text-[11px] text-muted-foreground">{t("translation.cacheHint")}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8 shrink-0 text-xs"
          disabled={clear.isPending}
          onClick={() => clear.mutate()}
        >
          {t("translation.clearCache")}
        </Button>
      </div>
      {clear.isSuccess && (
        <p role="status" className="text-xs text-muted-foreground">
          {t("translation.cacheCleared")}
        </p>
      )}
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

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

const languageOptions = [
  { value: "en", labelKey: "settings.language.en" },
  { value: "zh", labelKey: "settings.language.zh" },
] as const;

export function LanguageSettings() {
  const { i18n, t } = useTranslation();
  const currentLang = i18n.language;

  const handleLanguageChange = (lng: string) => {
    i18n.changeLanguage(lng);
  };

  return (
    <section className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {t("settings.language.description")}
      </p>
      <div className="inline-flex gap-1 rounded-md border border-border bg-background p-1">
        {languageOptions.map((opt) => (
          <Button
            key={opt.value}
            type="button"
            size="sm"
            variant={currentLang === opt.value ? "default" : "ghost"}
            className={cn(
              "min-w-[80px] gap-1.5",
              currentLang === opt.value
                ? "shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
            onClick={() => handleLanguageChange(opt.value)}
          >
            {t(opt.labelKey)}
          </Button>
        ))}
      </div>
    </section>
  );
}

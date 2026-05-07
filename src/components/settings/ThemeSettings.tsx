import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTheme, type Theme } from "@/hooks/useTheme";

const themeOptionDefs: {
  value: Theme;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { value: "light", labelKey: "settings.theme.light", icon: Sun },
  { value: "dark", labelKey: "settings.theme.dark", icon: Moon },
  { value: "system", labelKey: "settings.theme.system", icon: Monitor },
];

export function ThemeSettings() {
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();

  return (
    <section className="space-y-2">
      <p className="text-xs text-muted-foreground">{t("settings.theme.description")}</p>
      <div className="inline-flex gap-1 rounded-md border border-border bg-background p-1">
        {themeOptionDefs.map((opt) => (
          <Button
            key={opt.value}
            type="button"
            size="sm"
            variant={theme === opt.value ? "default" : "ghost"}
            className={cn(
              "min-w-[80px] gap-1.5",
              theme === opt.value
                ? "shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
            onClick={(e) => setTheme(opt.value, e)}
          >
            <opt.icon className="h-3.5 w-3.5" />
            {t(opt.labelKey)}
          </Button>
        ))}
      </div>
    </section>
  );
}

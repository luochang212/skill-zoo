import { Palette } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ThemeSettings } from "@/components/settings/ThemeSettings";
import { LanguageSettings } from "@/components/settings/LanguageSettings";
import { SkillMaintenanceSettings } from "@/components/settings/SkillMaintenanceSettings";
import { AgentPathsSettings } from "@/components/settings/AgentPathsSettings";
import { AboutSection } from "@/components/settings/AboutSection";
import { ScrollArea } from "@/components/ui/scroll-area";

export function SettingsView() {
  const { t } = useTranslation();

  return (
    <div className="flex h-full">
      <ScrollArea className="flex-1">
        <div className="p-6">
          <div className="space-y-6">
          {/* Appearance */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b border-border/40">
              <Palette className="h-4 w-4 text-violet-500" />
              <h3 className="text-sm font-medium">{t("settings.appearance")}</h3>
            </div>
            <div className="rounded-xl border border-border bg-card/50 p-4 space-y-5">
              <ThemeSettings />
              <div className="border-t border-border/30">
                <LanguageSettings />
              </div>
            </div>
          </div>

          {/* Skill Maintenance */}
          <SkillMaintenanceSettings />

          {/* Agent Paths */}
          <AgentPathsSettings />

          {/* About & Feedback */}
          <AboutSection />
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

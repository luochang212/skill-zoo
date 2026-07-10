import { Palette } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ThemeSettings } from "@/components/settings/ThemeSettings";
import { LanguageSettings } from "@/components/settings/LanguageSettings";
import { SkillMaintenanceSettings } from "@/components/settings/SkillMaintenanceSettings";
import { SkillCompanionSettings } from "@/components/settings/SkillCompanionSettings";
import { AgentPathsSettings } from "@/components/settings/AgentPathsSettings";
import { AboutSection } from "@/components/settings/AboutSection";
import { AppUpdateShortcut } from "@/components/settings/AppUpdateShortcut";
import { ScrollArea } from "@/components/ui/scroll-area";

export function SettingsView({
  skillCompanionOpenRequest = 0,
  onSkillCompanionOpenHandled,
}: {
  skillCompanionOpenRequest?: number;
  onSkillCompanionOpenHandled?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full">
      <ScrollArea className="flex-1">
        <div className="p-6">
          <div className="space-y-6">
            {/* Appearance */}
            <div className="space-y-4">
              <div className="flex h-9 items-center justify-between gap-3 border-b border-border/40 pb-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Palette className="h-4 w-4 text-violet-500" />
                  <h3 className="text-sm font-medium">{t("settings.appearance")}</h3>
                </div>
                <AppUpdateShortcut />
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

            {/* Skill Companion */}
            <SkillCompanionSettings
              openManagerRequest={skillCompanionOpenRequest}
              onOpenManagerRequestHandled={onSkillCompanionOpenHandled}
            />

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

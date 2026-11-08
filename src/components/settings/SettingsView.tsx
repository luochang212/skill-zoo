import { useState } from "react";
import { Palette, PlugZap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AiSettingsRows } from "./AiSettings";
import { ThemeSettings } from "@/components/settings/ThemeSettings";
import { LanguageSettings } from "@/components/settings/LanguageSettings";
import { SkillMaintenanceSettings } from "@/components/settings/SkillMaintenanceSettings";
import { GitHubTokenSettings } from "@/components/settings/GitHubTokenSettings";
import { WindowBehaviorSettings } from "@/components/settings/WindowBehaviorSettings";
import { SkillCompanionSettings } from "@/components/settings/SkillCompanionSettings";
import { AgentPathsSettings } from "@/components/settings/AgentPathsSettings";
import { AboutSection } from "@/components/settings/AboutSection";
import { AppUpdateShortcut } from "@/components/settings/AppUpdateShortcut";
import { ScrollArea } from "@/components/ui/scroll-area";

export function SettingsView({
  skillUsageOpenRequest = 0,
  onSkillUsageOpenHandled,
  skillCompanionOpenRequest = 0,
  onSkillCompanionOpenHandled,
}: {
  skillUsageOpenRequest?: number;
  onSkillUsageOpenHandled?: () => void;
  skillCompanionOpenRequest?: number;
  onSkillCompanionOpenHandled?: () => void;
}) {
  const { t } = useTranslation();
  const [githubTokenOpen, setGithubTokenOpen] = useState(false);

  return (
    <div className="flex h-full">
      <ScrollArea className="flex-1">
        <div className="p-6">
          <div className="space-y-6">
            {/* Appearance */}
            <div className="space-y-4">
              <div className="flex h-9 items-center justify-between gap-3 border-b border-border/40 pb-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Palette className="h-4 w-4 text-[#927bad] dark:text-[#b6a2cd]" />
                  <h3 className="text-sm font-medium">{t("settings.appearance")}</h3>
                </div>
                <AppUpdateShortcut />
              </div>
              <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
                <ThemeSettings />
                <div className="border-t border-border/30 pt-3">
                  <LanguageSettings />
                </div>
              </div>
            </div>

            {/* Skill Maintenance */}
            <SkillMaintenanceSettings onRequestGitHubTokenConfig={() => setGithubTokenOpen(true)} />

            {/* Skill Companion */}
            <SkillCompanionSettings
              openUsageRequest={skillUsageOpenRequest}
              onOpenUsageRequestHandled={onSkillUsageOpenHandled}
              openManagerRequest={skillCompanionOpenRequest}
              onOpenManagerRequestHandled={onSkillCompanionOpenHandled}
            />

            {/* Agent Paths */}
            <AgentPathsSettings />

            {/* Advanced */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 border-b border-border/40 pb-2">
                <PlugZap className="h-4 w-4 text-[#a66f82] dark:text-[#c49aaa]" />
                <h3 className="text-sm font-medium">{t("settings.advanced.title")}</h3>
              </div>
              <AiSettingsRows />
              <GitHubTokenSettings open={githubTokenOpen} onOpenChange={setGithubTokenOpen} />
              <WindowBehaviorSettings />
            </div>

            {/* About & Feedback */}
            <AboutSection />
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

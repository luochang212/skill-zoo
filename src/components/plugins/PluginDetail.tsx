import { useTranslation } from "react-i18next";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { SkillContentPane } from "@/components/skills/SkillContentPane";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { skillsApi } from "@/lib/api/skills";
import type { PluginInfo } from "@/types/skills";
import type { ContentTab } from "@/components/skills/SkillContentPane";

interface PluginDetailProps {
  plugin: PluginInfo;
  onBack: () => void;
}

export function PluginDetail({ plugin, onBack }: PluginDetailProps) {
  const { t } = useTranslation();

  const readmePath = `${plugin.installPath}/README.md`;
  const { data: readmeContent = "" } = useQuery({
    queryKey: ["plugins", "file", readmePath],
    queryFn: () => skillsApi.readSkillFilePath(readmePath),
    enabled: !!plugin.installPath,
  });

  return (
    <div className="flex flex-col h-full" data-selectable>
      <div className="px-5 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={onBack}
              className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <h1 className="text-[15px] font-semibold truncate">{plugin.name}</h1>
            {plugin.version && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
                v{plugin.version}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs rounded-lg"
              onClick={() => {
                skillsApi.openSkillPath(plugin.installPath).catch(() => {});
              }}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              {t("skillFiles.openInFinder")}
            </Button>
          </div>
        </div>

        {plugin.description && (
          <p className="text-[13px] text-muted-foreground mt-1.5">{plugin.description}</p>
        )}
      </div>

      <SkillContentPane
        content={readmeContent}
        onChange={() => {}}
        activeTab="overview"
        onTabChange={(_tab: ContentTab) => {}}
        readOnly
        directory={plugin.installPath}
      />
    </div>
  );
}

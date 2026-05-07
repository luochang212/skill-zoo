import { useTranslation } from "react-i18next";
import { useSymlinkStatus, useToggleSymlink } from "@/hooks/useSkills";
import { useVisibleAgents, getVisibleAgentsOrDefault } from "@/hooks/useSettings";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useAgentConfigs, getAgentLabel } from "@/lib/agents";
import type { SymlinkStatus } from "@/types/skills";

export function SymlinkPanel() {
  const { t } = useTranslation();
  const { data: symlinks, isLoading } = useSymlinkStatus();
  const toggleSymlink = useToggleSymlink();
  const { data: visibleAgentsData } = useVisibleAgents();
  const visibleAgents = getVisibleAgentsOrDefault(visibleAgentsData);
  const { data: agentConfigs } = useAgentConfigs();

  if (isLoading) {
    return <p className="text-xs text-muted-foreground p-4">{t("symlink.loading")}</p>;
  }

  if (!symlinks || symlinks.length === 0) {
    return <p className="text-xs text-muted-foreground p-4">{t("symlink.empty")}</p>;
  }

  const bySkill = symlinks.reduce(
    (acc, s) => {
      if (!acc[s.skillId]) acc[s.skillId] = { name: s.skillName, links: [] };
      acc[s.skillId].links.push(s);
      return acc;
    },
    {} as Record<string, { name: string; links: SymlinkStatus[] }>,
  );

  return (
    <div className="p-4">
      <h3 className="text-sm font-medium mb-3">{t("symlink.title")}</h3>
      <ScrollArea className="max-h-64">
        <div className="space-y-3">
          {Object.entries(bySkill).map(([skillId, { name, links }]) => (
            <div key={skillId}>
              <p className="text-xs font-medium mb-1.5">{name}</p>
              <div className="space-y-1">
                {links
                  .filter((link) => visibleAgents[link.agent] !== false)
                  .map((link) => (
                    <div
                      key={`${link.skillId}-${link.agent}`}
                      className="flex items-center justify-between text-xs"
                    >
                      <span className="text-muted-foreground">
                        {getAgentLabel(link.agent, agentConfigs ?? [])}
                      </span>
                      <div className="flex items-center gap-2">
                        {link.isValid ? (
                          <Badge variant="secondary" className="text-[10px] h-4 px-1">
                            {t("symlink.linked")}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] h-4 px-1">
                            {link.exists ? t("symlink.broken") : t("symlink.missing")}
                          </Badge>
                        )}
                        <Switch
                          checked={link.exists}
                          onCheckedChange={(enabled) =>
                            toggleSymlink.mutate({
                              skillId,
                              agent: link.agent,
                              enabled,
                            })
                          }
                          className="scale-75"
                        />
                      </div>
                    </div>
                  ))}
              </div>
              <Separator className="mt-2" />
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

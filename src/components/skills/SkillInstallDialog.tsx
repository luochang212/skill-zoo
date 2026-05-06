import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAgentConfigs, getAgentLabel } from "@/lib/agents";
import { useVisibleAgentOrder } from "@/hooks/useSettings";
import type { DiscoverableSkill } from "@/types/skills";

interface SkillInstallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skills: DiscoverableSkill[];
  repoOwner: string;
  repoName: string;
  repoBranch: string;
  onInstall: (skillNames: string[], agents: string[]) => void;
  isPending?: boolean;
}

export function SkillInstallDialog({
  open,
  onOpenChange,
  skills,
  repoOwner,
  repoName,
  repoBranch,
  onInstall,
  isPending = false,
}: SkillInstallDialogProps) {
  const { t } = useTranslation();
  const { data: agentConfigs } = useAgentConfigs();
  const visibleAgentOrder = useVisibleAgentOrder();
  const isSingleSkill = skills.length === 1;

  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(
    new Set(skills.map((s) => s.directory))
  );
  const [agents, setAgents] = useState<Set<string>>(new Set(["claude-code"]));

  const toggleSkill = (directory: string) => {
    setSelectedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(directory)) next.delete(directory);
      else next.add(directory);
      return next;
    });
  };

  const toggleAgent = (agent: string) => {
    setAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agent)) next.delete(agent);
      else next.add(agent);
      return next;
    });
  };

  const handleInstall = () => {
    onInstall(Array.from(selectedSkills), Array.from(agents));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t("installDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("installDialog.from")} {repoOwner}/{repoName} ({repoBranch})
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {/* Agent selection — Switch rows like ConfigureDialog */}
          <div>
            <Label className="text-xs">{t("installDialog.agents")}</Label>
            <div className="space-y-1 mt-1.5 -mx-2">
              {visibleAgentOrder.map((agent) => (
                <div
                  key={agent}
                  className="flex items-center justify-between px-3 py-2.5 rounded-md hover:bg-accent/50 transition-colors"
                >
                  <label className="text-sm font-medium cursor-pointer">
                    {getAgentLabel(agent, agentConfigs ?? [])}
                  </label>
                  <Switch
                    checked={agents.has(agent)}
                    onCheckedChange={() => toggleAgent(agent)}
                    aria-label={`Toggle ${getAgentLabel(agent, agentConfigs ?? [])}`}
                  />
                </div>
              ))}
            </div>
          </div>
          {/* Skill list — only show when multiple skills */}
          {!isSingleSkill && (
            <div>
              <Label className="text-xs">{t("installDialog.skills")}</Label>
              <ScrollArea className="h-48 mt-1.5 rounded-md border border-border">
                <div className="p-2 space-y-1">
                  <label className="flex items-center gap-2 text-xs cursor-pointer px-1 py-0.5 hover:bg-accent rounded">
                    <Checkbox
                      checked={selectedSkills.size === skills.length}
                      onCheckedChange={() => {
                        if (selectedSkills.size === skills.length) {
                          setSelectedSkills(new Set());
                        } else {
                          setSelectedSkills(new Set(skills.map((s) => s.directory)));
                        }
                      }}
                    />
                    <span className="font-medium">{t("installDialog.selectAll")}</span>
                  </label>
                  {skills.map((s) => (
                    <label
                      key={s.key}
                      className="flex items-center gap-2 text-xs cursor-pointer px-1 py-0.5 hover:bg-accent rounded"
                    >
                      <Checkbox
                        checked={selectedSkills.has(s.directory)}
                        onCheckedChange={() => toggleSkill(s.directory)}
                      />
                      <span>{s.name}</span>
                    </label>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={handleInstall}
            disabled={selectedSkills.size === 0 || agents.size === 0 || isPending}
          >
            {isPending ? t("common.installing") : isSingleSkill ? t("common.install") : t("installDialog.installCount", { count: selectedSkills.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
import { Switch } from "@/components/ui/switch";
import { useAgentConfigs, getAgentLabel } from "@/lib/agents";
import { useVisibleAgentOrder } from "@/hooks/useSettings";
import type { DiscoverableSkill } from "@/types/skills";

interface SkillInstallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skills: DiscoverableSkill[];
  repoOwner: string;
  repoName: string;
  repoBranch?: string;
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
  const skillNames = skills.map((s) => s.directory);

  const [agents, setAgents] = useState<Set<string>>(new Set(["claude-code"]));

  const toggleAgent = (agent: string) => {
    setAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agent)) next.delete(agent);
      else next.add(agent);
      return next;
    });
  };

  const handleInstall = () => {
    onInstall(skillNames, Array.from(agents));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]" data-selectable>
        <DialogHeader>
          <DialogTitle>{t("installDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("installDialog.from")} {repoOwner}/{repoName} ({repoBranch ?? "default"})
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
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
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" onClick={handleInstall} disabled={agents.size === 0 || isPending}>
            {isPending
              ? t("common.installing")
              : t("installDialog.installCount", { count: skillNames.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

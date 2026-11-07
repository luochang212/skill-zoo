import { useEffect, useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
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
  const visibleAgentKey = visibleAgentOrder.join("\0");
  const skillNames = skills.map((s) => s.key);

  const [agents, setAgents] = useState<Set<string>>(new Set());

  useEffect(() => {
    setAgents((prev) => {
      const visible = new Set(visibleAgentOrder);
      const next = new Set([...prev].filter((agent) => visible.has(agent)));
      if (next.size === 0 && visibleAgentOrder[0]) {
        next.add(visibleAgentOrder[0]);
      }
      if (prev.size === next.size && [...prev].every((agent) => next.has(agent))) {
        return prev;
      }
      return next;
    });
  }, [visibleAgentKey]);

  const toggleAgent = (agent: string) => {
    if (isPending) return;
    setAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agent)) next.delete(agent);
      else next.add(agent);
      return next;
    });
  };

  const allSelected = visibleAgentOrder.length > 0 && visibleAgentOrder.every((a) => agents.has(a));
  const toggleAll = () => {
    if (isPending) return;
    setAgents(allSelected ? new Set() : new Set(visibleAgentOrder));
  };

  const handleInstall = () => {
    if (isPending || agents.size === 0) return;
    onInstall(skillNames, Array.from(agents));
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (isPending && !nextOpen) return;
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[420px]" data-selectable>
        <DialogHeader>
          <DialogTitle>{t("installDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("installDialog.from")} {repoOwner}/{repoName} ({repoBranch ?? "default"})
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1 -mx-2">
          <div
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-md hover:bg-accent/50 transition-colors cursor-pointer"
            onClick={toggleAll}
          >
            <Checkbox
              checked={allSelected}
              disabled={isPending}
              onClick={(e) => e.stopPropagation()}
              onCheckedChange={toggleAll}
              aria-label={t("installDialog.selectAll")}
            />
            <label className="text-sm font-medium cursor-pointer">
              {t("installDialog.selectAll")}
            </label>
          </div>
          {visibleAgentOrder.map((agent) => (
            <div
              key={agent}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-md hover:bg-accent/50 transition-colors cursor-pointer"
              onClick={() => toggleAgent(agent)}
            >
              <Checkbox
                checked={agents.has(agent)}
                disabled={isPending}
                onClick={(e) => e.stopPropagation()}
                onCheckedChange={() => toggleAgent(agent)}
                aria-label={t("configureDialog.toggleAgent", {
                  agent: getAgentLabel(agent, agentConfigs ?? []),
                })}
              />
              <label className="text-sm font-medium cursor-pointer">
                {getAgentLabel(agent, agentConfigs ?? [])}
              </label>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => handleOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            className="press-feedback"
            onClick={handleInstall}
            disabled={agents.size === 0 || isPending}
          >
            {isPending ? t("common.installing") : t("common.install")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

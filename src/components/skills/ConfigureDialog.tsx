import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSymlinkStatus, useToggleSymlink } from "@/hooks/useSkills";
import { useVisibleAgentOrder } from "@/hooks/useSettings";
import { useAgentConfigs, getAgentLabel } from "@/lib/agents";
import { AlertTriangle } from "lucide-react";
import type { SymlinkStatus } from "@/types/skills";

interface ConfigureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skillId: string;
  skillName: string;
  homeAgent?: string;
}

export function ConfigureDialog({
  open,
  onOpenChange,
  skillId,
  skillName,
  homeAgent,
}: ConfigureDialogProps) {
  const { t } = useTranslation();
  const { data: symlinks, isLoading, isError, error, refetch } = useSymlinkStatus();
  const toggleSymlink = useToggleSymlink();
  const visibleAgentOrder = useVisibleAgentOrder();
  const { data: agentConfigs } = useAgentConfigs();

  // Find symlinks for this skill
  const skillSymlinks =
    symlinks?.filter((s) => s.skillId === skillId) ?? [];

  // Build a map of agent -> symlink status
  const symlinkMap = new Map<string, SymlinkStatus>();
  for (const link of skillSymlinks) {
    symlinkMap.set(link.agent, link);
  }

  // Check if a specific agent is currently being toggled
  const pendingAgent = toggleSymlink.isPending
    ? (toggleSymlink.variables as { agent: string } | undefined)?.agent
    : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t("configureDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("configureDialog.description")}{" "}
            <span className="font-medium text-foreground">{skillName}</span>
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            {t("configureDialog.loading")}
          </div>
        ) : isError ? (
          <div className="py-6 text-center space-y-3">
            <AlertTriangle className="h-8 w-8 text-destructive/60 mx-auto" />
            <p className="text-sm text-destructive">{t("error.generic")}</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              {t("error.retry")}
            </Button>
          </div>
        ) : (
          <div className="space-y-1 -mx-2">
            {visibleAgentOrder.map((agent) => {
              const link = symlinkMap.get(agent);
              const isEnabled = link?.exists ?? false;
              const isPending = pendingAgent === agent;
              const isHomeAgent = homeAgent === agent;

              return (
                <div
                  key={agent}
                  className="flex items-center justify-between px-3 py-2.5 rounded-md hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <label className="text-sm font-medium cursor-pointer">
                      {getAgentLabel(agent, agentConfigs ?? [])}
                    </label>
                    {isHomeAgent && (
                      <Badge
                        variant="secondary"
                        className="text-[9px] h-4 px-1.5 font-medium"
                      >
                        {t("configureDialog.linked")}
                      </Badge>
                    )}
                    {!isHomeAgent && link && (
                      <Badge
                        variant={link.isValid ? "secondary" : "outline"}
                        className="text-[9px] h-4 px-1.5 font-medium"
                      >
                        {link.isValid
                          ? t("configureDialog.linked")
                          : link.exists
                            ? t("configureDialog.broken")
                            : t("configureDialog.missing")}
                      </Badge>
                    )}
                  </div>
                  <Switch
                    checked={isEnabled}
                    onCheckedChange={
                      isHomeAgent
                        ? undefined
                        : (enabled) =>
                            toggleSymlink.mutate({ skillId, agent, enabled })
                    }
                    disabled={isPending || isHomeAgent}
                    aria-label={`Toggle ${getAgentLabel(agent, agentConfigs ?? [])}`}
                  />
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

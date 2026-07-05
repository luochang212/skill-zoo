import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FolderInput,
  Link2Off,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useCleanExternalImportLinks,
  useExternalImports,
  useImportExternalSkills,
  useRemoveExternalImport,
} from "@/hooks/useSkills";
import { useVisibleAgentOrder } from "@/hooks/useSettings";
import { getAgentLabel, useAgentConfigs } from "@/lib/agents";
import { skillsApi } from "@/lib/api/skills";
import { formatApiError } from "@/lib/api/errors";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import type { ExternalImportCandidate, ExternalImportStatus } from "@/types/skills";

interface LocalImportsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function statusVariant(status: ExternalImportStatus) {
  return status === "valid" ? "secondary" : "outline";
}

export function LocalImportsDialog({ open, onOpenChange }: LocalImportsDialogProps) {
  const { t } = useTranslation();
  const { data: imports, isLoading, refetch } = useExternalImports();
  const { data: agentConfigs } = useAgentConfigs();
  const visibleAgentOrder = useVisibleAgentOrder();
  const visibleAgentKey = visibleAgentOrder.join("\0");
  const importMutation = useImportExternalSkills();
  const removeMutation = useRemoveExternalImport();
  const cleanMutation = useCleanExternalImportLinks();

  const [candidates, setCandidates] = useState<ExternalImportCandidate[]>([]);
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());
  const [agents, setAgents] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [tab, setTab] = useState<"import" | "manage">("import");

  useEffect(() => {
    setAgents((prev) => {
      const visible = new Set(visibleAgentOrder);
      const next = new Set([...prev].filter((agent) => visible.has(agent)));
      if (next.size === 0 && visibleAgentOrder[0]) next.add(visibleAgentOrder[0]);
      if (prev.size === next.size && [...prev].every((agent) => next.has(agent))) return prev;
      return next;
    });
  }, [visibleAgentKey]);

  const selectedCandidates = useMemo(
    () => candidates.filter((candidate) => selectedSources.has(candidate.sourcePath)),
    [candidates, selectedSources],
  );

  const chooseFolder = async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected !== "string") return;
    setScanning(true);
    try {
      const result = await skillsApi.scanExternalImportFolder(selected);
      setCandidates(result);
      setSelectedSources(
        new Set(result.filter((candidate) => !candidate.alreadyImported).map((c) => c.sourcePath)),
      );
      if (result.length === 0) {
        toast.info(t("settings.localImports.noCandidates"));
      }
    } catch (error) {
      toast.error(formatApiError(error));
    } finally {
      setScanning(false);
    }
  };

  const importSelected = () => {
    importMutation.mutate(
      {
        selections: selectedCandidates.map((candidate) => ({
          sourcePath: candidate.sourcePath,
          directory: candidate.directory,
        })),
        agents: Array.from(agents),
      },
      {
        onSuccess: () => {
          toast.success(
            t("settings.localImports.importSuccess", { count: selectedCandidates.length }),
          );
          setCandidates([]);
          setSelectedSources(new Set());
          refetch();
        },
        onError: (error) => toast.error(formatApiError(error)),
      },
    );
  };

  const toggleCandidate = (sourcePath: string) => {
    setSelectedSources((prev) => {
      const next = new Set(prev);
      if (next.has(sourcePath)) next.delete(sourcePath);
      else next.add(sourcePath);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(640px,calc(100vh-6rem))] w-[calc(100vw-2rem)] max-w-[760px] flex-col gap-0 overflow-hidden p-0 sm:rounded-xl"
        data-selectable
      >
        <DialogHeader className="shrink-0 border-b border-border/50 px-4 py-4 text-left">
          <DialogTitle>{t("settings.localImports.title")}</DialogTitle>
          <DialogDescription>{t("settings.localImports.description")}</DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 items-center gap-3 border-b border-border/40 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-1 rounded-md bg-muted/60 p-1">
            <button
              type="button"
              className={cn(
                "flex h-8 flex-1 items-center justify-center gap-1.5 rounded px-2 text-xs font-medium transition-colors",
                tab === "import" ? "bg-background shadow-sm" : "text-muted-foreground",
              )}
              onClick={() => setTab("import")}
            >
              <FolderInput className="h-3.5 w-3.5" />
              {t("settings.localImports.tabImport")}
            </button>
            <button
              type="button"
              className={cn(
                "flex h-8 flex-1 items-center justify-center gap-1.5 rounded px-2 text-xs font-medium transition-colors",
                tab === "manage" ? "bg-background shadow-sm" : "text-muted-foreground",
              )}
              onClick={() => setTab("manage")}
            >
              <Link2Off className="h-3.5 w-3.5" />
              {t("settings.localImports.tabManage")}
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col">
          {tab === "import" ? (
            <div className="flex-1 min-h-0 flex flex-col gap-5 p-4">
              <Button
                size="sm"
                className="gap-1.5 self-start"
                onClick={chooseFolder}
                disabled={scanning}
              >
                {scanning ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FolderInput className="h-3.5 w-3.5" />
                )}
                {t("settings.localImports.importFolder")}
              </Button>

              {candidates.length > 0 && (
                <div className="flex-1 min-h-0 flex flex-col rounded-lg border border-border">
                  <div className="shrink-0 border-b border-border px-3 py-2">
                    <p className="text-sm font-medium">{t("settings.localImports.candidates")}</p>
                  </div>
                  <div className="grid gap-4 p-3 md:grid-cols-[1fr_220px] flex-1 min-h-0">
                    <ScrollArea className="h-full pr-3">
                      <div className="space-y-1">
                        {candidates.map((candidate) => (
                          <label
                            key={candidate.sourcePath}
                            className={cn(
                              "flex items-start gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent/50",
                              candidate.alreadyImported && "opacity-60",
                            )}
                          >
                            <Checkbox
                              checked={selectedSources.has(candidate.sourcePath)}
                              disabled={candidate.alreadyImported}
                              onCheckedChange={() => toggleCandidate(candidate.sourcePath)}
                              aria-label={candidate.name}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">{candidate.name}</span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {candidate.sourcePath}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </ScrollArea>
                    <div className="flex min-h-0 flex-col gap-3">
                      <p className="text-xs font-medium text-muted-foreground">
                        {t("installDialog.agents")}
                      </p>
                      <ScrollArea className="flex-1 min-h-0">
                        <div className="space-y-1 pr-2">
                          {visibleAgentOrder.map((agent) => (
                            <div
                              key={agent}
                              className="flex items-center justify-between rounded-md px-2 py-1.5"
                            >
                              <span className="text-sm">
                                {getAgentLabel(agent, agentConfigs ?? [])}
                              </span>
                              <Switch
                                checked={agents.has(agent)}
                                onCheckedChange={() => toggleAgent(agent)}
                              />
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                      <Button
                        size="sm"
                        className="w-full shrink-0"
                        onClick={importSelected}
                        disabled={
                          selectedCandidates.length === 0 ||
                          agents.size === 0 ||
                          importMutation.isPending
                        }
                      >
                        {t("settings.localImports.importSelected", {
                          count: selectedCandidates.length,
                        })}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col p-4">
              <div className="flex-1 min-h-0 flex flex-col rounded-lg border border-border">
                <div className="shrink-0 border-b border-border px-3 py-2">
                  <p className="text-sm font-medium">{t("settings.localImports.managed")}</p>
                </div>
                <ScrollArea className="flex-1">
                  {isLoading ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">
                      {t("configureDialog.loading")}
                    </div>
                  ) : !imports || imports.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">
                      {t("settings.localImports.empty")}
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {imports.map((entry) => (
                        <div key={entry.id} className="flex items-start justify-between gap-3 p-3">
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2">
                              {entry.status === "valid" ? (
                                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                              ) : (
                                <AlertTriangle className="h-4 w-4 text-amber-500" />
                              )}
                              <p className="truncate text-sm font-medium">{entry.name}</p>
                              <Badge
                                variant={statusVariant(entry.status)}
                                className="h-5 text-[10px]"
                              >
                                {t(`settings.localImports.status.${entry.status}`)}
                              </Badge>
                            </div>
                            <p className="truncate text-xs text-muted-foreground">
                              {entry.sourcePath}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {t("settings.localImports.linkedAgents", {
                                agents:
                                  entry.linkedAgents.length > 0
                                    ? entry.linkedAgents
                                        .map((agent) => getAgentLabel(agent, agentConfigs ?? []))
                                        .join(", ")
                                    : t("settings.localImports.none"),
                              })}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2"
                              onClick={() => skillsApi.openSkillPath(entry.sourcePath)}
                              disabled={entry.status === "sourceMissing"}
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Button>
                            {entry.status !== "valid" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2"
                                onClick={() =>
                                  cleanMutation.mutate(entry.id, { onSuccess: () => refetch() })
                                }
                              >
                                <Link2Off className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2"
                              onClick={() =>
                                removeMutation.mutate(entry.id, {
                                  onSuccess: () => {
                                    toast.success(t("settings.localImports.removeSuccess"));
                                    refetch();
                                  },
                                  onError: (error) => toast.error(formatApiError(error)),
                                })
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

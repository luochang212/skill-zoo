import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderOpen, FolderSymlink, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { skillsApi } from "@/lib/api/skills";
import {
  useVisibleAgents,
  useUpdateVisibleAgents,
  useAddCustomAgent,
  useUpdateCustomAgent,
  useRemoveCustomAgent,
  getVisibleAgentsOrDefault,
} from "@/hooks/useSettings";
import type { AgentPathInfo, VisibleAgents } from "@/types/skills";

function PathRow({
  info,
  isVisible,
  onToggleVisibility,
  canToggle,
  isBuiltin,
  onEdit,
}: {
  info: AgentPathInfo;
  isVisible: boolean;
  onToggleVisibility: () => void;
  canToggle: boolean;
  isBuiltin: boolean;
  onEdit?: () => void;
}) {
  const { t } = useTranslation();
  const isSsot = info.agent === "ssot";
  const Icon = isSsot ? FolderSymlink : FolderOpen;

  const handleOpen = () => {
    skillsApi.openSkillsDir(info.agent);
  };

  return (
    <div
      className={`flex items-center justify-between rounded-xl border border-border p-4 transition-opacity ${
        isSsot ? "bg-primary/5" : "bg-card/50"
      } ${!isVisible && !isSsot ? "opacity-50" : ""}`}
    >
      <div className="flex items-center gap-3 min-w-0">
        {!isSsot ? (
          <Switch
            checked={isVisible}
            onCheckedChange={onToggleVisibility}
            disabled={!canToggle && isVisible}
            aria-label={`Toggle visibility for ${info.label}`}
            className="shrink-0"
          />
        ) : (
          <div className="inline-flex h-[24px] w-[44px] shrink-0" />
        )}

        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border">
          <Icon className={`h-4 w-4 ${isSsot ? "text-primary" : "text-muted-foreground"}`} />
        </div>

        <div className="min-w-0 space-y-0.5" data-selectable>
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium leading-none">{info.label}</p>
            {!info.exists && (
              <span className="text-[10px] text-muted-foreground/60 leading-none">
                {t("settings.agentPaths.notFound")}
              </span>
            )}
            {!isVisible && !isSsot && (
              <span className="text-[10px] text-muted-foreground/60 leading-none">
                {t("settings.agentPaths.hidden")}
              </span>
            )}
            {!isBuiltin && (
              <span className="text-[10px] text-amber-500/80 leading-none font-medium">
                {t("settings.agentPaths.custom")}
              </span>
            )}
          </div>
          <p className="font-mono text-xs text-muted-foreground truncate">{info.path}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 ml-3">
        {!isBuiltin && onEdit && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={onEdit}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs gap-1.5"
          onClick={handleOpen}
          disabled={!info.exists}
        >
          <FolderOpen className="h-3.5 w-3.5" />
          {t("settings.agentPaths.open")}
        </Button>
      </div>
    </div>
  );
}

// ── Edit Custom Agent Dialog ──

function EditAgentDialog({
  open,
  onOpenChange,
  agentId,
  initialName,
  initialPath,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  initialName: string;
  initialPath: string;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  const [path, setPath] = useState(initialPath);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const updateAgent = useUpdateCustomAgent();
  const removeAgent = useRemoveCustomAgent();

  const handleSave = async () => {
    setError("");
    const trimmedName = name.trim();
    const trimmedPath = path.trim();

    if (!trimmedName) {
      setError(t("settings.agentPaths.emptyName"));
      return;
    }
    if (trimmedName.length > 64) {
      setError(t("settings.agentPaths.nameTooLong"));
      return;
    }
    if (!trimmedPath) {
      setError(t("settings.agentPaths.emptyPath"));
      return;
    }

    // Check if path exists, ask before creating
    const exists = await settingsApi.checkDirExists(trimmedPath);
    if (!exists) {
      if (!window.confirm(t("settings.agentPaths.createConfirm"))) {
        return;
      }
    }

    updateAgent.mutate(
      { agentId, name: trimmedName, skillsDir: trimmedPath },
      {
        onSuccess: () => onOpenChange(false),
        onError: (err) => setError((err as any)?.message ?? String(err)),
      },
    );
  };

  const handleDelete = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    removeAgent.mutate(agentId, {
      onSuccess: () => onOpenChange(false),
      onError: (err) => setError((err as any)?.message ?? String(err)),
    });
  };

  const pathChanged = path.trim() !== initialPath;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{t("settings.agentPaths.editAgent")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("settings.agentPaths.editAgent")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium text-muted-foreground w-16 shrink-0">
              {t("settings.agentPaths.agentName")}
            </label>
            <Input
              className="h-8 text-xs"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium text-muted-foreground w-16 shrink-0">
              {t("settings.agentPaths.skillsDir")}
            </label>
            <Input
              className="h-8 text-xs font-mono"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
          </div>
          {pathChanged && (
            <p className="text-[11px] text-amber-500/80">
              ⚠ {t("settings.agentPaths.pathChangeWarning")}
            </p>
          )}
          {error && <p className="text-[11px] text-destructive">{error}</p>}
        </div>

        <DialogFooter className="sm:justify-between">
          <button
            type="button"
            className={`text-[11px] transition-colors ${
              confirmDelete
                ? "text-destructive font-medium"
                : "text-destructive/70 hover:text-destructive"
            }`}
            onClick={handleDelete}
            disabled={removeAgent.isPending}
            onBlur={() => setConfirmDelete(false)}
          >
            <Trash2 className="h-3 w-3 inline mr-1 -mt-0.5" />
            {confirmDelete
              ? t("settings.agentPaths.deleteConfirm")
              : t("settings.agentPaths.deleteThisAgent")}
          </button>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => onOpenChange(false)}
            >
              {t("settings.agentPaths.cancel")}
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs"
              onClick={handleSave}
              disabled={updateAgent.isPending}
            >
              {updateAgent.isPending
                ? t("settings.agentPaths.saving")
                : t("settings.agentPaths.save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Component ──

export function AgentPathsSettings() {
  const { t } = useTranslation();
  const { data: paths } = useQuery({
    queryKey: ["agentPaths"],
    queryFn: () => skillsApi.getAgentPaths(),
  });
  const { data: visibleAgentsData } = useVisibleAgents();
  const updateVisibleAgents = useUpdateVisibleAgents();
  const addCustomAgent = useAddCustomAgent();

  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPath, setNewPath] = useState("");
  const [formError, setFormError] = useState("");

  // Edit dialog state
  const [editTarget, setEditTarget] = useState<{
    id: string;
    name: string;
    path: string;
  } | null>(null);

  const visibleAgents = getVisibleAgentsOrDefault(visibleAgentsData);
  const visibleCount = Object.values(visibleAgents).filter(Boolean).length;

  const handleToggleVisibility = (agent: string) => {
    const currentVisible = visibleAgents[agent] !== false;
    if (currentVisible && visibleCount <= 1) return;
    const updated: VisibleAgents = { ...visibleAgents, [agent]: !currentVisible };
    updateVisibleAgents.mutate(updated);
  };

  const handleAdd = async () => {
    setFormError("");
    const trimmedName = newName.trim();
    const trimmedPath = newPath.trim();

    if (!trimmedName) {
      setFormError(t("settings.agentPaths.emptyName"));
      return;
    }
    if (trimmedName.length > 64) {
      setFormError(t("settings.agentPaths.nameTooLong"));
      return;
    }
    if (!trimmedPath) {
      setFormError(t("settings.agentPaths.emptyPath"));
      return;
    }

    // Check if path exists, ask before creating
    const exists = await settingsApi.checkDirExists(trimmedPath);
    if (!exists) {
      if (!window.confirm(t("settings.agentPaths.createConfirm"))) {
        return;
      }
    }

    addCustomAgent.mutate(
      { name: trimmedName, skillsDir: trimmedPath },
      {
        onSuccess: () => {
          setNewName("");
          setNewPath("");
          setShowForm(false);
        },
        onError: (err) => {
          setFormError((err as any)?.message ?? String(err));
        },
      },
    );
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 pb-2 border-b border-border/40">
        <FolderOpen className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-medium">{t("settings.agentPaths.title")}</h3>
      </div>

      <p className="text-xs text-muted-foreground">{t("settings.agentPaths.description")}</p>

      <div className="space-y-3">
        {paths?.map((info) => {
          const isSsot = info.agent === "ssot";
          const isVisible = isSsot || visibleAgents[info.agent] !== false;
          const canToggle = !isSsot && !(isVisible && visibleCount <= 1);
          const isBuiltin = !info.agent.startsWith("custom-");

          return (
            <PathRow
              key={info.agent}
              info={info}
              isVisible={isVisible}
              onToggleVisibility={() => handleToggleVisibility(info.agent)}
              canToggle={canToggle}
              isBuiltin={isBuiltin}
              onEdit={
                !isBuiltin
                  ? () =>
                      setEditTarget({
                        id: info.agent,
                        name: info.label,
                        path: info.path,
                      })
                  : undefined
              }
            />
          );
        })}
      </div>

      {/* Add Custom Agent Form */}
      {!showForm ? (
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs gap-1.5 w-full"
          onClick={() => setShowForm(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          {t("settings.agentPaths.addCustomAgent")}
        </Button>
      ) : (
        <div className="space-y-3 rounded-xl border border-border bg-card/50 p-4">
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium text-muted-foreground w-16 shrink-0">
              {t("settings.agentPaths.agentName")}
            </label>
            <Input
              className="h-8 text-xs"
              placeholder={t("settings.agentPaths.agentNamePlaceholder")}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium text-muted-foreground w-16 shrink-0">
              {t("settings.agentPaths.skillsDir")}
            </label>
            <Input
              className="h-8 text-xs font-mono"
              placeholder={t("settings.agentPaths.skillsDirPlaceholder")}
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
          </div>
          {formError && (
            <p className="text-[11px] text-destructive">{formError}</p>
          )}
          <div className="flex gap-2 justify-end">
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => {
                setShowForm(false);
                setFormError("");
              }}
            >
              {t("settings.agentPaths.cancel")}
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={handleAdd}
              disabled={addCustomAgent.isPending}
            >
              <Plus className="h-3.5 w-3.5" />
              {addCustomAgent.isPending
                ? t("settings.agentPaths.adding")
                : t("settings.agentPaths.add")}
            </Button>
          </div>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground/70">{t("settings.agentPaths.hiddenHint")}</p>

      {/* Edit Dialog */}
      {editTarget && (
        <EditAgentDialog
          open={!!editTarget}
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
          agentId={editTarget.id}
          initialName={editTarget.name}
          initialPath={editTarget.path}
        />
      )}
    </section>
  );
}

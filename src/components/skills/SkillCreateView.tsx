import { useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/ui/BackButton";
import { SkillContentPane, type ContentTab } from "@/components/skills/SkillContentPane";
import { useCreateSkill } from "@/hooks/useSkills";
import { useAgentConfigs } from "@/lib/agents";

const STORAGE_KEY = "skill-create-last-agents";
const SKILL_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

function loadLastAgents(): Set<string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return new Set(JSON.parse(stored) as string[]);
    }
  } catch {
    /* ignore */
  }
  return new Set(["claude-code"]);
}

function saveLastAgents(agents: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(agents)));
  } catch {
    /* ignore */
  }
}

interface SkillCreateViewProps {
  onClose: () => void;
  onCreated: (id: string, directory: string, name: string) => void;
}

export function SkillCreateView({ onClose, onCreated }: SkillCreateViewProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [agents, setAgents] = useState<Set<string>>(loadLastAgents);
  const [activeTab, setActiveTab] = useState<ContentTab>("split");
  const createMutation = useCreateSkill();

  const { data: agentConfigs } = useAgentConfigs();

  const toggleAgent = (agent: string) => {
    setAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agent)) next.delete(agent);
      else next.add(agent);
      return next;
    });
  };

  const trimmedName = name.trim();
  const nameValid = SKILL_NAME_RE.test(trimmedName);
  const canCreate =
    trimmedName.length > 0 && nameValid && agents.size > 0 && !createMutation.isPending;

  const fullContent = useMemo(() => {
    const hasMeta = name.trim() || description.trim();
    const nameLine = name.trim() ? `name: ${name.trim()}` : "name: my-skill-name";
    const descLine = description.trim()
      ? `description: ${description.trim()}`
      : name.trim()
        ? "description: Briefly describe what this skill does..."
        : null;

    const frontmatter = descLine ? `---\n${nameLine}\n${descLine}\n---` : `---\n${nameLine}\n---`;

    if (!hasMeta && !content.trim()) return "";
    return frontmatter + "\n\n" + (content || "");
  }, [name, description, content]);

  const handleCreate = useCallback(() => {
    if (!name.trim() || agents.size === 0 || createMutation.isPending) return;
    createMutation.mutate(
      { name: name.trim(), content: fullContent, agents: Array.from(agents) },
      {
        onSuccess: (skill) => {
          saveLastAgents(agents);
          onCreated(skill.id, skill.directory, skill.name);
        },
      },
    );
  }, [name, description, fullContent, agents, createMutation, onCreated]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-4 border-b border-border space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BackButton onClick={onClose} title={t("common.back")} />
            <h1 className="text-xl font-bold tracking-tight">{t("createSkill.title")}</h1>
          </div>
          <Button
            size="sm"
            className="h-7 text-[11px]"
            onClick={handleCreate}
            disabled={!canCreate}
          >
            {t("createSkill.create")}
          </Button>
        </div>
        <div className="ml-11 space-y-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground w-16 shrink-0">
              {t("createSkill.name")}
            </label>
            <div className="flex-1">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("createSkill.namePlaceholder")}
                className="h-8 text-xs"
                autoFocus
              />
              {trimmedName.length > 0 && !nameValid && (
                <p className="text-[11px] text-destructive mt-1">{t("createSkill.nameInvalid")}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground w-16 shrink-0">
              {t("createSkill.description")}
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("createSkill.descriptionPlaceholder")}
              className="h-8 text-xs"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground w-16 shrink-0">
              {t("installDialog.agents")}
            </label>
            <div className="flex flex-wrap gap-2">
              {agentConfigs?.map((agent) => (
                <label key={agent.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <Checkbox
                    checked={agents.has(agent.id)}
                    onCheckedChange={() => toggleAgent(agent.id)}
                  />
                  {agent.label}
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      <SkillContentPane
        content={content}
        onChange={setContent}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        emptyHint={t("createSkill.emptyHint")}
        previewContent={fullContent}
      />
    </div>
  );
}

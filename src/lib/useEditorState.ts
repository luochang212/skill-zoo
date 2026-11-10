import { useState, useCallback } from "react";
import { useFileDrafts } from "./useFileDrafts";
import { useSkillContent, useSaveSkillContent, useInstalledSkills } from "@/hooks/useSkills";

export function useEditorState(externalUnsaved?: { current: boolean }) {
  const [open, setOpen] = useState(false);
  const [skillId, setSkillId] = useState<string>("");
  const [directory, setDirectory] = useState<string>("");
  const [skillName, setSkillName] = useState<string>("");
  const { drafts, reset, change, has, checkpoint, acknowledge } = useFileDrafts();
  const dirty = drafts.has("SKILL.md");
  const [pendingOpen, setPendingOpen] = useState<{
    id: string;
    dir: string;
    name: string;
  } | null>(null);

  const {
    data: content,
    isLoading: contentLoading,
    isError: contentError,
  } = useSkillContent(open ? directory : "", open ? skillId : null);
  const saveMutation = useSaveSkillContent();
  const { data: installedSkills, isLoading: skillsLoading } = useInstalledSkills();

  const skill =
    open && skillId && installedSkills
      ? (installedSkills.find((s) => s.id === skillId) ?? null)
      : null;

  const localContent = open ? (drafts.get("SKILL.md") ?? content ?? "") : "";

  const openEditor = useCallback(
    (id: string, dir: string, name: string) => {
      if (has("SKILL.md") || externalUnsaved?.current) {
        setPendingOpen({ id, dir, name });
        return;
      }
      setSkillId(id);
      setDirectory(dir);
      setSkillName(name);
      reset();
      setOpen(true);
    },
    [reset, has, externalUnsaved],
  );

  const confirmSwitch = useCallback(() => {
    if (!pendingOpen) return;
    const { id, dir, name } = pendingOpen;
    setPendingOpen(null);
    setSkillId(id);
    setDirectory(dir);
    setSkillName(name);
    reset();
    setOpen(true);
  }, [pendingOpen, reset]);

  const cancelSwitch = useCallback(() => {
    setPendingOpen(null);
  }, []);

  const closeEditor = useCallback(() => {
    setOpen(false);
    reset();
  }, [reset]);

  const save = useCallback(() => {
    if (!dirty || saveMutation.isPending) return;
    const submitted = localContent;
    const saved = checkpoint("SKILL.md");
    saveMutation.mutate(
      { directory, skillId, content: submitted },
      {
        onSuccess: () => acknowledge(saved),
      },
    );
  }, [directory, skillId, localContent, dirty, saveMutation, checkpoint, acknowledge]);

  const updateContent = useCallback(
    (newContent: string) => change("SKILL.md", newContent),
    [change],
  );

  return {
    open,
    skillId,
    directory,
    skillName,
    skill,
    dirty,
    contentLoading,
    skillLoading: open && skillsLoading,
    contentError,
    localContent,
    savePending: saveMutation.isPending,
    pendingOpen,
    openEditor,
    closeEditor,
    save,
    updateContent,
    confirmSwitch,
    cancelSwitch,
  };
}

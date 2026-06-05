import { useState, useCallback, useEffect, useRef } from "react";
import { useSkillContent, useSaveSkillContent, useInstalledSkills } from "@/hooks/useSkills";

export function useEditorState() {
  const [open, setOpen] = useState(false);
  const [skillId, setSkillId] = useState<string>("");
  const [directory, setDirectory] = useState<string>("");
  const [skillName, setSkillName] = useState<string>("");
  const [localContent, setLocalContent] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [pendingOpen, setPendingOpen] = useState<{
    id: string;
    dir: string;
    name: string;
  } | null>(null);

  const markDirty = useCallback((value: boolean) => {
    dirtyRef.current = value;
    setDirty(value);
  }, []);

  const {
    data: content,
    isLoading: contentLoading,
    isError: contentError,
  } = useSkillContent(open ? directory : "");
  const saveMutation = useSaveSkillContent();
  const { data: installedSkills, isLoading: skillsLoading } = useInstalledSkills();

  // Resolve the full skill object from installed skills list
  const skill =
    open && skillId && installedSkills
      ? (installedSkills.find((s) => s.id === skillId) ?? null)
      : null;

  // Sync local content when loaded
  useEffect(() => {
    if (open && content !== undefined && !dirty) {
      setLocalContent(content);
    }
  }, [open, content, dirty]);

  const openEditor = useCallback(
    (id: string, dir: string, name: string) => {
      if (dirtyRef.current) {
        setPendingOpen({ id, dir, name });
        return;
      }
      setSkillId(id);
      setDirectory(dir);
      setSkillName(name);
      setLocalContent("");
      markDirty(false);
      setOpen(true);
    },
    [markDirty],
  );

  const confirmSwitch = useCallback(() => {
    if (!pendingOpen) return;
    const { id, dir, name } = pendingOpen;
    setPendingOpen(null);
    setSkillId(id);
    setDirectory(dir);
    setSkillName(name);
    setLocalContent("");
    markDirty(false);
    setOpen(true);
  }, [pendingOpen, markDirty]);

  const cancelSwitch = useCallback(() => {
    setPendingOpen(null);
  }, []);

  const closeEditor = useCallback(() => {
    setOpen(false);
    markDirty(false);
    setLocalContent("");
  }, [markDirty]);

  const save = useCallback(() => {
    if (!dirty || saveMutation.isPending) return;
    saveMutation.mutate(
      { directory, content: localContent },
      { onSuccess: () => markDirty(false) },
    );
  }, [directory, localContent, dirty, saveMutation, markDirty]);

  const updateContent = useCallback(
    (newContent: string) => {
      setLocalContent(newContent);
      markDirty(true);
    },
    [markDirty],
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

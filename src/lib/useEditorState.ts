import { useState, useCallback, useEffect } from "react";
import { useSkillContent, useSaveSkillContent, useInstalledSkills } from "@/hooks/useSkills";

export function useEditorState() {
  const [open, setOpen] = useState(false);
  const [skillId, setSkillId] = useState<string>("");
  const [directory, setDirectory] = useState<string>("");
  const [skillName, setSkillName] = useState<string>("");
  const [localContent, setLocalContent] = useState<string>("");
  const [dirty, setDirty] = useState(false);

  const {
    data: content,
    isLoading: contentLoading,
    isError: contentError,
  } = useSkillContent(open ? directory : "");
  const saveMutation = useSaveSkillContent();
  const { data: installedSkills } = useInstalledSkills();

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

  const openEditor = useCallback((id: string, dir: string, name: string) => {
    setSkillId(id);
    setDirectory(dir);
    setSkillName(name);
    setLocalContent("");
    setDirty(false);
    setOpen(true);
  }, []);

  const closeEditor = useCallback(() => {
    setOpen(false);
    setDirty(false);
    setLocalContent("");
  }, []);

  const save = useCallback(() => {
    if (!dirty || saveMutation.isPending) return;
    saveMutation.mutate({ directory, content: localContent }, { onSuccess: () => setDirty(false) });
  }, [directory, localContent, dirty, saveMutation]);

  const updateContent = useCallback((newContent: string) => {
    setLocalContent(newContent);
    setDirty(true);
  }, []);

  return {
    open,
    skillId,
    directory,
    skillName,
    skill,
    dirty,
    isLoading: contentLoading,
    contentError,
    localContent,
    savePending: saveMutation.isPending,
    openEditor,
    closeEditor,
    save,
    updateContent,
  };
}

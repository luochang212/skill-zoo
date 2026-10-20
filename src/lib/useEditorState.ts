import { useState, useCallback, useEffect, useRef } from "react";
import { useSkillContent, useSaveSkillContent, useInstalledSkills } from "@/hooks/useSkills";

/**
 * Tracks unsaved state the editor itself cannot see (auxiliary file drafts
 * owned by SkillContentPane) so skill switches confirm before discarding it.
 */
export function useEditorState(externalUnsaved?: { current: boolean }) {
  const [open, setOpen] = useState(false);
  const [skillId, setSkillId] = useState<string>("");
  const [directory, setDirectory] = useState<string>("");
  const [skillName, setSkillName] = useState<string>("");
  const [localContent, setLocalContent] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  // Latest editor text, mirrored synchronously so a save completion can tell
  // whether the user typed past the submitted revision while it was in flight.
  const contentRef = useRef("");
  const sessionRef = useRef(0);
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
  } = useSkillContent(open ? directory : "", open ? skillId : null);
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
      if (dirtyRef.current || externalUnsaved?.current) {
        setPendingOpen({ id, dir, name });
        return;
      }
      setSkillId(id);
      sessionRef.current += 1;
      setDirectory(dir);
      setSkillName(name);
      setLocalContent("");
      contentRef.current = "";
      markDirty(false);
      setOpen(true);
    },
    [markDirty, externalUnsaved],
  );

  const confirmSwitch = useCallback(() => {
    if (!pendingOpen) return;
    const { id, dir, name } = pendingOpen;
    setPendingOpen(null);
    sessionRef.current += 1;
    setSkillId(id);
    setDirectory(dir);
    setSkillName(name);
    setLocalContent("");
    contentRef.current = "";
    markDirty(false);
    setOpen(true);
  }, [pendingOpen, markDirty]);

  const cancelSwitch = useCallback(() => {
    setPendingOpen(null);
  }, []);

  const closeEditor = useCallback(() => {
    sessionRef.current += 1;
    setOpen(false);
    markDirty(false);
    setLocalContent("");
    contentRef.current = "";
  }, [markDirty]);

  const save = useCallback(() => {
    if (!dirty || saveMutation.isPending) return;
    const submitted = localContent;
    const submittedSession = sessionRef.current;
    saveMutation.mutate(
      { directory, skillId, content: submitted },
      {
        onSuccess: () => {
          // Only confirm the revision we submitted; keep drafts typed
          // while the save was in flight.
          if (sessionRef.current === submittedSession && contentRef.current === submitted) {
            markDirty(false);
          }
        },
      },
    );
  }, [directory, skillId, localContent, dirty, saveMutation, markDirty]);

  const updateContent = useCallback(
    (newContent: string) => {
      contentRef.current = newContent;
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

import { useState, useCallback, useEffect, Component, type ReactNode } from "react";

import { motion, AnimatePresence } from "framer-motion";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "react-i18next";
import { Header } from "@/components/layout/Header";
import { BrowseSkills } from "@/components/skills/BrowseSkills";
import { InstalledSkills } from "@/components/skills/InstalledSkills";
import { SkillDetail } from "@/components/skills/SkillDetail";
import { SkillCreateView } from "@/components/skills/SkillCreateView";
import { SettingsView } from "@/components/settings/SettingsView";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useEditorState } from "@/lib/useEditorState";
import {
  useUpdateSkill,
  useRemoveSkill,
  useStarSkill,
  useUnstarSkill,
  useSkillsWatcher,
} from "@/hooks/useSkills";
import { useSidebarFilter } from "@/hooks/useSidebarFilter";
import { applyTheme } from "@/hooks/useTheme";
import type { View, DiscoverRepo } from "@/types/skills";

interface EBProps {
  children: ReactNode;
}
interface EBState {
  hasError: boolean;
  error: Error | null;
}
class ErrorBoundary extends Component<EBProps, EBState> {
  state: EBState = { hasError: false, error: null };
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-full p-8">
          <div className="text-center space-y-2">
            <p className="text-red-500 font-bold">Render Error</p>
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap max-h-60 overflow-auto">
              {this.state.error?.message}
            </pre>
            <button
              className="text-xs underline"
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const { t } = useTranslation();
  const [view, setView] = useState<View>("local");
  const [showCreateSkill, setShowCreateSkill] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<DiscoverRepo | null>(null);
  const editor = useEditorState();
  const updateMutation = useUpdateSkill();
  const removeMutation = useRemoveSkill();
  const starMutation = useStarSkill();
  const unstarMutation = useUnstarSkill();
  const sidebarFilter = useSidebarFilter();
  useSkillsWatcher();

  useEffect(() => {
    const theme = (localStorage.getItem("theme") as string | null) ?? "light";
    applyTheme(theme as "light" | "dark" | "system");
  }, []);

  const handleDragMouseDown = async (e: React.MouseEvent) => {
    if (e.buttons !== 1) return;
    // Don't start window drag on interactive elements — it would consume
    // the click event and prevent buttons/links from working.
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea, [role="button"]')) return;
    const win = getCurrentWindow();
    if (e.detail === 2) {
      await win.toggleMaximize();
      return;
    }
    await win.startDragging();
  };

  const handleUpdate = () => {
    if (!editor.skillId) return;
    updateMutation.mutate(editor.skillId);
  };

  const handleRemove = () => {
    if (!editor.skillId) return;
    removeMutation.mutate(editor.skillId, { onSuccess: editor.closeEditor });
  };

  const handleToggleStar = () => {
    if (!editor.skillId || !editor.skill) return;
    if (editor.skill.starred) {
      unstarMutation.mutate(editor.skillId);
    } else {
      starMutation.mutate(editor.skillId);
    }
  };

  const handleOpenCreateSkill = useCallback(() => {
    setShowCreateSkill(true);
  }, []);

  const handleCloseCreateSkill = useCallback(() => {
    setShowCreateSkill(false);
  }, []);

  const handleCreatedSkill = useCallback(
    (id: string, directory: string, name: string) => {
      setShowCreateSkill(false);
      editor.openEditor(id, directory, name);
    },
    [editor],
  );

  // Determine what to render in main area
  const renderMain = () => {
    if (editor.open) {
      return (
        <SkillDetail
          skill={editor.skill}
          skillName={editor.skillName}
          isLoading={editor.isLoading}
          isError={editor.contentError}
          content={editor.localContent}
          onChange={editor.updateContent}
          onBack={editor.closeEditor}
          onUpdate={handleUpdate}
          onRemove={handleRemove}
          onToggleStar={handleToggleStar}
          updatePending={updateMutation.isPending}
          removePending={removeMutation.isPending}
          onSave={editor.save}
          savePending={editor.savePending}
          dirty={editor.dirty}
        />
      );
    }

    if (showCreateSkill) {
      return <SkillCreateView onClose={handleCloseCreateSkill} onCreated={handleCreatedSkill} />;
    }

    return (
      <>
        {view === "discover" && (
          <BrowseSkills selectedRepo={selectedRepo} onSelectRepo={setSelectedRepo} />
        )}
        {view === "local" && (
          <InstalledSkills
            onViewSkill={editor.openEditor}
            category={sidebarFilter.category}
            onSelectCategory={sidebarFilter.selectCategory}
            onCreateSkill={handleOpenCreateSkill}
          />
        )}
        {view === "settings" && <SettingsView />}
      </>
    );
  };

  return (
    <>
      {editor.pendingOpen && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) editor.cancelSwitch();
          }}
        >
          <DialogContent className="sm:max-w-[380px]">
            <DialogHeader>
              <DialogTitle>{t("unsavedDialog.title")}</DialogTitle>
              <DialogDescription>{t("unsavedDialog.description")}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={editor.cancelSwitch}>
                {t("unsavedDialog.keepEditing")}
              </Button>
              <Button variant="destructive" size="sm" onClick={editor.confirmSwitch}>
                {t("unsavedDialog.discard")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      <div className="h-screen flex flex-col bg-background">
        <Header
          view={view}
          onViewChange={setView}
          hideTabs={editor.open || showCreateSkill || !!selectedRepo}
          onDragMouseDown={handleDragMouseDown}
        />
        <main className="flex-1 min-h-0">
          <ErrorBoundary>
            <AnimatePresence mode="wait">
              <motion.div
                key={editor.open ? `edit-${editor.skillId}` : showCreateSkill ? "create" : view}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="h-full"
              >
                {renderMain()}
              </motion.div>
            </AnimatePresence>
          </ErrorBoundary>
        </main>
      </div>
    </>
  );
}

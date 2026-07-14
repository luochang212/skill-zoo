import {
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  Component,
  type ReactNode,
} from "react";

import { motion, AnimatePresence } from "framer-motion";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEditorState } from "@/lib/useEditorState";
import {
  useUpdateSkill,
  useRemoveSkill,
  useArchiveSkill,
  useRestoreArchivedSkill,
  useArchivedSkills,
  useArchivedSkillContent,
  useStarSkill,
  useUnstarSkill,
  useSkillsWatcher,
} from "@/hooks/useSkills";
import { applyTheme } from "@/hooks/useTheme";
import { settingsApi } from "@/lib/api/settings";
import type { View, DiscoverRepo, SidebarCategory } from "@/types/skills";

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
            <ScrollArea className="max-h-60">
              <pre className="text-xs text-muted-foreground whitespace-pre-wrap">
                {this.state.error?.message}
              </pre>
            </ScrollArea>
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

// Module-scope handler: it captures no component state, so it doesn't need to
// live inside App (and be recreated every render). Starts a window drag unless
// the pointer is over an interactive element; double-click toggles maximize.
async function handleDragMouseDown(e: React.MouseEvent) {
  if (e.buttons !== 1) return;
  const target = e.target as HTMLElement;
  if (target.closest('button, a, input, select, textarea, [role="button"]')) return;
  const win = getCurrentWindow();
  if (e.detail === 2) {
    await win.toggleMaximize();
    return;
  }
  await win.startDragging();
}

export default function App() {
  const { i18n, t } = useTranslation();
  const [view, setView] = useState<View>("local");
  const [skillCompanionOpenRequest, setSkillCompanionOpenRequest] = useState(0);
  const skillCompanionRequestCounter = useRef(0);
  const [showCreateSkill, setShowCreateSkill] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<DiscoverRepo | null>(null);
  const [archivedEditor, setArchivedEditor] = useState<{ archiveId: string; name: string } | null>(
    null,
  );
  const detailOverlayRef = useRef<HTMLDivElement>(null);
  const editor = useEditorState();
  const updateMutation = useUpdateSkill();
  const removeMutation = useRemoveSkill();
  const archiveMutation = useArchiveSkill();
  const restoreMutation = useRestoreArchivedSkill();
  const starMutation = useStarSkill();
  const unstarMutation = useUnstarSkill();
  const { data: archivedSkills, isLoading: archivedSkillsLoading } = useArchivedSkills();
  const {
    data: archivedContent = "",
    isLoading: archivedContentLoading,
    isError: archivedError,
  } = useArchivedSkillContent(archivedEditor?.archiveId ?? null);
  const [category, setCategory] = useState<SidebarCategory>({ type: "all" });
  useSkillsWatcher();

  useEffect(() => {
    const theme = (localStorage.getItem("theme") as string | null) ?? "system";
    applyTheme(theme as "light" | "dark" | "system");
  }, []);

  useEffect(() => {
    settingsApi.setTrayLanguage(i18n.language).catch((error) => {
      console.error("Failed to update tray language", error);
    });
  }, [i18n.language]);

  // Listen for navigation requests from the tray menu (e.g. "设置" → settings view).
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<string>("navigate", (event) => {
      const target = event.payload;
      if (target === "settings") {
        setView("settings");
      } else if (target === "settings:skill-companion") {
        setView("settings");
        skillCompanionRequestCounter.current += 1;
        setSkillCompanionOpenRequest(skillCompanionRequestCounter.current);
      }
    }).then((registeredUnlisten) => {
      if (disposed) {
        registeredUnlisten();
      } else {
        unlisten = registeredUnlisten;
      }
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const hasLocalDetail = view === "local" && !showCreateSkill && (editor.open || !!archivedEditor);

  useLayoutEffect(() => {
    if (hasLocalDetail) {
      detailOverlayRef.current?.focus();
    }
  }, [hasLocalDetail, editor.skillId, archivedEditor?.archiveId]);

  const handleUpdate = async () => {
    if (!editor.skillId) return Promise.resolve(null);
    return updateMutation.mutateAsync(editor.skillId);
  };

  const handleRemove = () => {
    if (!editor.skillId) return;
    removeMutation.mutate(editor.skillId, { onSuccess: editor.closeEditor });
  };

  const handleArchive = () => {
    if (!editor.skillId || editor.dirty) return;
    archiveMutation.mutate(editor.skillId, {
      onSuccess: () => {
        editor.closeEditor();
        setCategory({ type: "archived" });
      },
    });
  };

  const handleOpenArchivedSkill = useCallback((archiveId: string, name: string) => {
    setArchivedEditor({ archiveId, name });
  }, []);

  const handleCloseArchivedSkill = useCallback(() => {
    setArchivedEditor(null);
  }, []);

  const handleRestoreArchivedSkill = () => {
    if (!archivedEditor) return;
    restoreMutation.mutate(archivedEditor.archiveId, {
      onSuccess: (skill) => {
        setArchivedEditor(null);
        setCategory({ type: "all" });
        editor.openEditor(skill.id, skill.directory, skill.name);
      },
    });
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

  const renderSkillDetail = () => {
    if (archivedEditor) {
      const archivedSkill =
        archivedSkills?.find((skill) => skill.id === archivedEditor.archiveId) ?? null;
      return (
        <SkillDetail
          skill={archivedSkill}
          skillName={archivedEditor.name}
          skillLoading={archivedSkillsLoading}
          contentLoading={archivedContentLoading}
          isError={archivedError}
          content={archivedContent}
          onChange={() => {}}
          onBack={handleCloseArchivedSkill}
          onRestore={handleRestoreArchivedSkill}
          restorePending={restoreMutation.isPending}
          readOnly
        />
      );
    }

    if (editor.open) {
      return (
        <SkillDetail
          skill={editor.skill}
          skillName={editor.skillName}
          skillLoading={editor.skillLoading}
          contentLoading={editor.contentLoading}
          isError={editor.contentError}
          content={editor.localContent}
          onChange={editor.updateContent}
          onBack={editor.closeEditor}
          onUpdate={handleUpdate}
          onRemove={handleRemove}
          onArchive={handleArchive}
          onToggleStar={handleToggleStar}
          updatePending={updateMutation.isPending && updateMutation.variables === editor.skillId}
          removePending={removeMutation.isPending}
          archivePending={archiveMutation.isPending}
          archiveDisabled={editor.dirty}
          onSave={editor.save}
          savePending={editor.savePending}
          dirty={editor.dirty}
        />
      );
    }

    return null;
  };

  const renderLocalSkills = () => (
    <InstalledSkills
      onViewSkill={editor.openEditor}
      onViewArchivedSkill={handleOpenArchivedSkill}
      category={category}
      onSelectCategory={setCategory}
      onCreateSkill={handleOpenCreateSkill}
    />
  );

  // Determine what to render in main area
  const renderMain = () => {
    const detail = renderSkillDetail();
    if (detail) return detail;

    if (showCreateSkill) {
      return <SkillCreateView onClose={handleCloseCreateSkill} onCreated={handleCreatedSkill} />;
    }

    return (
      <>
        {view === "discover" && (
          <BrowseSkills selectedRepo={selectedRepo} onSelectRepo={setSelectedRepo} />
        )}
        {view === "local" && renderLocalSkills()}
        {view === "settings" && (
          <SettingsView
            skillCompanionOpenRequest={skillCompanionOpenRequest}
            onSkillCompanionOpenHandled={() => setSkillCompanionOpenRequest(0)}
          />
        )}
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
          hideTabs={editor.open || !!archivedEditor || showCreateSkill || !!selectedRepo}
          onDragMouseDown={handleDragMouseDown}
        />
        <main className="flex-1 min-h-0">
          <ErrorBoundary>
            {view === "local" && !showCreateSkill ? (
              <div className="h-full relative">
                <div
                  className="h-full"
                  aria-hidden={hasLocalDetail ? true : undefined}
                  inert={hasLocalDetail ? true : undefined}
                >
                  {renderLocalSkills()}
                </div>
                {(editor.open || archivedEditor) && (
                  <div
                    ref={detailOverlayRef}
                    tabIndex={-1}
                    className="absolute inset-0 z-10 bg-background"
                  >
                    {renderSkillDetail()}
                  </div>
                )}
              </div>
            ) : (
              <AnimatePresence mode="wait">
                <motion.div
                  key={showCreateSkill ? "create" : view}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="h-full"
                >
                  {renderMain()}
                </motion.div>
              </AnimatePresence>
            )}
          </ErrorBoundary>
        </main>
      </div>
    </>
  );
}

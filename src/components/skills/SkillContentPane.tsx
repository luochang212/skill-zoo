import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { MarkdownContent } from "@/components/skills/MarkdownContent";
import { SkillFileTree } from "@/components/skills/SkillFileTree";
import { cn } from "@/lib/utils";
import { Eye, Pencil, Columns2, PanelLeftOpen, PanelLeftClose, FileX } from "lucide-react";
import { useSkillFiles, useSkillFileContent, useSaveSkillFileContent } from "@/hooks/useSkills";
import { skillsApi } from "@/lib/api/skills";
import { formatRelativeDate } from "@/lib/date";
import type { SkillFileNode } from "@/types/skills";

export type ContentTab = "overview" | "edit" | "split";

interface SkillContentPaneProps {
  content: string;
  onChange: (content: string) => void;
  activeTab: ContentTab;
  onTabChange: (tab: ContentTab) => void;
  isLoading?: boolean;
  emptyHint?: string;
  previewContent?: string;
  updatedAt?: string;
  directory?: string;
  // SKILL.md save controls (passed through from parent)
  onSave?: () => void;
  savePending?: boolean;
  dirty?: boolean;
}

const SPLIT_MIN = 20;
const SPLIT_DEFAULT = 50;

/** Flatten a tree of SkillFileNodes into a flat list of files (no dirs). */
function flattenNodes(nodes: SkillFileNode[]): SkillFileNode[] {
  const result: SkillFileNode[] = [];
  for (const node of nodes) {
    if (node.isDir && node.children) {
      result.push(...flattenNodes(node.children));
    } else if (!node.isDir) {
      result.push(node);
    }
  }
  return result;
}

// Synced scroll helpers for split view
function getScrollRatio(el: HTMLElement) {
  const maxScroll = el.scrollHeight - el.clientHeight;
  return maxScroll > 0 ? el.scrollTop / maxScroll : 0;
}

function applyScrollRatio(el: HTMLElement, ratio: number) {
  el.scrollTop = ratio * (el.scrollHeight - el.clientHeight);
}

export function SkillContentPane({
  content,
  onChange,
  activeTab,
  onTabChange,
  isLoading,
  emptyHint,
  previewContent,
  updatedAt,
  directory,
  onSave,
  savePending,
  dirty,
}: SkillContentPaneProps) {
  const { t } = useTranslation();

  // ── Split pane state (for overview/edit/split) ──
  const [splitPct, setSplitPct] = useState(SPLIT_DEFAULT);
  const [dragging, setDragging] = useState(false);
  const panesRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const previewViewportRef = useRef<HTMLDivElement | null>(null);
  const syncSourceRef = useRef<{ source: "edit" | "preview"; time: number } | null>(null);

  // ── Sidebar + file selection state ──
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(208); // px, matches w-52
  const [sidebarDragging, setSidebarDragging] = useState(false);
  const sidebarRowRef = useRef<HTMLDivElement>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [fileEditContent, setFileEditContent] = useState<string | null>(null);

  // ── File tree query (always active when directory is set) ──
  const { data: nodes = [] } = useSkillFiles(directory ?? null);

  // ── Resolve selected node ──
  const allFiles = flattenNodes(nodes);
  const selectedNode = allFiles.find((n) => n.path === selectedFilePath) ?? null;
  const isSkillMdActive = selectedNode?.isSkillMd ?? true;

  // ── Auto-select SKILL.md and expand sidebar if extra files exist ──
  useEffect(() => {
    if (selectedFilePath === null && nodes.length > 0) {
      const skillMd = allFiles.find((n) => n.isSkillMd);
      if (skillMd) setSelectedFilePath(skillMd.path);
      if (allFiles.some((n) => !n.isSkillMd)) setSidebarOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  // ── Reset local edit content when switching files ──
  useEffect(() => {
    setFileEditContent(null);
  }, [selectedFilePath]);

  // ── Non-SKILL.md file content ──
  const {
    data: fileData,
    isLoading: fileLoading,
    error: fileError,
  } = useSkillFileContent(isSkillMdActive ? null : selectedFilePath);
  const isBinary =
    typeof fileError === "string"
      ? fileError === "BINARY_FILE"
      : (fileError as Error | null)?.message === "BINARY_FILE";

  const saveFileMutation = useSaveSkillFileContent();

  // ── Routing: what actually drives the editor ──
  const displayContent = isSkillMdActive
    ? (previewContent ?? content)
    : (fileEditContent ?? fileData ?? "");
  const editableContent = isSkillMdActive ? content : (fileEditContent ?? fileData ?? "");
  const handleChange = isSkillMdActive ? onChange : (v: string) => setFileEditContent(v);
  const isDirty = !isSkillMdActive && fileEditContent !== null && fileEditContent !== fileData;

  const handleFileSave = useCallback(() => {
    if (!selectedFilePath || !isDirty || saveFileMutation.isPending) return;
    saveFileMutation.mutate(
      { path: selectedFilePath, content: fileEditContent! },
      { onSuccess: () => setFileEditContent(null) },
    );
  }, [selectedFilePath, isDirty, fileEditContent, saveFileMutation]);

  // ── Tab change: only forward to parent for SKILL.md ──
  const handleTabChange = useCallback(
    (tab: ContentTab) => {
      onTabChange(tab);
    },
    [onTabChange],
  );

  // ── Drag-to-resize split pane ──
  const onDividerDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const container = panesRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setSplitPct(Math.max(SPLIT_MIN, Math.min(100 - SPLIT_MIN, pct)));
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  // ── Sidebar resize drag ──
  const SIDEBAR_MIN = 120;
  const SIDEBAR_MAX = 400;
  const onSidebarDividerDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setSidebarDragging(true);
  }, []);

  useEffect(() => {
    if (!sidebarDragging) return;
    const onMove = (e: MouseEvent) => {
      const row = sidebarRowRef.current;
      if (!row) return;
      const rect = row.getBoundingClientRect();
      const w = e.clientX - rect.left;
      setSidebarWidth(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, w)));
    };
    const onUp = () => setSidebarDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [sidebarDragging]);

  // ── Synced scroll for split view ──
  const SYNC_GRACE_MS = 100;
  const onEditScroll = useCallback(() => {
    const s = syncSourceRef.current;
    if (s && s.source !== "edit" && Date.now() - s.time < SYNC_GRACE_MS) return;
    const edit = editRef.current;
    const preview = previewViewportRef.current;
    if (!edit || !preview) return;
    syncSourceRef.current = { source: "edit", time: Date.now() };
    applyScrollRatio(preview, getScrollRatio(edit));
  }, []);

  const onPreviewScroll = useCallback(() => {
    const s = syncSourceRef.current;
    if (s && s.source !== "preview" && Date.now() - s.time < SYNC_GRACE_MS) return;
    const edit = editRef.current;
    const preview = previewViewportRef.current;
    if (!edit || !preview) return;
    syncSourceRef.current = { source: "preview", time: Date.now() };
    applyScrollRatio(edit, getScrollRatio(preview));
  }, []);

  // ── Preview content for non-SKILL.md files ──
  const isMd =
    selectedNode?.name.toLowerCase().endsWith(".md") ||
    selectedNode?.name.toLowerCase().endsWith(".mdx");

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* ── Tab toggle bar (full width) ── */}
      <div
        className="px-3 py-2 shrink-0 border-b border-border flex items-center gap-2"
        role="tablist"
      >
        {/* Sidebar toggle */}
        <button
          onClick={() => setSidebarOpen((v) => !v)}
          title={sidebarOpen ? t("skillFiles.hideSidebar") : t("skillFiles.showSidebar")}
          className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
        >
          {sidebarOpen ? (
            <PanelLeftClose className="h-3.5 w-3.5" />
          ) : (
            <PanelLeftOpen className="h-3.5 w-3.5" />
          )}
        </button>

        {/* View/Edit/Split pill */}
        <button
          onClick={() => {
            const next: ContentTab =
              activeTab === "overview" ? "edit" : activeTab === "edit" ? "split" : "overview";
            handleTabChange(next);
          }}
          className="inline-flex items-center bg-muted rounded-xl p-0.5 gap-0.5 cursor-pointer"
        >
          {[
            { id: "overview" as ContentTab, icon: Eye, key: "skill.view" },
            { id: "edit" as ContentTab, icon: Pencil, key: "skill.edit" },
            { id: "split" as ContentTab, icon: Columns2, key: "skill.split" },
          ].map(({ id, icon: Icon, key }) => (
            <span
              key={id}
              onClick={(e) => {
                e.stopPropagation();
                handleTabChange(id);
              }}
              className={cn(
                "px-2.5 py-1 h-6 text-[11px] rounded-lg font-medium inline-flex items-center gap-1 transition-all duration-200",
                activeTab === id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3 w-3" />
              {t(key)}
            </span>
          ))}
        </button>

        {/* Save button — shown when dirty; hidden in overview mode for SKILL.md */}
        {(isSkillMdActive ? dirty && activeTab !== "overview" : isDirty) && (
          <button
            onClick={isSkillMdActive ? onSave : handleFileSave}
            disabled={isSkillMdActive ? (savePending ?? false) : saveFileMutation.isPending}
            className="ml-auto px-2.5 py-1 h-6 text-[11px] rounded-lg font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {(isSkillMdActive ? savePending : saveFileMutation.isPending)
              ? "…"
              : t("skillFiles.save")}
          </button>
        )}

        {/* Updated timestamp — shown whenever the save button is absent */}
        {updatedAt && !(isSkillMdActive ? dirty && activeTab !== "overview" : isDirty) && (
          <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
            {t("skill.updated")} {formatRelativeDate(Number(updatedAt))}
          </span>
        )}
      </div>

      {/* ── Below tab bar: sidebar + content side by side ── */}
      <div
        ref={sidebarRowRef}
        className="flex-1 min-h-0 flex min-w-0"
        style={sidebarDragging ? { userSelect: "none" } : undefined}
      >
        {/* Collapsible sidebar */}
        <div
          className="h-full shrink-0 overflow-hidden"
          style={{
            width: sidebarOpen ? sidebarWidth : 0,
            transition: sidebarDragging ? "none" : "width 0.2s",
          }}
        >
          <SkillFileTree
            nodes={nodes}
            selectedPath={selectedFilePath ?? undefined}
            onSelectFile={(node) => setSelectedFilePath(node.path)}
          />
        </div>

        {/* Sidebar resize divider */}
        {sidebarOpen && (
          <div
            onMouseDown={onSidebarDividerDown}
            className={cn(
              "shrink-0 cursor-col-resize transition-[width,background-color] duration-150",
              "w-px bg-border hover:w-1 hover:bg-primary/40",
              sidebarDragging && "!w-1 !bg-primary/60",
            )}
            style={{ alignSelf: "stretch" }}
          />
        )}

        {/* ── Content area ── */}
        {isBinary ? (
          /* Binary file notice */
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <FileX className="h-8 w-8 opacity-40" />
            <p className="text-sm">{t("skillFiles.binaryFile")}</p>
            <button
              onClick={() =>
                selectedFilePath && skillsApi.openSkillPath(selectedFilePath).catch(() => {})
              }
              className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-accent transition-colors"
            >
              {t("skillFiles.openInFinder")}
            </button>
          </div>
        ) : (
          /* Animated dual-pane layout */
          <div
            ref={panesRef}
            className="flex-1 min-h-0 min-w-0 flex overflow-hidden"
            role="tabpanel"
            style={dragging ? { userSelect: "none" } : undefined}
          >
            {/* Left pane — editor (visible in edit & split) */}
            <div
              className="h-full min-w-0 overflow-hidden transition-[width] duration-300 ease-in-out"
              style={{
                width:
                  activeTab === "overview" ? "0%" : activeTab === "edit" ? "100%" : `${splitPct}%`,
              }}
            >
              <textarea
                ref={editRef}
                value={editableContent}
                onChange={(e) => handleChange(e.target.value)}
                onScroll={onEditScroll}
                className="w-full h-full resize-none bg-background p-4 font-mono text-[13px] leading-relaxed focus:outline-none"
                spellCheck={false}
                aria-label={t("skill.edit")}
              />
            </div>

            {/* Divider (visible in split) */}
            <div
              className={cn(
                "shrink-0 cursor-col-resize group relative overflow-hidden transition-[width,background-color] duration-150",
                "w-0 bg-border",
                "hover:bg-primary/40",
                "active:bg-primary/60",
                dragging && "!bg-primary/60",
                activeTab === "split" && "w-px hover:w-1",
                activeTab === "split" && dragging && "!w-1",
              )}
              onMouseDown={activeTab === "split" ? onDividerDown : undefined}
              style={{ alignSelf: "stretch" }}
              role="separator"
              aria-orientation="vertical"
              aria-valuenow={Math.round(splitPct)}
              aria-valuemin={SPLIT_MIN}
              aria-valuemax={100 - SPLIT_MIN}
            />

            {/* Right pane — preview (visible in view & split) */}
            <div
              className="h-full min-w-0 overflow-hidden transition-[width] duration-300 ease-in-out"
              style={{
                width:
                  activeTab === "overview"
                    ? "100%"
                    : activeTab === "edit"
                      ? "0%"
                      : `${100 - splitPct}%`,
              }}
            >
              <div
                ref={previewViewportRef}
                onScroll={onPreviewScroll}
                className="h-full overflow-auto"
              >
                <div className="px-5 py-4 pr-6">
                  {fileLoading || isLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="h-5 w-5 border-2 border-muted-foreground/20 border-t-foreground/60 rounded-full animate-spin" />
                    </div>
                  ) : displayContent ? (
                    isSkillMdActive || isMd ? (
                      <MarkdownContent content={displayContent} />
                    ) : (
                      <pre className="text-[13px] font-mono leading-relaxed whitespace-pre-wrap break-all text-foreground">
                        {displayContent}
                      </pre>
                    )
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <p className="text-sm">{t("skill.noContent")}</p>
                      <p className="text-xs mt-1">
                        {emptyHint
                          ? emptyHint
                          : activeTab === "overview"
                            ? t("skill.noContentHintSwitch")
                            : t("skill.noContentHintType")}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

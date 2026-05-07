import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { MarkdownContent } from "@/components/skills/MarkdownContent";
import { cn } from "@/lib/utils";
import { Eye, Pencil, Columns2, FolderTree } from "lucide-react";
import { useSkillFiles } from "@/hooks/useSkills";
import { SkillFileTree } from "@/components/skills/SkillFileTree";
import { formatRelativeDate } from "@/lib/date";

export type ContentTab = "overview" | "edit" | "split" | "files";

interface SkillContentPaneProps {
  content: string;
  onChange: (content: string) => void;
  activeTab: ContentTab;
  onTabChange: (tab: ContentTab) => void;
  isLoading?: boolean;
  emptyHint?: string; // custom hint when content is empty
  previewContent?: string; // override content for preview (e.g. with frontmatter injected)
  updatedAt?: string; // ISO timestamp for "Updated" display
  directory?: string; // skill directory name (for file tree query)
}

const SPLIT_MIN = 20; // min % for each pane
const SPLIT_DEFAULT = 50; // default split position

/** File tree panel — handles query + loading/error states. */
function SkillFileTreePanel({ directory }: { directory?: string }) {
  const { t } = useTranslation();
  const { data: nodes, isLoading, isError } = useSkillFiles(directory ?? null);

  if (isLoading) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div className="h-5 w-5 border-2 border-muted-foreground/20 border-t-foreground/60 rounded-full animate-spin" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-muted-foreground">
        <p className="text-sm">{t("skillFiles.error")}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0">
      <SkillFileTree nodes={nodes ?? []} />
    </div>
  );
}

// Synced scroll helpers for split view — pure functions, no component closure needed
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
}: SkillContentPaneProps) {
  const { t } = useTranslation();
  const [splitPct, setSplitPct] = useState(SPLIT_DEFAULT);
  const [dragging, setDragging] = useState(false);
  const panesRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const previewViewportRef = useRef<HTMLDivElement | null>(null);
  const syncSourceRef = useRef<{ source: "edit" | "preview"; time: number } | null>(null);

  // Drag-to-resize split pane
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

  // Synced scroll for split view — percentage-based
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

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Tab toggle bar */}
      <div className="px-5 py-2 shrink-0 border-b border-border flex items-center" role="tablist">
        <button
          onClick={() => {
            const next: ContentTab =
              activeTab === "overview"
                ? "edit"
                : activeTab === "edit"
                  ? "split"
                  : activeTab === "split"
                    ? "files"
                    : "overview";
            onTabChange(next);
          }}
          className="inline-flex items-center bg-muted rounded-xl p-0.5 gap-0.5 cursor-pointer"
        >
          {[
            { id: "overview" as ContentTab, icon: Eye, key: "skill.view" },
            { id: "edit" as ContentTab, icon: Pencil, key: "skill.edit" },
            { id: "split" as ContentTab, icon: Columns2, key: "skill.split" },
            { id: "files" as ContentTab, icon: FolderTree, key: "skill.files" },
          ].map(({ id, icon: Icon, key }) => (
            <span
              key={id}
              onClick={(e) => {
                e.stopPropagation();
                onTabChange(id);
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
        {updatedAt && (
          <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
            {t("skill.updated")} {formatRelativeDate(Number(updatedAt))}
          </span>
        )}
      </div>

      {/* Tab content */}
      {activeTab === "files" ? (
        <SkillFileTreePanel directory={directory} />
      ) : (
        /* Animated dual-pane layout (overview / edit / split) */
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
              value={content}
              onChange={(e) => onChange(e.target.value)}
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
                {(previewContent ?? content) ? (
                  <MarkdownContent content={previewContent ?? content} />
                ) : isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="h-5 w-5 border-2 border-muted-foreground/20 border-t-foreground/60 rounded-full animate-spin" />
                  </div>
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
  );
}

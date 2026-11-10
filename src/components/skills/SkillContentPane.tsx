import { useFileDrafts } from "@/lib/useFileDrafts";
import { useState, useEffect, useLayoutEffect, useRef, useCallback, memo } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useSkillTranslation } from "@/hooks/useSkillTranslation";
import {
  useSkillProviders,
  useTranslationPreferences,
  useSaveTranslationPreferences,
} from "@/hooks/useSkillProviders";
import { initialTranslationLanguage, translationErrorCode } from "@/lib/translation";
import { SkillTranslationControls } from "./SkillTranslationControls";
import { SkillTranslationProgress } from "./SkillTranslationProgress";
import { MarkdownContent } from "@/components/skills/MarkdownContent";
import { SkillFileTree } from "@/components/skills/SkillFileTree";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  Eye,
  Pencil,
  Columns2,
  PanelLeftOpen,
  PanelLeftClose,
  FileX,
  LoaderCircle,
} from "lucide-react";
import {
  useSkillFileChildren,
  useSkillFileContent,
  useSkillImageContent,
  useSaveSkillFileContent,
} from "@/hooks/useSkills";
import { apiErrorCode } from "@/lib/api/errors";
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
  updatedLabel?: string;
  directory?: string;
  skillId?: string;
  skillName?: string;
  onSave?: () => void;
  savePending?: boolean;
  dirty?: boolean;
  readOnly?: boolean;
  enableReadOnlyFileTree?: boolean;
  hideFileTree?: boolean;
  onUnsavedDraftsChange?: (hasUnsaved: boolean) => void;
}

const SPLIT_MIN = 20;
const SPLIT_DEFAULT = 50;

function findNodeByPath(nodes: SkillFileNode[], path: string | null): SkillFileNode | null {
  if (!path) return null;
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.isDir && node.children) {
      const match = findNodeByPath(node.children, path);
      if (match) return match;
    }
  }
  return null;
}

function findSkillMd(nodes: SkillFileNode[]): SkillFileNode | null {
  for (const node of nodes) {
    if (!node.isDir && node.isSkillMd) return node;
    if (node.isDir && node.children) {
      const match = findSkillMd(node.children);
      if (match) return match;
    }
  }
  return null;
}

function hasExtraLoadedFile(nodes: SkillFileNode[]): boolean {
  return nodes.some((node) => {
    if (node.isDir) return true;
    return !node.isSkillMd;
  });
}

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
  "avif",
  "ico",
]);

function getExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i + 1).toLowerCase();
}

function isImageFile(node: SkillFileNode | null): boolean {
  return !!node && !node.isDir && IMAGE_EXTENSIONS.has(getExtension(node.name));
}

function setNodeChildren(
  nodes: SkillFileNode[],
  path: string,
  children: SkillFileNode[],
): SkillFileNode[] {
  return nodes.map((node) => {
    if (node.path === path) {
      return { ...node, children };
    }
    if (node.isDir && node.children) {
      return { ...node, children: setNodeChildren(node.children, path, children) };
    }
    return node;
  });
}

function mergeLoadedChildren(
  nextNodes: SkillFileNode[],
  currentNodes: SkillFileNode[],
): SkillFileNode[] {
  const currentByPath = new Map<string, SkillFileNode>();
  const collect = (nodes: SkillFileNode[]) => {
    for (const node of nodes) {
      currentByPath.set(node.path, node);
      if (node.children) collect(node.children);
    }
  };
  collect(currentNodes);

  return nextNodes.map((node) => {
    if (!node.isDir) return node;
    const current = currentByPath.get(node.path);
    return current?.children ? { ...node, children: current.children } : node;
  });
}

function getScrollRatio(el: HTMLElement) {
  const maxScroll = el.scrollHeight - el.clientHeight;
  return maxScroll > 0 ? el.scrollTop / maxScroll : 0;
}

function applyScrollRatio(el: HTMLElement, ratio: number) {
  el.scrollTop = ratio * (el.scrollHeight - el.clientHeight);
}

export const SkillContentPane = memo(function SkillContentPane({
  content,
  onChange,
  activeTab,
  onTabChange,
  isLoading,
  emptyHint,
  previewContent,
  updatedAt,
  updatedLabel,
  directory,
  skillId,
  skillName,
  onSave,
  savePending,
  dirty,
  readOnly = false,
  enableReadOnlyFileTree = false,
  hideFileTree = false,
  onUnsavedDraftsChange,
}: SkillContentPaneProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const fileTreeDisabled = hideFileTree || (readOnly && !enableReadOnlyFileTree);

  const [splitPct, setSplitPct] = useState(SPLIT_DEFAULT);
  const [dragging, setDragging] = useState(false);
  const panesRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const previewViewportRef = useRef<HTMLDivElement | null>(null);
  const syncSourceRef = useRef<{ source: "edit" | "preview"; time: number } | null>(null);

  const [sidebarOpen, setSidebarOpen] = useState(!readOnly && !hideFileTree);
  const [sidebarWidth, setSidebarWidth] = useState(208);
  const [sidebarDragging, setSidebarDragging] = useState(false);
  const sidebarRowRef = useRef<HTMLDivElement>(null);
  const sidebarPaneRef = useRef<HTMLDivElement>(null);
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  const navigationRequest = useRef(0);
  const [documentFragment, setDocumentFragment] = useState("");
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const {
    drafts: fileDrafts,
    reset: resetDrafts,
    change: changeDraft,
    checkpoint,
    acknowledge,
  } = useFileDrafts();
  const sessionRef = useRef(0);
  const fileDraft = selectedFilePath !== null ? (fileDrafts.get(selectedFilePath) ?? null) : null;
  const [nodes, setNodes] = useState<SkillFileNode[]>([]);
  const [loadingDirPaths, setLoadingDirPaths] = useState<Set<string>>(() => new Set());
  const [errorDirPaths, setErrorDirPaths] = useState<Set<string>>(() => new Set());
  const loadingDirPathsRef = useRef<Set<string>>(new Set());

  const {
    data: rootNodes,
    isLoading: rootLoading,
    isError: rootError,
    refetch: refetchRootNodes,
  } = useSkillFileChildren(fileTreeDisabled ? null : (directory ?? null), null, skillId);

  const selectedNode =
    findNodeByPath(nodes, selectedFilePath) ??
    (selectedFilePath
      ? {
          path: selectedFilePath,
          name: selectedFilePath.split("/").at(-1)!,
          isDir: false,
          isSkillMd: selectedFilePath === "SKILL.md",
        }
      : null);
  const isSkillMdActive = selectedNode?.isSkillMd ?? true;
  const isImageActive = isImageFile(selectedNode);

  useLayoutEffect(() => {
    sessionRef.current += 1;
    navigationRequest.current += 1;
    setNodes([]);
    setSelectedFilePath(null);
    setDocumentFragment("");
    resetDrafts();
    loadingDirPathsRef.current = new Set();
    setLoadingDirPaths(new Set());
    setErrorDirPaths(new Set());
    setSidebarOpen(!fileTreeDisabled);
  }, [skillId, directory, fileTreeDisabled, resetDrafts]);

  useEffect(() => {
    if (rootNodes) {
      setNodes((current) => mergeLoadedChildren(rootNodes, current));
      setSelectedFilePath((current) => {
        if (current !== null) return current;
        const skillMd = findSkillMd(rootNodes);
        return skillMd?.path ?? null;
      });
      setSidebarOpen(!fileTreeDisabled && hasExtraLoadedFile(rootNodes));
    }
  }, [rootNodes, fileTreeDisabled]);

  useEffect(() => {
    if (selectedFilePath === null && nodes.length > 0) {
      const skillMd = findSkillMd(nodes);
      if (skillMd) setSelectedFilePath(skillMd.path);
    }
  }, [nodes, selectedFilePath]);

  const onUnsavedDraftsChangeRef = useRef(onUnsavedDraftsChange);
  useEffect(() => {
    onUnsavedDraftsChangeRef.current = onUnsavedDraftsChange;
  });
  const hasUnsavedDrafts = fileDrafts.size > 0;
  useEffect(() => {
    onUnsavedDraftsChangeRef.current?.(hasUnsavedDrafts);
    return () => onUnsavedDraftsChangeRef.current?.(false);
  }, [hasUnsavedDrafts]);

  const {
    data: fileData,
    isLoading: fileLoading,
    error: fileError,
  } = useSkillFileContent(skillId, isSkillMdActive || isImageActive ? null : selectedFilePath);
  const {
    data: imageData,
    isLoading: imageLoading,
    error: imageError,
  } = useSkillImageContent(skillId, isImageActive ? selectedFilePath : null);
  const fileErrorCode = apiErrorCode(fileError);
  const imageErrorCode = apiErrorCode(imageError);
  const isBinary = fileErrorCode === "binaryFile";
  const isViewOnlyFile = isImageActive || isBinary || !!imageError;
  const effectiveActiveTab = isViewOnlyFile ? "overview" : activeTab;

  useEffect(() => {
    if (isViewOnlyFile && activeTab !== "overview") {
      onTabChange("overview");
    }
  }, [activeTab, isViewOnlyFile, onTabChange]);

  const saveFileMutation = useSaveSkillFileContent();

  const displayContent = isSkillMdActive
    ? (previewContent ?? content)
    : (fileDraft ?? fileData ?? "");
  const editableContent = isSkillMdActive ? content : (fileDraft ?? fileData ?? "");
  const handleChange = readOnly
    ? () => {}
    : isSkillMdActive
      ? onChange
      : (v: string) => {
          if (selectedFilePath !== null) {
            const savingThisFile =
              saveFileMutation.isPending &&
              saveFileMutation.variables.skillId === skillId &&
              saveFileMutation.variables.path === selectedFilePath;
            changeDraft(selectedFilePath, v, fileData, savingThisFile);
          }
        };
  const isDirty = !isSkillMdActive && fileDraft !== null && fileDraft !== fileData;

  const handleFileSave = useCallback(() => {
    if (!skillId || !selectedFilePath || !isDirty || saveFileMutation.isPending) return;
    const submittedPath = selectedFilePath;
    const submittedContent = fileDraft!;
    const saved = checkpoint(submittedPath);
    saveFileMutation.mutate(
      { skillId, path: submittedPath, content: submittedContent },
      {
        onSuccess: () => acknowledge(saved),
      },
    );
  }, [skillId, selectedFilePath, isDirty, fileDraft, saveFileMutation, checkpoint, acknowledge]);

  const handleLoadChildren = useCallback(
    async (node: SkillFileNode) => {
      if (!directory || fileTreeDisabled || !node.isDir || node.children) return;
      if (loadingDirPathsRef.current.has(node.path)) return;
      const session = sessionRef.current;

      loadingDirPathsRef.current = new Set(loadingDirPathsRef.current).add(node.path);
      setLoadingDirPaths(loadingDirPathsRef.current);

      setErrorDirPaths((current) => {
        const next = new Set(current);
        next.delete(node.path);
        return next;
      });

      try {
        const children = await queryClient.fetchQuery({
          queryKey: ["skills", "fileChildren", skillId, directory, node.path],
          queryFn: () => skillsApi.listSkillFiles(skillId!, node.path),
          staleTime: 30 * 1000,
        });
        if (sessionRef.current !== session) return;
        setNodes((current) => setNodeChildren(current, node.path, children));
        setErrorDirPaths((current) => {
          const next = new Set(current);
          next.delete(node.path);
          return next;
        });
      } catch {
        if (sessionRef.current !== session) return;
        setErrorDirPaths((current) => new Set(current).add(node.path));
      } finally {
        if (sessionRef.current === session) {
          const next = new Set(loadingDirPathsRef.current);
          next.delete(node.path);
          loadingDirPathsRef.current = next;
          setLoadingDirPaths(next);
        }
      }
    },
    [directory, skillId, queryClient, fileTreeDisabled],
  );

  const navigateDocument = async (path: string, fragment: string) => {
    if (!skillId || fileTreeDisabled) return;
    const session = sessionRef.current;
    const request = ++navigationRequest.current;
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : null;
    const children = await queryClient.fetchQuery({
      queryKey: ["skills", "fileChildren", skillId, directory, parent],
      queryFn: () => skillsApi.listSkillFiles(skillId, parent),
      staleTime: 30 * 1000,
    });
    if (session !== sessionRef.current || request !== navigationRequest.current) return;
    if (!children.some((node) => node.path === path && !node.isDir)) throw new Error("Not a file");
    setDocumentFragment(fragment);
    setSelectedFilePath(path);
    onTabChange("overview");
    previewViewportRef.current?.scrollTo({ top: 0 });
  };

  const handleTabChange = useCallback(
    (tab: ContentTab) => {
      onTabChange(tab);
    },
    [onTabChange],
  );

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

  const SIDEBAR_MIN = 120;
  const SIDEBAR_MAX = 400;
  const toggleSidebar = useCallback(() => {
    const next = !sidebarOpen;
    setSidebarOpen(next);
    if (!next && sidebarPaneRef.current?.contains(document.activeElement)) {
      sidebarToggleRef.current?.focus();
    }
  }, [sidebarOpen]);
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

  const isMd =
    selectedNode?.name.toLowerCase().endsWith(".md") ||
    selectedNode?.name.toLowerCase().endsWith(".mdx");
  const contentLoading = fileLoading || imageLoading || isLoading;

  const translationAvailable =
    !!skillId &&
    !hideFileTree &&
    (isSkillMdActive || selectedNode?.name.toLowerCase().endsWith(".md")) &&
    !isViewOnlyFile;
  const providers = useSkillProviders(!!skillId && !hideFileTree);
  const preferences = useTranslationPreferences(!!skillId && !hideFileTree);
  const savePreferences = useSaveTranslationPreferences();
  const targetLanguage =
    preferences.data?.targetLanguage ??
    initialTranslationLanguage(navigator.languages, i18n.language);
  const provider = providers.data?.find((p) => p.id === preferences.data?.providerId && p.enabled);
  const model = provider?.models.find((m) => m.id === preferences.data?.modelId && m.enabled);
  const translation = useSkillTranslation(
    {
      skillId: skillId ?? "",
      path: isSkillMdActive ? (selectedFilePath ?? "SKILL.md") : (selectedFilePath ?? ""),
      source: displayContent,
      providerId: provider?.id ?? "",
      modelId: model?.id ?? "",
      targetLanguage,
    },
    {
      skillName,
      preferTranslations: preferences.data?.preferCachedTranslations ?? false,
      cacheEnabled:
        translationAvailable &&
        effectiveActiveTab === "overview" &&
        !contentLoading &&
        !!displayContent &&
        !(isSkillMdActive ? dirty || savePending : isDirty || saveFileMutation.isPending),
    },
  );
  const translationDisabledReason =
    effectiveActiveTab !== "overview"
      ? t("translation.viewOnly")
      : (isSkillMdActive ? dirty || savePending : isDirty || saveFileMutation.isPending)
        ? t("translation.saveFirst")
        : contentLoading
          ? t("common.loading")
          : !displayContent
            ? t("skill.noContent")
            : new TextEncoder().encode(displayContent).length > 51200
              ? t("translation.errors.sourceLimit")
              : undefined;
  const configError = preferences.error ?? providers.error ?? savePreferences.error;
  useEffect(() => {
    if (!translationAvailable || !configError) return;
    toast.error(
      t(`translation.errors.${translationErrorCode(configError)}`, {
        defaultValue: t("translation.errors.network"),
      }),
      { id: "translation-config-error" },
    );
  }, [configError, translationAvailable, t]);
  const showTranslated =
    translationAvailable &&
    effectiveActiveTab === "overview" &&
    translation.showTranslation &&
    !!translation.text.trim();
  const renderedContent = showTranslated ? translation.text : displayContent;
  const awaitingCachedTranslation = translation.cachePending;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div
        className="relative px-3 py-2 shrink-0 border-b border-border flex items-center gap-2"
        role="group"
        aria-label={t("skill.view")}
      >
        {translationAvailable && (
          <SkillTranslationProgress key={translation.identity} status={translation.status} />
        )}
        {!fileTreeDisabled && (
          <button
            ref={sidebarToggleRef}
            onClick={toggleSidebar}
            title={sidebarOpen ? t("skillFiles.hideSidebar") : t("skillFiles.showSidebar")}
            className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
          >
            {sidebarOpen ? (
              <PanelLeftClose className="h-3.5 w-3.5" />
            ) : (
              <PanelLeftOpen className="h-3.5 w-3.5" />
            )}
          </button>
        )}

        {readOnly || isViewOnlyFile ? (
          <span className="inline-flex items-center bg-muted rounded-xl p-0.5 gap-0.5">
            <span className="px-2.5 py-1 h-6 text-[11px] rounded-lg font-medium inline-flex items-center gap-1 bg-background text-foreground shadow-sm">
              <Eye className="h-3 w-3" />
              {t("skill.view")}
            </span>
          </span>
        ) : (
          <button
            onClick={() => {
              const next: ContentTab =
                effectiveActiveTab === "overview"
                  ? "edit"
                  : effectiveActiveTab === "edit"
                    ? "split"
                    : "overview";
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
                  effectiveActiveTab === id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3 w-3" />
                {t(key)}
              </span>
            ))}
          </button>
        )}

        {translationAvailable && (
          <SkillTranslationControls
            translation={translation}
            language={targetLanguage}
            setLanguage={(language) =>
              preferences.data &&
              savePreferences.mutate({ ...preferences.data, targetLanguage: language })
            }
            unavailable={!provider || !model}
            preferencePending={
              !preferences.data ||
              savePreferences.isPending ||
              providers.isPending ||
              providers.isError
            }
            disabledReason={translationDisabledReason}
          />
        )}

        {!readOnly &&
          !isViewOnlyFile &&
          (isSkillMdActive ? dirty && effectiveActiveTab !== "overview" : isDirty) && (
            <button
              onClick={isSkillMdActive ? onSave : handleFileSave}
              disabled={isSkillMdActive ? (savePending ?? false) : saveFileMutation.isPending}
              className="press-feedback ml-auto px-2.5 py-1 h-6 text-[11px] rounded-lg font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {(isSkillMdActive ? savePending : saveFileMutation.isPending)
                ? "…"
                : t("skillFiles.save")}
            </button>
          )}

        {updatedAt &&
          (readOnly ||
            isViewOnlyFile ||
            !(isSkillMdActive ? dirty && effectiveActiveTab !== "overview" : isDirty)) && (
            <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
              {updatedLabel ?? t("skill.updated")} {formatRelativeDate(Number(updatedAt))}
            </span>
          )}
      </div>

      <div
        ref={sidebarRowRef}
        className="flex-1 min-h-0 flex min-w-0"
        style={sidebarDragging ? { userSelect: "none" } : undefined}
      >
        <div
          ref={sidebarPaneRef}
          inert={!sidebarOpen}
          className={cn(
            "h-full shrink-0 overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none",
            sidebarDragging && "!duration-0",
          )}
          style={{
            width: sidebarOpen ? sidebarWidth : 0,
          }}
        >
          <div
            className={cn(
              "h-full transition-[translate,opacity] duration-200 ease-out motion-reduce:transition-none",
              sidebarOpen ? "translate-x-0 opacity-100" : "-translate-x-full opacity-0",
            )}
            style={{
              width: sidebarWidth,
              willChange: sidebarDragging ? "translate, opacity" : undefined,
            }}
          >
            <SkillFileTree
              skillId={skillId}
              nodes={nodes}
              isLoading={rootLoading}
              isError={rootError}
              selectedPath={selectedFilePath ?? undefined}
              loadingPaths={loadingDirPaths}
              errorPaths={errorDirPaths}
              onRetry={() => refetchRootNodes()}
              onLoadChildren={handleLoadChildren}
              onRetryChildren={handleLoadChildren}
              onSelectFile={(node) => {
                navigationRequest.current += 1;
                setSelectedFilePath(node.path);
                setDocumentFragment("");
              }}
            />
          </div>
        </div>

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

        {isBinary || imageError ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <FileX className="h-8 w-8 opacity-40" />
            <p className="text-sm">
              {imageErrorCode === "imageTooLarge"
                ? t("skillFiles.imageTooLarge")
                : t("skillFiles.binaryFile")}
            </p>
            <button
              onClick={() => {
                if (skillId && selectedFilePath) {
                  skillsApi.openSkillPath(skillId, selectedFilePath).catch(() => {});
                }
              }}
              className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-accent transition-colors"
            >
              {t("skillFiles.openInFinder")}
            </button>
          </div>
        ) : fileError ? (
          <p role="alert" className="p-5 text-sm text-destructive">
            {t("markdown.openError")}
          </p>
        ) : (
          <div
            ref={panesRef}
            className="flex-1 min-h-0 min-w-0 flex overflow-hidden"
            role="tabpanel"
            style={dragging ? { userSelect: "none" } : undefined}
          >
            <div
              className="h-full min-w-0 overflow-hidden transition-[width] duration-300 ease-in-out motion-reduce:transition-none"
              style={{
                width:
                  effectiveActiveTab === "overview"
                    ? "0%"
                    : effectiveActiveTab === "edit"
                      ? "100%"
                      : `${splitPct}%`,
              }}
            >
              <textarea
                ref={editRef}
                value={effectiveActiveTab === "overview" ? "" : editableContent}
                onChange={(e) => handleChange(e.target.value)}
                onScroll={onEditScroll}
                readOnly={readOnly || isImageActive}
                className="w-full h-full resize-none bg-background p-4 font-mono text-[13px] leading-relaxed focus:outline-none"
                spellCheck={false}
                aria-label={t("skill.edit")}
              />
            </div>

            <div
              className={cn(
                "shrink-0 cursor-col-resize group relative overflow-hidden transition-[width,background-color] duration-150",
                "w-0 bg-border",
                "hover:bg-primary/40",
                "active:bg-primary/60",
                dragging && "!bg-primary/60",
                effectiveActiveTab === "split" && "w-px hover:w-1",
                effectiveActiveTab === "split" && dragging && "!w-1",
              )}
              onMouseDown={effectiveActiveTab === "split" ? onDividerDown : undefined}
              style={{ alignSelf: "stretch" }}
              role="separator"
              aria-orientation="vertical"
              aria-valuenow={Math.round(splitPct)}
              aria-valuemin={SPLIT_MIN}
              aria-valuemax={100 - SPLIT_MIN}
            />

            <div
              className="h-full min-w-0 overflow-hidden transition-[width] duration-300 ease-in-out motion-reduce:transition-none"
              style={{
                width:
                  effectiveActiveTab === "overview"
                    ? "100%"
                    : effectiveActiveTab === "edit"
                      ? "0%"
                      : `${100 - splitPct}%`,
              }}
            >
              <ScrollArea
                className="h-full"
                viewportRef={previewViewportRef}
                onScroll={onPreviewScroll}
              >
                <div
                  className="px-5 py-4 pr-5"
                  lang={showTranslated ? targetLanguage : undefined}
                  aria-busy={contentLoading || awaitingCachedTranslation}
                >
                  {contentLoading || awaitingCachedTranslation ? (
                    <div
                      role="status"
                      aria-label={t("common.loading")}
                      className="flex items-center justify-center py-12"
                    >
                      <LoaderCircle
                        aria-hidden="true"
                        className="h-6 w-6 animate-spin text-muted-foreground motion-reduce:animate-none"
                      />
                    </div>
                  ) : isImageActive && imageData ? (
                    <div className="flex min-h-[240px] items-center justify-center">
                      <img
                        src={imageData}
                        alt={selectedNode?.name ?? ""}
                        className="max-h-[calc(100vh-220px)] max-w-full rounded-md object-contain"
                      />
                    </div>
                  ) : renderedContent ? (
                    isSkillMdActive || isMd ? (
                      <MarkdownContent
                        content={renderedContent}
                        documentPath={selectedFilePath ?? "SKILL.md"}
                        fragment={documentFragment}
                        onDocumentLink={navigateDocument}
                      />
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
                          : effectiveActiveTab === "overview"
                            ? t("skill.noContentHintSwitch")
                            : t("skill.noContentHintType")}
                      </p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

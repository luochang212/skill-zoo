import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { skillsApi } from "@/lib/api/skills";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Folder,
  File,
  FileText,
  FileCode,
  Image,
  BookOpen,
  ChevronRight,
  ChevronDown,
  Loader2,
} from "lucide-react";
import type { SkillFileNode } from "@/types/skills";

function getExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i + 1).toLowerCase();
}

/** Pick an icon based on file extension. */
function getFileIcon(name: string, isSkillMd: boolean) {
  if (isSkillMd) return BookOpen;
  const ext = getExtension(name);
  switch (ext) {
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "bmp":
    case "svg":
    case "avif":
    case "ico":
      return Image;
    case "md":
    case "txt":
    case "rst":
      return FileText;
    case "py":
    case "sh":
    case "bash":
    case "zsh":
    case "js":
    case "ts":
    case "tsx":
    case "jsx":
    case "rs":
    case "go":
    case "rb":
      return FileCode;
    default:
      return File;
  }
}

/** Color classes for file type icons. */
function getIconColor(name: string, isSkillMd: boolean): string {
  if (isSkillMd) return "text-primary";
  const ext = getExtension(name);
  switch (ext) {
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "bmp":
    case "svg":
    case "avif":
    case "ico":
      return "text-teal-600 dark:text-teal-400";
    case "py":
      return "text-yellow-600 dark:text-yellow-400";
    case "sh":
    case "bash":
    case "zsh":
      return "text-green-600 dark:text-green-400";
    case "js":
    case "ts":
    case "tsx":
      return "text-blue-600 dark:text-blue-400";
    case "rs":
      return "text-orange-600 dark:text-orange-400";
    case "md":
    case "txt":
      return "text-muted-foreground";
    default:
      return "text-muted-foreground";
  }
}

interface FileTreeNodeProps {
  skillId?: string;
  node: SkillFileNode;
  depth: number;
  selectedPath?: string;
  loadingPaths?: Set<string>;
  errorPaths?: Set<string>;
  onLoadChildren?: (node: SkillFileNode) => void;
  onRetryChildren?: (node: SkillFileNode) => void;
  onSelectFile?: (node: SkillFileNode) => void;
}

function FileTreeNode({
  skillId,
  node,
  depth,
  selectedPath,
  loadingPaths,
  errorPaths,
  onLoadChildren,
  onRetryChildren,
  onSelectFile,
}: FileTreeNodeProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const isLoading = loadingPaths?.has(node.path) ?? false;
  const isError = errorPaths?.has(node.path) ?? false;

  const handleClick = useCallback(() => {
    if (node.isDir) {
      const next = !expanded;
      if (next && !node.children && !isLoading) {
        onLoadChildren?.(node);
      }
      setExpanded(next);
    } else if (onSelectFile) {
      onSelectFile(node);
    } else {
      if (skillId) skillsApi.openSkillPath(skillId, node.path).catch(() => {});
    }
  }, [expanded, isLoading, node, onLoadChildren, onSelectFile, skillId]);

  const isSelected = !node.isDir && node.path === selectedPath;
  const Icon = node.isDir ? Folder : getFileIcon(node.name, node.isSkillMd);
  const iconColor = node.isDir ? "text-muted-foreground" : getIconColor(node.name, node.isSkillMd);

  return (
    <div>
      <button
        onClick={handleClick}
        className={cn(
          "w-full flex items-center gap-1.5 py-1 pr-2 text-[13px] text-left transition-colors group",
          isSelected ? "bg-primary/15 text-foreground font-medium" : "hover:bg-accent/50",
          !node.isDir && "cursor-pointer",
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {/* Chevron for directories, spacer for files */}
        {node.isDir ? (
          expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="w-3 shrink-0" />
        )}

        <Icon className={cn("h-3.5 w-3.5 shrink-0", iconColor)} />

        <span className={cn("truncate min-w-0 flex-1", node.isSkillMd && "font-medium")}>
          {node.name}
        </span>
      </button>

      {/* Children — rendered when expanded */}
      {node.isDir && expanded && (
        <div>
          {isLoading ? (
            <div
              className="flex items-center gap-1.5 py-1 pr-2 text-[12px] text-muted-foreground"
              style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
            >
              <span className="w-3 shrink-0" />
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              <span className="truncate">{t("common.loading")}</span>
            </div>
          ) : isError ? (
            <button
              onClick={() => onRetryChildren?.(node)}
              className="w-full flex items-center gap-1.5 py-1 pr-2 text-[12px] text-left text-destructive hover:bg-accent/50"
              style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
            >
              <span className="w-3 shrink-0" />
              <span className="truncate">{t("skillFiles.error")}</span>
              <span className="text-muted-foreground">{t("error.retry")}</span>
            </button>
          ) : (
            node.children?.map((child) => (
              <FileTreeNode
                skillId={skillId}
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                loadingPaths={loadingPaths}
                errorPaths={errorPaths}
                onLoadChildren={onLoadChildren}
                onRetryChildren={onRetryChildren}
                onSelectFile={onSelectFile}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

interface SkillFileTreeProps {
  skillId?: string;
  nodes: SkillFileNode[];
  isLoading?: boolean;
  isError?: boolean;
  selectedPath?: string;
  loadingPaths?: Set<string>;
  errorPaths?: Set<string>;
  onRetry?: () => void;
  onLoadChildren?: (node: SkillFileNode) => void;
  onRetryChildren?: (node: SkillFileNode) => void;
  onSelectFile?: (node: SkillFileNode) => void;
}

export function SkillFileTree({
  skillId,
  nodes,
  isLoading,
  isError,
  selectedPath,
  loadingPaths,
  errorPaths,
  onRetry,
  onLoadChildren,
  onRetryChildren,
  onSelectFile,
}: SkillFileTreeProps) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mb-2" />
        <p className="text-sm">{t("common.loading")}</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
        <p className="text-sm text-destructive">{t("skillFiles.error")}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-accent transition-colors"
          >
            {t("error.retry")}
          </button>
        )}
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <p className="text-sm">{t("skillFiles.empty")}</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="py-1">
        {nodes.map((node) => (
          <FileTreeNode
            skillId={skillId}
            key={node.path}
            node={node}
            depth={0}
            selectedPath={selectedPath}
            loadingPaths={loadingPaths}
            errorPaths={errorPaths}
            onLoadChildren={onLoadChildren}
            onRetryChildren={onRetryChildren}
            onSelectFile={onSelectFile}
          />
        ))}
      </div>
    </ScrollArea>
  );
}

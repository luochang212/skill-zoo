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
  BookOpen,
  ChevronRight,
  ChevronDown,
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
  node: SkillFileNode;
  depth: number;
  selectedPath?: string;
  onSelectFile?: (node: SkillFileNode) => void;
}

function FileTreeNode({ node, depth, selectedPath, onSelectFile }: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(depth === 0);

  const handleClick = useCallback(() => {
    if (node.isDir) {
      setExpanded((v) => !v);
    } else if (onSelectFile) {
      onSelectFile(node);
    } else {
      skillsApi.openSkillPath(node.path).catch(() => {});
    }
  }, [node, onSelectFile]);

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
      {node.isDir && expanded && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface SkillFileTreeProps {
  nodes: SkillFileNode[];
  selectedPath?: string;
  onSelectFile?: (node: SkillFileNode) => void;
}

export function SkillFileTree({ nodes, selectedPath, onSelectFile }: SkillFileTreeProps) {
  const { t } = useTranslation();

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
            key={node.path}
            node={node}
            depth={0}
            selectedPath={selectedPath}
            onSelectFile={onSelectFile}
          />
        ))}
      </div>
    </ScrollArea>
  );
}

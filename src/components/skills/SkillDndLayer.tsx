import { DragDropProvider, DragOverlay, useDraggable, useDroppable } from "@dnd-kit/react";
import { Check, FileText } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  getAgentFromSkillDropId,
  getAgentSkillDropId,
  LOCAL_SKILL_DRAG_TYPE,
  SKILL_DRAG_ID_PREFIX,
  STAR_SKILL_DROP_ID,
} from "@/lib/skillDnd";
import type { InstalledSkill } from "@/types/skills";

const DRAG_PREVIEW_ICON_CENTER_X = 20;
const DRAG_PREVIEW_ANCHOR_Y = 12;

export type SkillDropTarget = { type: "star" } | { type: "agent"; agent: string };

function getDraggedSkillId(sourceId: string) {
  return sourceId.startsWith(SKILL_DRAG_ID_PREFIX)
    ? sourceId.slice(SKILL_DRAG_ID_PREFIX.length)
    : null;
}

export function SkillDragSource({
  skill,
  disabled,
  className,
  children,
}: {
  skill: InstalledSkill;
  disabled: boolean;
  className?: string;
  children: ReactNode;
}) {
  const { ref, isDragging } = useDraggable({
    id: `${SKILL_DRAG_ID_PREFIX}${skill.id}`,
    type: LOCAL_SKILL_DRAG_TYPE,
    disabled,
  });

  return (
    <div
      ref={ref}
      role="group"
      aria-label={skill.name}
      className={cn(
        className,
        !disabled && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-45 scale-[0.98]",
      )}
    >
      {children}
    </div>
  );
}

export function AgentDropTab({
  agent,
  label,
  active,
  draggedSkill,
  onClick,
}: {
  agent: string;
  label: string;
  active: boolean;
  draggedSkill: InstalledSkill | null;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const { ref, isDropTarget } = useDroppable({
    id: getAgentSkillDropId(agent),
    accept: LOCAL_SKILL_DRAG_TYPE,
  });
  const linked = !!draggedSkill && (draggedSkill.homeAgent === agent || !!draggedSkill.apps[agent]);
  const canLink = !!draggedSkill && !linked;

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={
        draggedSkill
          ? t(linked ? "skillDrag.alreadyLinked" : "skillDrag.linkToAgent", { agent: label })
          : label
      }
      className={cn(
        "relative h-9 px-2.5 text-xs rounded-lg transition-colors whitespace-nowrap",
        active
          ? "bg-primary/10 text-primary font-medium"
          : "text-muted-foreground hover:text-foreground hover:bg-accent",
        canLink && "bg-primary/5 text-foreground ring-1 ring-inset ring-primary/25",
        linked && draggedSkill && "bg-muted text-muted-foreground ring-1 ring-inset ring-border",
        isDropTarget && canLink && "bg-primary/15 text-primary ring-2 ring-inset ring-primary/60",
      )}
    >
      {label}
      {linked && (
        <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm">
          <Check className="h-2.5 w-2.5" />
        </span>
      )}
    </button>
  );
}

export function useStarSkillDropTarget() {
  return useDroppable({
    id: STAR_SKILL_DROP_ID,
    accept: LOCAL_SKILL_DRAG_TYPE,
  });
}

export function SkillDndLayer({
  skills,
  onDropSkill,
  children,
}: {
  skills: InstalledSkill[];
  onDropSkill: (skill: InstalledSkill, target: SkillDropTarget) => void;
  children: (state: { draggedSkill: InstalledSkill | null }) => ReactNode;
}) {
  const [draggedSkill, setDraggedSkill] = useState<InstalledSkill | null>(null);
  const [dragPreviewOffset, setDragPreviewOffset] = useState({ x: 0, y: 0 });

  return (
    <DragDropProvider
      onDragStart={({ operation }) => {
        const skillId = getDraggedSkillId(String(operation.source?.id ?? ""));
        const sourceBounds = operation.source?.element?.getBoundingClientRect();
        const initialPosition = operation.position?.initial;
        if (sourceBounds && initialPosition) {
          const grabX = initialPosition.x - sourceBounds.left;
          const grabY = initialPosition.y - sourceBounds.top;
          setDragPreviewOffset({
            x: grabX - DRAG_PREVIEW_ICON_CENTER_X,
            y: grabY - DRAG_PREVIEW_ANCHOR_Y,
          });
        } else {
          setDragPreviewOffset({ x: 0, y: 0 });
        }
        setDraggedSkill(skills.find((skill) => skill.id === skillId) ?? null);
      }}
      onDragEnd={({ canceled, operation }) => {
        const skillId = getDraggedSkillId(String(operation.source?.id ?? ""));
        const droppedSkill = skills.find((skill) => skill.id === skillId);
        const targetId = String(operation.target?.id ?? "");
        if (!canceled && droppedSkill) {
          if (targetId === STAR_SKILL_DROP_ID) {
            onDropSkill(droppedSkill, { type: "star" });
          } else {
            const agent = getAgentFromSkillDropId(targetId);
            if (agent) {
              onDropSkill(droppedSkill, { type: "agent", agent });
            }
          }
        }
        setDraggedSkill(null);
      }}
    >
      {children({ draggedSkill })}
      <DragOverlay dropAnimation={null} className="pointer-events-none z-[100] overflow-visible">
        {draggedSkill && (
          <div
            data-testid="skill-drag-preview"
            className="absolute flex h-9 w-44 items-center gap-2.5 overflow-hidden rounded-md border border-border bg-card px-3 text-card-foreground shadow-lg"
            style={{ left: dragPreviewOffset.x, top: dragPreviewOffset.y }}
          >
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="min-w-0 truncate text-[13px] font-medium">{draggedSkill.name}</p>
          </div>
        )}
      </DragOverlay>
    </DragDropProvider>
  );
}

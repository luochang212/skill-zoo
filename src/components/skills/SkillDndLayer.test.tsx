import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { InstalledSkill } from "@/types/skills";
import { SkillDragSource } from "./SkillDndLayer";

vi.mock("@dnd-kit/react", () => ({
  DragDropProvider: ({ children }: { children: ReactNode }) => children,
  DragOverlay: ({ children }: { children?: ReactNode }) => children,
  useDraggable: () => ({ ref: vi.fn(), isDragging: false }),
  useDroppable: () => ({ ref: vi.fn(), isDropTarget: false }),
}));

const skill = {
  id: "s1",
  name: "Alpha Skill",
  directory: "/tmp/skills/alpha-skill",
  apps: {},
  origin: "ssot",
  installedAt: 0,
  updatedAt: 0,
} as InstalledSkill;

function fireMouse(element: Element, type: string, button = 0) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button });
  element.dispatchEvent(event);
  return event;
}

// The left-button mousedown must stay default-canceled: with selectable card
// text, WebKit starts a native selection gesture behind the drag and
// auto-scrolls the nearest scroll container once it crosses the container's
// edge. That autoscroll is platform behavior and cannot be simulated here,
// so this suite pins the app-side contract around the gesture:
//
// - mousedown is canceled, so the selection gesture never starts;
// - pointerdown is NOT canceled, because dnd-kit's 200ms long-press pickup
//   re-reads the original pointerdown at activation time and bails on
//   defaultPrevented (a pointerdown-level preventDefault killed long-press
//   drags);
// - non-primary buttons pass through, keeping right-click menus alive.
describe("SkillDragSource", () => {
  it("cancels left-button mousedown so the native selection gesture never starts", () => {
    render(
      <SkillDragSource skill={skill} disabled={false}>
        <div>card body</div>
      </SkillDragSource>,
    );
    const card = screen.getByRole("group", { name: "Alpha Skill" });

    expect(fireMouse(card, "mousedown").defaultPrevented).toBe(true);
  });

  it("leaves pointerdown untouched so dnd-kit's long-press pickup still works", () => {
    render(
      <SkillDragSource skill={skill} disabled={false}>
        <div>card body</div>
      </SkillDragSource>,
    );
    const card = screen.getByRole("group", { name: "Alpha Skill" });

    expect(fireMouse(card, "pointerdown").defaultPrevented).toBe(false);
  });

  it("leaves non-primary buttons untouched so right-click menus survive", () => {
    render(
      <SkillDragSource skill={skill} disabled={false}>
        <div>card body</div>
      </SkillDragSource>,
    );
    const card = screen.getByRole("group", { name: "Alpha Skill" });

    expect(fireMouse(card, "mousedown", 2).defaultPrevented).toBe(false);
  });

  it("leaves mousedown untouched on disabled drag sources", () => {
    render(
      <SkillDragSource skill={skill} disabled>
        <div>card body</div>
      </SkillDragSource>,
    );
    const card = screen.getByRole("group", { name: "Alpha Skill" });

    expect(fireMouse(card, "mousedown").defaultPrevented).toBe(false);
  });
});

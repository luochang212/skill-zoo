import "@/i18n";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstalledSkills } from "./InstalledSkills";
import type { InstalledSkill } from "@/types/skills";
import type { ReactNode } from "react";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const mocks = vi.hoisted(() => ({
  skills: [] as InstalledSkill[],
  archivedSkills: [] as InstalledSkill[],
  visibleAgentOrder: ["claude-code", "codex"] as string[],
  hideNonSsot: false,
  starSkill: vi.fn(),
  toggleSymlink: vi.fn(),
  batchUnlinkSkills: vi.fn(),
  onDragStart: undefined as ((event: unknown) => void) | undefined,
  onDragEnd: undefined as ((event: unknown) => void) | undefined,
}));

vi.mock("@dnd-kit/react", () => ({
  DragDropProvider: ({
    children,
    onDragStart,
    onDragEnd,
  }: {
    children: ReactNode;
    onDragStart?: (event: unknown) => void;
    onDragEnd?: (event: unknown) => void;
  }) => {
    mocks.onDragStart = onDragStart;
    mocks.onDragEnd = onDragEnd;
    return children;
  },
  DragOverlay: ({ children }: { children: ReactNode }) => children,
  useDraggable: () => ({ ref: vi.fn(), isDragging: false }),
  useDroppable: () => ({ ref: vi.fn(), isDropTarget: false }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/hooks/useSkills", () => ({
  useInstalledSkills: () => ({
    data: mocks.skills,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useArchivedSkills: () => ({
    data: mocks.archivedSkills,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useArchiveSelectedSkills: () => ({ mutate: vi.fn(), isPending: false }),
  useBatchUnlinkSkills: () => ({ mutate: mocks.batchUnlinkSkills, isPending: false }),
  useRemoveSkills: () => ({ mutate: vi.fn(), isPending: false }),
  useRestoreArchivedSkills: () => ({ mutate: vi.fn(), isPending: false }),
  useStarSkill: () => ({ mutate: mocks.starSkill }),
  useToggleSymlink: () => ({ mutateAsync: mocks.toggleSymlink, isPending: false }),
  useUnstarSkill: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/hooks/useSettings", () => ({
  useVisibleAgentOrder: () => mocks.visibleAgentOrder,
  useHideNonSsot: () => ({ data: mocks.hideNonSsot }),
}));

vi.mock("@/lib/agents", () => ({
  useAgentConfigs: () => ({
    data: [
      { id: "claude-code", label: "Claude Code", skillsSubdir: "skills" },
      { id: "codex", label: "Codex", skillsSubdir: "skills" },
    ],
  }),
}));

vi.mock("@/hooks/useConsistencyLabelSettings", () => ({
  useConsistencyLabelSettings: () => ({
    showDuplicate: true,
    showConflict: true,
    showMismatch: true,
  }),
}));

function skill(overrides: Partial<InstalledSkill> & Pick<InstalledSkill, "id" | "name">) {
  return {
    directory: overrides.id,
    apps: {},
    origin: "ssot",
    installedAt: 1,
    updatedAt: 1,
    ...overrides,
  } satisfies InstalledSkill;
}

function renderInstalledSkills() {
  return render(
    <InstalledSkills
      category={{ type: "all" }}
      onSelectCategory={vi.fn()}
      onViewSkill={vi.fn()}
      onViewArchivedSkill={vi.fn()}
    />,
  );
}

function renderArchivedSkills() {
  return render(
    <InstalledSkills
      category={{ type: "archived" }}
      onSelectCategory={vi.fn()}
      onViewSkill={vi.fn()}
      onViewArchivedSkill={vi.fn()}
    />,
  );
}

describe("InstalledSkills visible agent filtering", () => {
  beforeEach(() => {
    globalThis.ResizeObserver = ResizeObserverMock;
    mocks.skills = [];
    mocks.archivedSkills = [];
    mocks.visibleAgentOrder = ["claude-code", "codex"];
    mocks.hideNonSsot = false;
    mocks.starSkill.mockReset();
    mocks.toggleSymlink.mockReset();
    mocks.toggleSymlink.mockResolvedValue(undefined);
    mocks.batchUnlinkSkills.mockReset();
    mocks.onDragStart = undefined;
    mocks.onDragEnd = undefined;
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.info).mockReset();
    vi.mocked(toast.error).mockReset();
    vi.useRealTimers();
  });

  afterEach(() => {
    document.querySelectorAll("[data-dnd-dragging]").forEach((element) => element.remove());
    vi.useRealTimers();
  });

  it("shows SSOT, visible-agent entity, and external skills in All", () => {
    mocks.visibleAgentOrder = ["claude-code"];
    mocks.skills = [
      skill({ id: "ssot-skill", name: "SSOT Skill", origin: "ssot", apps: {} }),
      skill({
        id: "claude-skill",
        name: "Claude Skill",
        origin: "agent",
        homeAgent: "claude-code",
        apps: { "claude-code": true },
      }),
      skill({
        id: "external-skill",
        name: "External Skill",
        origin: "external",
        apps: {},
      }),
    ];

    renderInstalledSkills();

    expect(screen.getByRole("button", { name: "SSOT Skill" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Claude Skill" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "External Skill" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All3" })).toBeInTheDocument();
  });

  it("stars an external import when its card is dropped on the Star sidebar item", () => {
    mocks.skills = [
      skill({
        id: "external-skill",
        name: "External Skill",
        origin: "external",
        apps: {},
      }),
    ];

    renderInstalledSkills();

    const card = screen.getByRole("group", { name: "External Skill" }).firstElementChild;
    expect(card).not.toHaveAttribute("data-selectable");

    act(() => {
      mocks.onDragStart?.({ operation: { source: { id: "skill:external-skill" } } });
    });
    expect(screen.getByRole("button", { name: "Drop here to star" })).toBeInTheDocument();

    act(() => {
      mocks.onDragEnd?.({
        canceled: false,
        operation: {
          source: { id: "skill:external-skill" },
          target: { id: "star-skill" },
        },
      });
    });

    expect(mocks.starSkill).toHaveBeenCalledWith("external-skill");
  });

  it("anchors the compact drag preview to the icon under the pointer", () => {
    mocks.skills = [skill({ id: "drag-skill", name: "Drag Skill" })];
    renderInstalledSkills();

    act(() => {
      mocks.onDragStart?.({
        operation: {
          source: {
            id: "skill:drag-skill",
            element: {
              getBoundingClientRect: () => ({ left: 100, top: 200, width: 240, height: 120 }),
            },
          },
          position: { initial: { x: 220, y: 260 } },
        },
      });
    });

    expect(screen.getByTestId("skill-drag-preview")).toHaveStyle({
      left: "100px",
      top: "48px",
    });
    expect(screen.getByTestId("skill-drag-preview")).toHaveClass("h-9", "w-44");
    expect(screen.getByRole("button", { name: "Drop here to link to Codex" })).toHaveClass("h-9");
  });

  it("notifies when an external import is dropped on an unlinked agent tab", async () => {
    vi.useFakeTimers();
    const activeDragFeedback = document.createElement("div");
    activeDragFeedback.setAttribute("data-dnd-dragging", "");
    activeDragFeedback.setAttribute("popover", "manual");
    document.body.append(activeDragFeedback);
    mocks.skills = [
      skill({
        id: "external-skill",
        name: "External Skill",
        origin: "external",
        apps: { "claude-code": true },
      }),
    ];

    renderInstalledSkills();

    act(() => {
      mocks.onDragStart?.({ operation: { source: { id: "skill:external-skill" } } });
    });
    expect(screen.getByRole("button", { name: "Drop here to link to Codex" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Already linked to Claude Code" }),
    ).toBeInTheDocument();

    act(() => {
      mocks.onDragEnd?.({
        canceled: false,
        operation: {
          source: { id: "skill:external-skill" },
          target: { id: "agent:codex" },
        },
      });
    });

    expect(mocks.toggleSymlink).toHaveBeenCalledWith({
      skillId: "external-skill",
      agent: "codex",
      enabled: true,
    });

    await act(async () => {});

    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(toast.success).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(48);
      vi.runOnlyPendingTimers();
    });

    expect(activeDragFeedback).toHaveAttribute("data-dnd-stale-after-drop");
    expect(activeDragFeedback).not.toHaveAttribute("data-dnd-dragging");
    expect(activeDragFeedback).not.toHaveAttribute("popover");
    expect(toast.success).toHaveBeenCalledWith("External Skill linked to Codex");
  });

  it("does not link an agent-origin skill back to its home agent", () => {
    mocks.skills = [
      skill({
        id: "claude-skill",
        name: "Claude Skill",
        origin: "agent",
        homeAgent: "claude-code",
        apps: { "claude-code": true },
      }),
    ];

    renderInstalledSkills();
    act(() => {
      mocks.onDragStart?.({ operation: { source: { id: "skill:claude-skill" } } });
      mocks.onDragEnd?.({
        canceled: false,
        operation: {
          source: { id: "skill:claude-skill" },
          target: { id: "agent:claude-code" },
        },
      });
    });

    expect(mocks.toggleSymlink).not.toHaveBeenCalled();
  });

  it("does not recreate an existing agent link", () => {
    mocks.skills = [
      skill({
        id: "linked-skill",
        name: "Linked Skill",
        apps: { codex: true },
      }),
    ];

    renderInstalledSkills();
    act(() => {
      mocks.onDragStart?.({ operation: { source: { id: "skill:linked-skill" } } });
      mocks.onDragEnd?.({
        canceled: false,
        operation: {
          source: { id: "skill:linked-skill" },
          target: { id: "agent:codex" },
        },
      });
    });

    expect(mocks.toggleSymlink).not.toHaveBeenCalled();
  });

  it("does not notify when a skill is dropped on an already linked agent tab", () => {
    mocks.skills = [
      skill({
        id: "linked-skill",
        name: "Linked Skill",
        apps: { codex: true },
      }),
    ];

    renderInstalledSkills();
    act(() => {
      mocks.onDragStart?.({ operation: { source: { id: "skill:linked-skill" } } });
      mocks.onDragEnd?.({
        canceled: false,
        operation: {
          source: { id: "skill:linked-skill" },
          target: { id: "agent:codex" },
        },
      });
    });

    expect(mocks.toggleSymlink).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("hides entity skills whose home agent is not visible", () => {
    mocks.visibleAgentOrder = ["claude-code"];
    mocks.skills = [
      skill({
        id: "codex-skill",
        name: "Codex Skill",
        origin: "agent",
        homeAgent: "codex",
        apps: { codex: true },
      }),
    ];

    renderInstalledSkills();

    expect(screen.queryByRole("button", { name: "Codex Skill" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All0" })).toBeInTheDocument();
  });

  it("still applies the hide non-SSOT setting", () => {
    mocks.visibleAgentOrder = ["claude-code"];
    mocks.hideNonSsot = true;
    mocks.skills = [
      skill({
        id: "ssot-skill",
        name: "SSOT Skill",
        origin: "ssot",
        apps: { "claude-code": true },
      }),
      skill({
        id: "agent-skill",
        name: "Agent Skill",
        origin: "agent",
        homeAgent: "claude-code",
        apps: { "claude-code": true },
      }),
      skill({
        id: "external-skill",
        name: "External Skill",
        origin: "external",
        apps: {},
      }),
    ];

    renderInstalledSkills();

    expect(screen.getByRole("button", { name: "SSOT Skill" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Agent Skill" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "External Skill" })).not.toBeInTheDocument();
  });

  it("filters cards only when a specific visible agent tab is selected", async () => {
    const user = userEvent.setup();
    mocks.visibleAgentOrder = ["claude-code", "codex"];
    mocks.skills = [
      skill({
        id: "claude-skill",
        name: "Claude Skill",
        origin: "agent",
        homeAgent: "claude-code",
        apps: { "claude-code": true },
      }),
      skill({
        id: "codex-skill",
        name: "Codex Skill",
        origin: "agent",
        homeAgent: "codex",
        apps: { codex: true },
      }),
    ];

    renderInstalledSkills();

    expect(screen.getByRole("button", { name: "Claude Skill" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Codex Skill" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Codex" }));

    expect(screen.getByRole("button", { name: "Codex Skill" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Claude Skill" })).not.toBeInTheDocument();
  });

  it("resets a hidden agent toolbar filter back to all", async () => {
    const user = userEvent.setup();
    mocks.visibleAgentOrder = ["claude-code", "codex"];
    mocks.skills = [
      skill({
        id: "claude-skill",
        name: "Claude Skill",
        origin: "agent",
        homeAgent: "claude-code",
        apps: { "claude-code": true },
      }),
      skill({
        id: "codex-skill",
        name: "Codex Skill",
        origin: "agent",
        homeAgent: "codex",
        apps: { codex: true },
      }),
    ];
    const view = renderInstalledSkills();

    await user.click(screen.getByRole("button", { name: "Codex" }));
    expect(screen.getByRole("button", { name: "Codex Skill" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Claude Skill" })).not.toBeInTheDocument();

    mocks.visibleAgentOrder = ["claude-code"];
    view.rerender(
      <InstalledSkills
        category={{ type: "all" }}
        onSelectCategory={vi.fn()}
        onViewSkill={vi.fn()}
        onViewArchivedSkill={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Claude Skill" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Codex Skill" })).not.toBeInTheDocument();
  });

  it("shows archived skill cards without visible-agent filtering in All", () => {
    mocks.visibleAgentOrder = ["claude-code"];
    mocks.archivedSkills = [
      skill({ id: "archived-claude", name: "Archived Claude", apps: { "claude-code": true } }),
      skill({ id: "archived-codex", name: "Archived Codex", apps: { codex: true } }),
    ];

    renderArchivedSkills();

    expect(screen.getByRole("button", { name: "Archived Claude" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archived Codex" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive2" })).toBeInTheDocument();
  });

  it("counts all archived skills in the sidebar", () => {
    mocks.visibleAgentOrder = ["claude-code"];
    mocks.archivedSkills = [
      skill({ id: "archived-claude", name: "Archived Claude", apps: { "claude-code": true } }),
      skill({ id: "archived-codex", name: "Archived Codex", apps: { codex: true } }),
    ];

    renderInstalledSkills();

    expect(screen.getByRole("button", { name: "Archive2" })).toBeInTheDocument();
  });

  it("does not surface consistency issues for skills whose home agent is hidden", () => {
    mocks.visibleAgentOrder = ["claude-code"];
    mocks.skills = [
      skill({
        id: "hidden-mismatch",
        name: "Hidden Mismatch",
        yamlName: "Display Name",
        origin: "agent",
        homeAgent: "codex",
        apps: { codex: true },
      }),
    ];

    renderInstalledSkills();

    expect(screen.queryByRole("button", { name: /Consistency/ })).not.toBeInTheDocument();
  });

  it("surfaces consistency issues for visible-agent entity skills", () => {
    mocks.visibleAgentOrder = ["claude-code"];
    mocks.skills = [
      skill({
        id: "visible-mismatch",
        name: "Visible Mismatch",
        yamlName: "Display Name",
        origin: "agent",
        homeAgent: "claude-code",
        apps: { "claude-code": true },
      }),
    ];

    renderInstalledSkills();

    expect(screen.getByRole("button", { name: /Consistency/ })).toBeInTheDocument();
  });

  it("does not surface consistency issues for external imports", () => {
    mocks.visibleAgentOrder = ["claude-code"];
    mocks.skills = [
      skill({
        id: "external-mismatch",
        name: "External Mismatch",
        yamlName: "Display Name",
        origin: "external",
        apps: {},
      }),
    ];

    renderInstalledSkills();

    expect(screen.getByRole("button", { name: "External Mismatch" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Consistency/ })).not.toBeInTheDocument();
  });

  it("does not blame visible agents when hide non-SSOT hides otherwise visible skills", () => {
    mocks.visibleAgentOrder = ["claude-code"];
    mocks.hideNonSsot = true;
    mocks.skills = [
      skill({
        id: "agent-skill",
        name: "Agent Skill",
        origin: "agent",
        homeAgent: "claude-code",
        apps: { "claude-code": true },
      }),
    ];

    renderInstalledSkills();

    expect(screen.getByText("No installed skills match your filters.")).toBeInTheDocument();
    expect(
      screen.queryByText(/No skills match your visible coding agents/),
    ).not.toBeInTheDocument();
  });

  it("does not allow batch archiving external imports", async () => {
    const user = userEvent.setup();
    mocks.visibleAgentOrder = ["claude-code"];
    mocks.skills = [
      skill({
        id: "external-skill",
        name: "External Skill",
        origin: "external",
        apps: { "claude-code": true },
      }),
    ];
    const view = renderInstalledSkills();

    const toggleViewButton = view.container.querySelector(
      "button.inline-flex.items-center.bg-muted",
    ) as HTMLButtonElement;
    await user.click(toggleViewButton);
    await user.click(screen.getAllByRole("checkbox")[1]);

    expect(screen.getByRole("button", { name: /Archive selected/ })).toBeDisabled();
  });

  it("batch unlinks selected skills from the active agent without removing external imports", async () => {
    const user = userEvent.setup();
    mocks.skills = [
      skill({ id: "ssot-skill", name: "SSOT Skill", apps: { codex: true } }),
      skill({
        id: "external-skill",
        name: "External Skill",
        origin: "external",
        apps: { codex: true },
      }),
    ];
    const view = renderInstalledSkills();

    await user.click(screen.getByRole("button", { name: "Codex" }));
    await user.click(
      view.container.querySelector("button.inline-flex.items-center.bg-muted") as HTMLButtonElement,
    );
    await user.click(screen.getAllByRole("checkbox")[0]);
    await user.click(screen.getByRole("button", { name: "Remove link" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Remove link" }),
    );

    expect(mocks.batchUnlinkSkills).toHaveBeenCalledWith(
      { skillIds: ["ssot-skill", "external-skill"], agent: "codex" },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it("does not offer unlinking when the selection only contains an agent's native skills", async () => {
    const user = userEvent.setup();
    mocks.skills = [
      skill({
        id: "codex-skill",
        name: "Codex Skill",
        origin: "agent",
        homeAgent: "codex",
        apps: { codex: true },
      }),
    ];
    const view = renderInstalledSkills();

    await user.click(screen.getByRole("button", { name: "Codex" }));
    await user.click(
      view.container.querySelector("button.inline-flex.items-center.bg-muted") as HTMLButtonElement,
    );
    await user.click(screen.getAllByRole("checkbox")[0]);

    expect(screen.getByRole("button", { name: "Remove link" })).toBeDisabled();
  });
});

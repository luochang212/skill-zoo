import "@/i18n";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InstalledSkills } from "./InstalledSkills";
import type { InstalledSkill } from "@/types/skills";

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
  useRemoveSkills: () => ({ mutate: vi.fn(), isPending: false }),
  useRestoreArchivedSkills: () => ({ mutate: vi.fn(), isPending: false }),
  useStarSkill: () => ({ mutate: vi.fn() }),
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
  });

  it("shows only skills linked to currently visible coding agents", () => {
    mocks.visibleAgentOrder = ["claude-code"];
    mocks.skills = [
      skill({ id: "claude-skill", name: "Claude Skill", apps: { "claude-code": true } }),
      skill({ id: "codex-skill", name: "Codex Skill", apps: { codex: true } }),
      skill({
        id: "shared-skill",
        name: "Shared Skill",
        apps: { "claude-code": true, codex: true },
      }),
    ];

    renderInstalledSkills();

    expect(screen.getByRole("button", { name: "Claude Skill" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Shared Skill" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Codex Skill" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All2" })).toBeInTheDocument();
  });

  it("still applies the hide non-SSOT setting after visible-agent filtering", () => {
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
        apps: { "claude-code": true },
      }),
    ];

    renderInstalledSkills();

    expect(screen.getByRole("button", { name: "SSOT Skill" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Agent Skill" })).not.toBeInTheDocument();
  });

  it("resets a hidden agent toolbar filter back to all", async () => {
    const user = userEvent.setup();
    mocks.visibleAgentOrder = ["claude-code", "codex"];
    mocks.skills = [
      skill({ id: "claude-skill", name: "Claude Skill", apps: { "claude-code": true } }),
      skill({ id: "codex-skill", name: "Codex Skill", apps: { codex: true } }),
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

  it("filters archived skill cards by visible coding agents", () => {
    mocks.visibleAgentOrder = ["claude-code"];
    mocks.archivedSkills = [
      skill({ id: "archived-claude", name: "Archived Claude", apps: { "claude-code": true } }),
      skill({ id: "archived-codex", name: "Archived Codex", apps: { codex: true } }),
    ];

    renderArchivedSkills();

    expect(screen.getByRole("button", { name: "Archived Claude" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archived Codex" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive1" })).toBeInTheDocument();
  });

  it("counts only visible archived skills in the sidebar", () => {
    mocks.visibleAgentOrder = ["claude-code"];
    mocks.archivedSkills = [
      skill({ id: "archived-claude", name: "Archived Claude", apps: { "claude-code": true } }),
      skill({ id: "archived-codex", name: "Archived Codex", apps: { codex: true } }),
    ];

    renderInstalledSkills();

    expect(screen.getByRole("button", { name: "Archive1" })).toBeInTheDocument();
  });

  it("does not surface consistency issues for skills hidden by agent visibility", () => {
    mocks.visibleAgentOrder = ["claude-code"];
    mocks.skills = [
      skill({
        id: "hidden-mismatch",
        name: "Hidden Mismatch",
        yamlName: "Display Name",
        apps: { codex: true },
      }),
    ];

    renderInstalledSkills();

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
});

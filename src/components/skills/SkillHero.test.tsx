import "@/i18n";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SkillHero } from "./SkillHero";
import type { InstalledSkill } from "@/types/skills";

vi.mock("@/lib/agents", () => ({
  useAgentConfigs: () => ({
    data: [
      { id: "claude-code", label: "Claude Code", skillsSubdir: "skills" },
      { id: "codex", label: "Codex", skillsSubdir: "skills" },
    ],
  }),
  getAgentColor: () => ({
    bg: "bg-muted",
    text: "text-foreground",
    darkBg: "dark:bg-muted",
    darkText: "dark:text-foreground",
  }),
  getAgentLabel: (agent: string) => (agent === "claude-code" ? "Claude Code" : "Codex"),
}));

vi.mock("@/hooks/useSettings", () => ({
  useVisibleAgentOrder: () => ["claude-code"],
}));

function skill(overrides: Partial<InstalledSkill>): InstalledSkill {
  return {
    id: "shared-skill",
    name: "Shared Skill",
    directory: "shared-skill",
    apps: { "claude-code": true, codex: true },
    origin: "ssot",
    installedAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("SkillHero", () => {
  it("shows only visible linked agents in the local detail header", () => {
    render(<SkillHero skill={skill({})} onConfigure={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Claude Code" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Codex" })).not.toBeInTheDocument();
  });
});

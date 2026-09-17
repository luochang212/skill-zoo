import "@/i18n";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SkillSidebar } from "./SkillSidebar";
import type { InstalledSkill } from "@/types/skills";

function makeSkill(id: string, repoOwner: string, repoName: string): InstalledSkill {
  return {
    id,
    name: id,
    directory: id,
    repoOwner,
    repoName,
    apps: {},
    origin: "ssot",
    installedAt: 1,
    updatedAt: 1,
  };
}

describe("SkillSidebar", () => {
  it("groups GitHub repository identities without case sensitivity", () => {
    render(
      <SkillSidebar
        skills={[makeSkill("one", "Owner", "Repo"), makeSkill("two", "owner", "repo")]}
        category={{ type: "all" }}
        onSelectCategory={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("button", { name: "Owner/Repo" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "owner/repo" })).not.toBeInTheDocument();
  });

  it("exposes the repo group's expanded state", () => {
    render(
      <SkillSidebar
        skills={[makeSkill("one", "Owner", "Repo")]}
        category={{ type: "all" }}
        onSelectCategory={vi.fn()}
      />,
    );

    const toggle = screen.getByRole("button", { name: /Repos/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("removes collapsed repo entries from the document entirely", () => {
    render(
      <SkillSidebar
        skills={[makeSkill("one", "Owner", "Repo")]}
        category={{ type: "all" }}
        onSelectCategory={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Owner/Repo" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Repos/ }));

    // Not merely invisible: must leave the DOM so it also leaves the tab order
    // and the accessibility tree. max-h-0/opacity-0 kept it focusable in Chrome.
    expect(screen.queryByRole("button", { name: "Owner/Repo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unassigned" })).not.toBeInTheDocument();
  });

  it("does not cap the list height, so no entry is silently clipped", () => {
    const skills = Array.from({ length: 40 }, (_, i) =>
      makeSkill(`skill-${i}`, `owner-${i}`, `repo-${i}`),
    );

    const { container } = render(
      <SkillSidebar skills={skills} category={{ type: "all" }} onSelectCategory={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: "owner-39/repo-39" })).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("max-h-[1000px]");
  });
});

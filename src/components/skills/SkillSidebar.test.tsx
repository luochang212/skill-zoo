import "@/i18n";
import { render, screen } from "@testing-library/react";
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
        skillDragSupported={false}
      />,
    );

    expect(screen.getAllByRole("button", { name: "Owner/Repo" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "owner/repo" })).not.toBeInTheDocument();
  });
});

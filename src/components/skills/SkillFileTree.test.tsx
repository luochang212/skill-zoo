import "@/i18n";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SkillFileTree } from "./SkillFileTree";
import type { SkillFileNode } from "@/types/skills";

const nodes: SkillFileNode[] = [
  { name: "scripts", path: "scripts", isDir: true, isSkillMd: false },
  { name: "SKILL.md", path: "SKILL.md", isDir: false, isSkillMd: true },
];

describe("SkillFileTree disclosure state", () => {
  it("reports expanded state for directories only", () => {
    render(<SkillFileTree skillId="demo" nodes={nodes} onLoadChildren={vi.fn()} />);

    const dir = screen.getByRole("button", { name: "scripts" });
    const file = screen.getByRole("button", { name: "SKILL.md" });

    expect(dir).toHaveAttribute("aria-expanded", "false");
    expect(file).not.toHaveAttribute("aria-expanded");

    fireEvent.click(dir);
    expect(dir).toHaveAttribute("aria-expanded", "true");
  });
});

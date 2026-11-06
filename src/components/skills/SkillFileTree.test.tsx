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
  it("reveals selected descendants but still allows manually collapsing their folder", () => {
    const nested: SkillFileNode[] = [
      {
        name: "references",
        path: "references",
        isDir: true,
        isSkillMd: false,
        children: [
          { name: "guide.md", path: "references/guide.md", isDir: false, isSkillMd: false },
          { name: "next.md", path: "references/next.md", isDir: false, isSkillMd: false },
        ],
      },
    ];
    const { rerender } = render(
      <SkillFileTree nodes={nested} selectedPath="references/guide.md" />,
    );
    const folder = screen.getByRole("button", { name: "references" });
    expect(folder).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "guide.md" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    fireEvent.click(folder);
    expect(folder).toHaveAttribute("aria-expanded", "false");
    rerender(<SkillFileTree nodes={nested} selectedPath="references/guide.md" />);
    expect(folder).toHaveAttribute("aria-expanded", "false");
    rerender(<SkillFileTree nodes={nested} selectedPath="references/next.md" />);
    expect(folder).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "next.md" })).toHaveAttribute("aria-current", "true");
  });
});

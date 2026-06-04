import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SkillDetail } from "@/components/skills/SkillDetail";

describe("SkillDetail", () => {
  it("keeps back navigation available while content is loading", async () => {
    const onBack = vi.fn();

    render(
      <SkillDetail
        skill={null}
        skillName="Loading Skill"
        isLoading
        content=""
        onChange={() => {}}
        onBack={onBack}
      />,
    );

    expect(screen.getByRole("heading", { name: "Loading Skill" })).toBeInTheDocument();

    await userEvent.click(screen.getByTitle("Back"));

    expect(onBack).toHaveBeenCalledOnce();
  });
});

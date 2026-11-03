import "@/i18n";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { load as yamlLoad } from "js-yaml";
import { beforeEach, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { SkillCreateView } from "./SkillCreateView";

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("@/hooks/useSkills", () => ({
  useCreateSkill: () => ({ mutate, isPending: false }),
}));
beforeEach(async () => {
  mutate.mockReset();
  await i18n.changeLanguage("en");
});
it("preserves multiline descriptions and Markdown when creating from the document", async () => {
  render(<SkillCreateView onClose={vi.fn()} onCreated={vi.fn()} />);
  const description = 'Use when: writing docs\nKeep "quoted" text and # markers';
  const body = "# Instructions\n\nKeep this Markdown.\n";
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
    target: { value: "my-skill" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Description" }), {
    target: { value: description },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Skill content" }), {
    target: { value: body },
  });
  expect(mutate).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Create" }));
  const saved = mutate.mock.calls[0]?.[0] as { name: string; content: string };
  const end = saved.content.indexOf("\n---\n", 4);
  expect(saved.name).toBe("my-skill");
  expect(yamlLoad(saved.content.slice(4, end))).toEqual({ name: "my-skill", description });
  expect(saved.content.slice(end + 6)).toBe(body);
});
it("keeps invalid skill names from being submitted", () => {
  render(<SkillCreateView onClose={vi.fn()} onCreated={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
    target: { value: "invalid/name" },
  });
  expect(screen.getByRole("textbox", { name: "Name" })).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  expect(mutate).not.toHaveBeenCalled();
});

import "@/i18n";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SkillPreviewPanel } from "./SkillPreviewPanel";

const base = {
  open: true,
  loading: false,
  content: "# hello",
  skillName: "test-skill",
  onClose: vi.fn(),
};

describe("skill preview panel install", () => {
  it("hides the footer without install status and offers install when available", () => {
    const { rerender } = render(<SkillPreviewPanel {...base} />);
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
    rerender(<SkillPreviewPanel {...base} installStatus="available" onInstall={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Install" })).toBeEnabled();
  });
  it("shows named indeterminate progress while reading, completes on success and removes it on failure", () => {
    const { container, rerender } = render(<SkillPreviewPanel {...base} loading />);
    expect(screen.getByRole("progressbar", { name: "Loading..." })).not.toHaveAttribute("value");
    rerender(<SkillPreviewPanel {...base} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(container.querySelector('[data-state="completed"]')).toBeInTheDocument();
    rerender(<SkillPreviewPanel {...base} loading />);
    rerender(<SkillPreviewPanel {...base} error={null} />);
    expect(container.querySelector(".translation-intent-progress")).toBeNull();
  });
  it("does not play completion progress for immediately available content", () => {
    const { container } = render(<SkillPreviewPanel {...base} />);
    expect(container.querySelector(".translation-intent-progress")).toBeNull();
  });
  it("labels the compact install action with the skill name and keeps its click behavior", () => {
    const onInstall = vi.fn();
    render(<SkillPreviewPanel {...base} installStatus="available" onInstall={onInstall} />);
    expect(screen.getByText("test-skill")).toHaveAttribute("title", "test-skill");
    const button = screen.getByRole("button", { name: "Install" });
    expect(button).not.toHaveClass("w-full");
    button.click();
    expect(onInstall).toHaveBeenCalledOnce();
  });
  it("keeps a gray install footer while the status is still loading", () => {
    const { rerender } = render(<SkillPreviewPanel {...base} loading installLoading />);
    const install = screen.getByRole("button", { name: "Install" });
    expect(install).toBeDisabled();
    rerender(<SkillPreviewPanel {...base} installStatus="available" onInstall={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Install" })).toBeEnabled();
  });
  it("disables with a short label when installed or conflicting", () => {
    const { rerender } = render(<SkillPreviewPanel {...base} installStatus="installed" />);
    expect(screen.getByRole("button", { name: "Installed" })).toBeDisabled();
    rerender(<SkillPreviewPanel {...base} installStatus="conflict" />);
    expect(screen.getByRole("button", { name: "Name conflict" })).toBeDisabled();
  });
});

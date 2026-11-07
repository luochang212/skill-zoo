import "@/i18n";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SkillPreviewPanel } from "./SkillPreviewPanel";

const base = {
  open: true,
  loading: false,
  content: "# hello",
  onClose: vi.fn(),
};

describe("skill preview panel install", () => {
  it("hides the footer without install status and offers install when available", () => {
    const { rerender } = render(<SkillPreviewPanel {...base} />);
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
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

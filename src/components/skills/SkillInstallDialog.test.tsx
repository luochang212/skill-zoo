import "@/i18n";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SkillInstallDialog } from "./SkillInstallDialog";

vi.mock("@/hooks/useSettings", () => ({
  useVisibleAgentOrder: () => ["codex", "claude-code"],
}));

vi.mock("@/lib/agents", () => ({
  useAgentConfigs: () => ({
    data: [
      { id: "codex", label: "Codex" },
      { id: "claude-code", label: "Claude Code" },
    ],
  }),
  getAgentLabel: (agent: string) => (agent === "codex" ? "Codex" : "Claude Code"),
}));

function renderDialog(isPending: boolean) {
  const onOpenChange = vi.fn();
  const onInstall = vi.fn();
  render(
    <SkillInstallDialog
      open
      onOpenChange={onOpenChange}
      skills={[
        {
          key: "demo",
          name: "Demo",
          directory: "demo",
          repoOwner: "owner",
          repoName: "repo",
          installStatus: "available",
        },
      ]}
      repoOwner="owner"
      repoName="repo"
      onInstall={onInstall}
      isPending={isPending}
    />,
  );
  return { onOpenChange, onInstall };
}

describe("SkillInstallDialog", () => {
  it("locks install options and closing controls while installation is pending", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog(true);

    const codexCheckbox = screen.getByRole("checkbox", { name: "Toggle Codex" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const install = screen.getByRole("button", { name: "Installing..." });

    expect(codexCheckbox).toBeDisabled();
    expect(cancel).toBeDisabled();
    expect(install).toBeDisabled();

    await user.click(cancel);

    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("selects all agents via the select-all checkbox and installs with a plain label", async () => {
    const user = userEvent.setup();
    const { onInstall } = renderDialog(false);

    const selectAll = screen.getByRole("checkbox", { name: "Select all" });
    expect(selectAll).not.toBeChecked();

    await user.click(selectAll);
    expect(selectAll).toHaveAttribute("data-state", "checked");
    expect(screen.getByRole("checkbox", { name: "Toggle Codex" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Toggle Claude Code" })).toBeChecked();

    const install = screen.getByRole("button", { name: "Install" });
    await user.click(install);
    expect(onInstall).toHaveBeenCalledWith(["demo"], ["codex", "claude-code"]);
  });

  it("disables install when deselecting the last selected agent", async () => {
    const user = userEvent.setup();
    const { onInstall } = renderDialog(false);

    const codex = screen.getByRole("checkbox", { name: "Toggle Codex" });
    await user.click(codex);

    const install = screen.getByRole("button", { name: "Install" });
    expect(install).toBeDisabled();
    expect(onInstall).not.toHaveBeenCalled();
  });
});

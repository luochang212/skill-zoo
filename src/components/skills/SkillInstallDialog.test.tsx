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

    const codexSwitch = screen.getByRole("switch", { name: "Toggle Codex" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const install = screen.getByRole("button", { name: "Installing..." });

    expect(codexSwitch).toBeDisabled();
    expect(cancel).toBeDisabled();
    expect(install).toBeDisabled();

    await user.click(cancel);

    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

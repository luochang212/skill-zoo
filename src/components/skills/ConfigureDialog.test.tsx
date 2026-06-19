import "@/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { ConfigureDialog } from "./ConfigureDialog";

function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("ConfigureDialog", () => {
  beforeEach(async () => {
    vi.mocked(invoke).mockReset();
    await i18n.changeLanguage("en");
  });

  it("shows the home agent as enabled and invalid links as disabled", async () => {
    vi.mocked(invoke).mockImplementation((command) => {
      switch (command) {
        case "get_agent_configs":
          return Promise.resolve([
            { id: "codex", label: "Codex", skillsSubdir: ".codex" },
            { id: "opencode", label: "OpenCode", skillsSubdir: ".opencode" },
          ]);
        case "get_visible_agents":
          return Promise.resolve({ codex: true, opencode: true });
        case "get_settings":
          return Promise.resolve({ agent_order: JSON.stringify(["codex", "opencode"]) });
        case "get_symlink_status":
          return Promise.resolve([
            {
              skillId: "agent:codex:imagegen",
              skillName: "imagegen",
              agent: "codex",
              symlinkPath: "C:/Users/test/.codex/skills/imagegen",
              targetPath: "C:/Users/test/.codex/skills/imagegen",
              exists: false,
              isValid: false,
            },
            {
              skillId: "agent:codex:imagegen",
              skillName: "imagegen",
              agent: "opencode",
              symlinkPath: "C:/Users/test/.opencode/skills/imagegen",
              targetPath: "C:/Users/test/.codex/skills/imagegen",
              exists: true,
              isValid: false,
            },
          ]);
        default:
          return Promise.reject(new Error(`Unexpected command: ${command}`));
      }
    });

    renderWithQueryClient(
      <ConfigureDialog
        open
        onOpenChange={() => {}}
        skillId="agent:codex:imagegen"
        skillName="imagegen"
        homeAgent="codex"
      />,
    );

    const codexSwitch = await screen.findByRole("switch", { name: "Toggle Codex" });
    const opencodeSwitch = await screen.findByRole("switch", { name: "Toggle OpenCode" });

    expect(codexSwitch).toBeChecked();
    expect(codexSwitch).toBeDisabled();
    expect(opencodeSwitch).not.toBeChecked();
    expect(opencodeSwitch).toBeEnabled();
  });
});

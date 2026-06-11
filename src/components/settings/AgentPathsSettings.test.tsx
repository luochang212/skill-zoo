import "@/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { AgentPathsSettings } from "./AgentPathsSettings";

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function renderSettings() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AgentPathsSettings />
    </QueryClientProvider>,
  );
}

describe("AgentPathsSettings", () => {
  beforeEach(async () => {
    vi.mocked(invoke).mockReset();
    await i18n.changeLanguage("en");
  });

  it("disables all visibility switches while a visibility update is pending", async () => {
    const user = userEvent.setup();
    const update = createDeferred();
    vi.mocked(invoke).mockImplementation((command) => {
      switch (command) {
        case "get_agent_paths":
          return Promise.resolve([
            { agent: "claude-code", label: "Claude Code", path: "/claude", exists: true },
            { agent: "codex", label: "Codex", path: "/codex", exists: true },
          ]);
        case "get_visible_agents":
          return Promise.resolve({ "claude-code": true, codex: true });
        case "get_settings":
          return Promise.resolve({});
        case "update_visible_agents":
          return update.promise;
        default:
          return Promise.reject(new Error(`Unexpected command: ${command}`));
      }
    });
    renderSettings();

    const claudeSwitch = await screen.findByRole("switch", {
      name: "Toggle visibility for Claude Code",
    });
    const codexSwitch = screen.getByRole("switch", { name: "Toggle visibility for Codex" });

    await user.click(claudeSwitch);

    await waitFor(() => {
      expect(claudeSwitch).toBeDisabled();
      expect(codexSwitch).toBeDisabled();
    });

    update.resolve();
    await waitFor(() => expect(codexSwitch).toBeEnabled());
  });
});

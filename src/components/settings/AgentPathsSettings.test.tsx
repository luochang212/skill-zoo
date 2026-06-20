import "@/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import type { AgentPreferences, AgentPathInfo, VisibleAgents } from "@/types/skills";
import { AgentPathsSettings } from "./AgentPathsSettings";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
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

function mockAgentSettings(paths: AgentPathInfo[], visibleAgents: VisibleAgents, order: string[]) {
  vi.mocked(invoke).mockImplementation((command, args) => {
    switch (command) {
      case "get_agent_paths":
        return Promise.resolve(paths);
      case "get_visible_agents":
        return Promise.resolve(visibleAgents);
      case "get_settings":
        return Promise.resolve({ agent_order: JSON.stringify(order) });
      case "update_agent_preferences": {
        const preferences = args as Record<string, unknown>;
        return Promise.resolve({
          visibleAgents: preferences.visibleAgents,
          agentOrder: preferences.agentOrder,
        });
      }
      default:
        return Promise.reject(new Error(`Unexpected command: ${command}`));
    }
  });
}

describe("AgentPathsSettings", () => {
  beforeEach(async () => {
    vi.mocked(invoke).mockReset();
    await i18n.changeLanguage("en");
  });

  it("shows only the first five visible agents in the settings summary", async () => {
    const paths = Array.from({ length: 7 }, (_, index) => ({
      agent: `agent-${index + 1}`,
      label: `Agent ${index + 1}`,
      path: `/agent-${index + 1}`,
      exists: true,
    }));
    const visible = Object.fromEntries(paths.map((path) => [path.agent, true]));
    mockAgentSettings(
      paths,
      visible,
      paths.map((path) => path.agent),
    );

    renderSettings();

    expect(await screen.findByText("Agent 1")).toBeInTheDocument();
    expect(screen.getByText("Agent 5")).toBeInTheDocument();
    expect(screen.queryByText("Agent 6")).not.toBeInTheDocument();
    expect(screen.getByText("2 more visible agents")).toBeInTheDocument();
  });

  it("appends a newly visible agent and disables controls while saving", async () => {
    const user = userEvent.setup();
    const update = createDeferred<AgentPreferences>();
    const paths = [
      { agent: "claude-code", label: "Claude Code", path: "/claude", exists: true },
      { agent: "codex", label: "Codex", path: "/codex", exists: true },
    ];
    vi.mocked(invoke).mockImplementation((command) => {
      switch (command) {
        case "get_agent_paths":
          return Promise.resolve(paths);
        case "get_visible_agents":
          return Promise.resolve({ "claude-code": true, codex: false });
        case "get_settings":
          return Promise.resolve({ agent_order: JSON.stringify(["claude-code", "codex"]) });
        case "update_agent_preferences":
          return update.promise;
        default:
          return Promise.reject(new Error(`Unexpected command: ${command}`));
      }
    });
    renderSettings();

    await user.click(await screen.findByRole("button", { name: "Manage Agents" }));
    await user.click(screen.getByRole("button", { name: "Hidden (1)" }));
    await user.click(screen.getByRole("switch", { name: "Toggle visibility for Codex" }));

    await waitFor(() => {
      expect(
        screen.getByRole("switch", { name: "Toggle visibility for Claude Code" }),
      ).toBeDisabled();
      expect(screen.getByRole("switch", { name: "Toggle visibility for Codex" })).toBeDisabled();
    });
    expect(invoke).toHaveBeenCalledWith("update_agent_preferences", {
      visibleAgents: { "claude-code": true, codex: true },
      agentOrder: ["claude-code", "codex"],
    });

    update.resolve({
      visibleAgents: { "claude-code": true, codex: true },
      agentOrder: ["claude-code", "codex"],
    });
  });

  it("supports explicit long-distance moves in sorting mode", async () => {
    const user = userEvent.setup();
    const paths = [
      { agent: "claude-code", label: "Claude Code", path: "/claude", exists: true },
      { agent: "codex", label: "Codex", path: "/codex", exists: true },
      { agent: "cursor", label: "Cursor", path: "/cursor", exists: true },
    ];
    mockAgentSettings(paths, { "claude-code": true, codex: true, cursor: true }, [
      "claude-code",
      "codex",
      "cursor",
    ]);
    renderSettings();

    await user.click(await screen.findByRole("button", { name: "Manage Agents" }));
    await user.click(screen.getByRole("button", { name: "Adjust order" }));
    await user.click(screen.getByRole("button", { name: "Move Claude Code to last" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("update_agent_preferences", {
        visibleAgents: { "claude-code": true, codex: true, cursor: true },
        agentOrder: ["codex", "cursor", "claude-code"],
      });
    });
  });

  it("keeps the final visible agent enabled", async () => {
    const user = userEvent.setup();
    const paths = [
      { agent: "claude-code", label: "Claude Code", path: "/claude", exists: true },
      { agent: "codex", label: "Codex", path: "/codex", exists: true },
    ];
    mockAgentSettings(paths, { "claude-code": true, codex: false }, ["claude-code", "codex"]);
    renderSettings();

    await user.click(await screen.findByRole("button", { name: "Manage Agents" }));

    expect(
      screen.getByRole("switch", { name: "Toggle visibility for Claude Code" }),
    ).toBeDisabled();
  });

  it("closes the manager when the overlay is clicked", async () => {
    const user = userEvent.setup();
    const paths = [{ agent: "claude-code", label: "Claude Code", path: "/claude", exists: true }];
    mockAgentSettings(paths, { "claude-code": true }, ["claude-code"]);
    renderSettings();

    const trigger = await screen.findByRole("button", { name: "Manage Agents" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog");
    const overlay = dialog.previousElementSibling;
    expect(overlay).not.toBeNull();
    await user.click(overlay as Element);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});

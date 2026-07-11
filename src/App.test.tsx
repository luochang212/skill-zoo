import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import type { InstalledSkill } from "@/types/skills";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock("@tauri-apps/api/core");
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    startDragging: vi.fn(),
    toggleMaximize: vi.fn(),
  }),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

function skill(index: number): InstalledSkill {
  return {
    id: `skill-${index}`,
    name: `Skill ${index}`,
    description: `Description ${index}`,
    directory: `skill-${index}`,
    apps: { codex: true },
    origin: "ssot",
    repoOwner: "owner",
    repoName: "repo",
    starred: false,
    installedAt: index,
    updatedAt: index,
  };
}

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

describe("App local skill detail navigation", () => {
  beforeEach(() => {
    globalThis.ResizeObserver = ResizeObserverMock;
    vi.mocked(listen).mockClear();
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation((command) => {
      switch (command) {
        case "get_installed_skills":
          return Promise.resolve([skill(0), skill(1)]);
        case "get_archived_skills":
          return Promise.resolve([]);
        case "get_agent_configs":
          return Promise.resolve([{ id: "codex", label: "Codex", skillsSubdir: "skills" }]);
        case "get_settings":
          return Promise.resolve({});
        case "get_visible_agents":
          return Promise.resolve({});
        case "read_skill_text":
          return Promise.resolve("# Skill content");
        case "list_skill_files":
          return Promise.resolve([
            {
              name: "SKILL.md",
              path: "SKILL.md",
              isDir: false,
              isSkillMd: true,
            },
          ]);
        case "update_skill":
          return new Promise(() => {});
        default:
          return Promise.resolve(undefined);
      }
    });
  });

  it("keeps the local skill list mounted behind the detail overlay", async () => {
    renderApp();

    const user = userEvent.setup();
    const firstSkillButton = await screen.findByRole("button", { name: "Skill 0" });

    await user.click(firstSkillButton);

    await screen.findByText("Skill content");
    const hiddenList = firstSkillButton.closest('[aria-hidden="true"]') as HTMLElement | null;
    expect(hiddenList).toBeInTheDocument();
    expect(hiddenList).toHaveAttribute("inert");
    expect(hiddenList?.contains(document.activeElement)).toBe(false);

    await user.tab();
    expect(hiddenList?.contains(document.activeElement)).toBe(false);

    await user.click(screen.getByTitle("Back"));

    await waitFor(() => expect(hiddenList).not.toHaveAttribute("aria-hidden"));
    expect(hiddenList).not.toHaveAttribute("inert");
    expect(firstSkillButton).toBeInTheDocument();
  });

  it("does not show a different skill as updating while an earlier update is pending", async () => {
    renderApp();

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Skill 0" }));
    await screen.findByText("Skill content");

    await user.click(screen.getByTitle("Update from Git"));
    expect(screen.getByTitle("Updating...")).toBeInTheDocument();

    await user.click(screen.getByTitle("Back"));
    await user.click(await screen.findByRole("button", { name: "Skill 1" }));

    expect(await screen.findByRole("heading", { name: "Skill 1" })).toBeInTheDocument();
    expect(screen.queryByTitle("Updating...")).not.toBeInTheDocument();
    expect(screen.getByTitle("Update from Git")).toBeInTheDocument();
  });
});

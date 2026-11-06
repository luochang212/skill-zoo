import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { AppUpdaterProvider } from "@/hooks/useAppUpdater";
import type { InstalledSkill, RepoSkillsResult } from "@/types/skills";

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
      <AppUpdaterProvider>
        <App />
      </AppUpdaterProvider>
    </QueryClientProvider>,
  );
}

async function startRepositoryLoad() {
  const original = vi.mocked(invoke).getMockImplementation()!;
  let finish!: (result: RepoSkillsResult) => void;
  const loading = new Promise<RepoSkillsResult>((resolve) => {
    finish = resolve;
  });
  vi.mocked(invoke).mockImplementation((command, ...args) => {
    switch (command) {
      case "get_recommended_repos":
        return Promise.resolve([{ owner: "owner", name: "repo", branch: "dev" }]);
      case "get_banners":
        return Promise.resolve([]);
      case "get_skill_audit":
      case "list_llm_providers":
      case "get_symlink_status":
        return Promise.resolve([]);
      case "get_translation_preferences":
        return Promise.resolve({});
      case "get_repo_metadata":
        return Promise.resolve({ owner: "owner", name: "repo", defaultBranch: "main" });
      case "get_repo_skills":
        return loading;
      case "get_repo_readme":
        return Promise.resolve("# Read while loading");
      default:
        return original(command, ...args);
    }
  });
  renderApp();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Discover" }));
  await user.click(await screen.findByRole("button", { name: "owner/repo" }));
  await screen.findByRole("heading", { name: "owner/repo" });
  await waitFor(() =>
    expect(
      vi.mocked(invoke).mock.calls.filter(([command]) => command === "get_repo_skills"),
    ).toHaveLength(1),
  );
  return {
    user,
    async complete() {
      await act(async () =>
        finish({
          total: 1,
          skills: [
            {
              key: "skills/example",
              name: "Example",
              directory: "example",
              repoOwner: "owner",
              repoName: "repo",
              installStatus: "available",
            },
          ],
        }),
      );
    },
  };
}

describe("App local skill detail navigation", () => {
  beforeEach(() => {
    globalThis.ResizeObserver = ResizeObserverMock;
    vi.mocked(listen)
      .mockReset()
      .mockResolvedValue(() => {});
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

  it("continues a background repository without a README request and retains selection on return", async () => {
    const { user, complete } = await startRepositoryLoad();
    expect(screen.queryByText("README")).not.toBeInTheDocument();
    expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "get_repo_readme")).toBe(
      false,
    );
    await user.click(screen.getByRole("button", { name: "Local" }));
    await complete();
    await user.click(screen.getByRole("button", { name: /Download tasks:/ }));
    await user.click(await screen.findByRole("menuitem", { name: /^owner\/repo/ }));
    expect(await screen.findByRole("checkbox", { name: "Select Example" })).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Select Example" }));
    await user.click(screen.getByRole("button", { name: "Local" }));
    await user.click(screen.getByRole("button", { name: "Discover" }));
    expect(await screen.findByRole("checkbox", { name: "Select Example" })).toBeChecked();
    expect(
      vi.mocked(invoke).mock.calls.filter(([command]) => command === "get_repo_skills"),
    ).toHaveLength(1);
    expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "install_skills")).toBe(
      false,
    );
  });

  it("protects unsaved editor drafts when continuing a prepared repository", async () => {
    const { user, complete } = await startRepositoryLoad();
    await user.click(screen.getByRole("button", { name: "Local" }));
    await user.click(await screen.findByRole("button", { name: "Skill 0" }));
    await user.click(await screen.findByText("Edit", { selector: "span" }));
    const editor = await screen.findByRole("textbox", { name: "Edit" });
    fireEvent.change(editor, { target: { value: "# Unsaved draft" } });
    await complete();
    await user.click(screen.getByRole("button", { name: /Download tasks:/ }));
    await user.click(await screen.findByRole("menuitem", { name: /^owner\/repo/ }));
    expect(await screen.findByRole("dialog", { name: "Unsaved Changes" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep Editing" }));
    expect(screen.getByRole("textbox", { name: "Edit" })).toHaveValue("# Unsaved draft");
    await user.click(screen.getByRole("button", { name: /Download tasks:/ }));
    await user.click(await screen.findByRole("menuitem", { name: /^owner\/repo/ }));
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(await screen.findByRole("checkbox", { name: "Select Example" })).toBeInTheDocument();
  });

  it("keeps creation content when repository navigation is declined", async () => {
    const { user, complete } = await startRepositoryLoad();
    await user.click(screen.getByRole("button", { name: "Local" }));
    await user.click(await screen.findByRole("button", { name: /^Mine/ }));
    await user.click(await screen.findByRole("button", { name: /Create Skill/ }));
    const name = await screen.findByRole("textbox", { name: "Name" });
    await user.type(name, "unsaved-skill");
    await complete();
    await user.click(screen.getByRole("button", { name: /Download tasks:/ }));
    await user.click(await screen.findByRole("menuitem", { name: /^owner\/repo/ }));
    await user.click(await screen.findByRole("button", { name: "Keep Editing" }));
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("unsaved-skill");
  });

  it("unlistens navigation when registration resolves after unmount", async () => {
    let resolveNavigate!: (unlisten: () => void) => void;
    const unlisten = vi.fn();
    vi.mocked(listen).mockImplementation((eventName) => {
      if (eventName === "navigate") {
        return new Promise((resolve) => {
          resolveNavigate = resolve;
        });
      }
      return Promise.resolve(() => {});
    });

    const { unmount } = renderApp();
    unmount();
    await act(async () => {
      resolveNavigate(unlisten);
      await Promise.resolve();
    });

    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("opens usage habits from the tray, closing the skill detail first", async () => {
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Skill 0" }, { timeout: 5000 }));
    await screen.findByText("Skill content");
    const navigation = vi.mocked(listen).mock.calls.find(([event]) => event === "navigate")!;
    await act(async () => {
      const handler = navigation[1] as (event: { payload: string }) => void;
      handler({ payload: "settings:skill-usage" });
    });
    expect(await screen.findByRole("dialog", { name: "Usage Habits" })).toBeInTheDocument();
    expect(screen.queryByText("Skill content")).not.toBeInTheDocument();
  });

  it("keeps the local skill list mounted behind the detail overlay", async () => {
    renderApp();

    const user = userEvent.setup();
    // The first list render waits on a chain of queries; under load jsdom can
    // outlast findByRole's 1s default and strand the test on the skeletons.
    const firstSkillButton = await screen.findByRole(
      "button",
      { name: "Skill 0" },
      { timeout: 5000 },
    );

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
    await user.click(await screen.findByRole("button", { name: "Skill 0" }, { timeout: 5000 }));
    await screen.findByText("Skill content");

    await user.click(screen.getByTitle("Update from Git"));
    expect(screen.getByTitle("Updating...")).toBeInTheDocument();

    await user.click(screen.getByTitle("Back"));
    await user.click(await screen.findByRole("button", { name: "Skill 1" }, { timeout: 5000 }));

    expect(await screen.findByRole("heading", { name: "Skill 1" })).toBeInTheDocument();
    expect(screen.queryByTitle("Updating...")).not.toBeInTheDocument();
    expect(screen.getByTitle("Update from Git")).toBeInTheDocument();
  });
});

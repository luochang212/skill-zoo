import "@/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { SkillMaintenanceSettings } from "./SkillMaintenanceSettings";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

function renderSettings() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <SkillMaintenanceSettings />
    </QueryClientProvider>,
  );
}

describe("SkillMaintenanceSettings", () => {
  beforeEach(async () => {
    vi.mocked(invoke).mockReset();
    vi.mocked(toast.error).mockReset();
    vi.mocked(toast.warning).mockReset();
    await i18n.changeLanguage("en");
    vi.mocked(invoke).mockImplementation((command) => {
      switch (command) {
        case "get_installed_skills":
          return Promise.resolve([]);
        case "get_settings":
          return Promise.resolve({});
        case "get_cache_size":
          return Promise.resolve(1024);
        case "get_skill_update_history":
          return Promise.resolve([]);
        case "clear_download_cache":
          return Promise.reject(new Error("clear failed"));
        default:
          return Promise.reject(new Error(`Unexpected command: ${command}`));
      }
    });
  });

  it("recovers the clear-cache button after clearing fails", async () => {
    const user = userEvent.setup();
    renderSettings();

    const button = await screen.findByRole("button", { name: /clear cache/i });
    await user.click(button);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not clear download cache"));
    expect(button).toBeEnabled();
  });

  it("shows the concrete update failure reason", async () => {
    const user = userEvent.setup();
    vi.mocked(invoke).mockImplementation((command) => {
      switch (command) {
        case "get_installed_skills":
          return Promise.resolve([
            { id: "skill:agent-browser", directory: "agent-browser", origin: "ssot" },
          ]);
        case "get_settings":
          return Promise.resolve({});
        case "get_cache_size":
          return Promise.resolve(1024);
        case "get_skill_update_history":
          return Promise.resolve([]);
        case "check_skill_updates":
          return Promise.resolve({
            skills: [
              {
                skillName: "agent-browser",
                hasUpdate: true,
                currentSha: "old",
                latestSha: "new",
                repo: "vercel-labs/agent-browser",
              },
            ],
            totalRepos: 1,
            checkedRepos: 1,
            rateLimited: false,
          });
        case "update_all_skills":
          return Promise.resolve({
            skills: [],
            successCount: 0,
            failCount: 1,
            errors: ["agent-browser: Rate limited: vercel-labs/agent-browser"],
          });
        default:
          return Promise.reject(new Error(`Unexpected command: ${command}`));
      }
    });

    renderSettings();

    await user.click(await screen.findByRole("button", { name: /check updates/i }));
    await user.click(await screen.findByRole("button", { name: /update manager/i }));
    await user.click(await screen.findByRole("button", { name: /^update selected$/i }));

    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(
        "GitHub requests are temporarily rate limited. Please try again later.",
      ),
    );
  });

  it("describes update-all download failures as download failures", async () => {
    const user = userEvent.setup();
    vi.mocked(invoke).mockImplementation((command) => {
      switch (command) {
        case "get_installed_skills":
          return Promise.resolve([
            { id: "skill:agent-browser", directory: "agent-browser", origin: "ssot" },
          ]);
        case "get_settings":
          return Promise.resolve({});
        case "get_cache_size":
          return Promise.resolve(1024);
        case "get_skill_update_history":
          return Promise.resolve([]);
        case "check_skill_updates":
          return Promise.resolve({
            skills: [
              {
                skillName: "agent-browser",
                hasUpdate: true,
                currentSha: "old",
                latestSha: "new",
                repo: "vercel-labs/agent-browser",
              },
            ],
            totalRepos: 1,
            checkedRepos: 1,
            rateLimited: false,
          });
        case "update_all_skills":
          return Promise.resolve({
            skills: [],
            successCount: 0,
            failCount: 1,
            errors: ["agent-browser: Download temporarily unavailable: vercel-labs/agent-browser"],
          });
        default:
          return Promise.reject(new Error(`Unexpected command: ${command}`));
      }
    });

    renderSettings();

    await user.click(await screen.findByRole("button", { name: /check updates/i }));
    await user.click(await screen.findByRole("button", { name: /update manager/i }));
    await user.click(await screen.findByRole("button", { name: /^update selected$/i }));

    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(
        "GitHub could not download the update package for vercel-labs/agent-browser. Please try again later.",
      ),
    );
  });

  it("passes checked SSOT update candidates to update all", async () => {
    const user = userEvent.setup();
    vi.mocked(invoke).mockImplementation((command) => {
      switch (command) {
        case "get_installed_skills":
          return Promise.resolve([
            { id: "repo:owner/repo:ssot-skill", directory: "ssot-skill", origin: "ssot" },
            { id: "agent:codex:local-skill", directory: "local-skill", origin: "agent" },
          ]);
        case "get_settings":
          return Promise.resolve({});
        case "get_cache_size":
          return Promise.resolve(1024);
        case "get_skill_update_history":
          return Promise.resolve([]);
        case "check_skill_updates":
          return Promise.resolve({
            skills: [
              {
                skillName: "ssot-skill",
                hasUpdate: true,
                currentSha: "old-ssot",
                latestSha: "new-ssot",
                repo: "owner/repo",
              },
              {
                skillName: "local-skill",
                hasUpdate: true,
                currentSha: "old-local",
                latestSha: "new-local",
                repo: "owner/repo",
              },
            ],
            totalRepos: 1,
            checkedRepos: 1,
            rateLimited: false,
          });
        case "update_all_skills":
          return Promise.resolve({
            skills: [],
            successCount: 1,
            failCount: 0,
            errors: [],
          });
        default:
          return Promise.reject(new Error(`Unexpected command: ${command}`));
      }
    });

    renderSettings();

    await user.click(await screen.findByRole("button", { name: /check updates/i }));
    expect(screen.queryByRole("button", { name: /update all \(1\)/i })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /update manager \(1\)/i }));
    expect(screen.queryByRole("button", { name: /^update all$/i })).not.toBeInTheDocument();
    const updateButton = await screen.findByRole("button", { name: /^update selected$/i });
    await user.click(updateButton);

    expect(invoke).toHaveBeenCalledWith("update_all_skills", {
      checkedUpdates: [
        {
          skillName: "ssot-skill",
          currentSha: "old-ssot",
          latestSha: "new-ssot",
        },
      ],
    });
  });

  it("manages update history from the update manager dialog", async () => {
    const user = userEvent.setup();
    vi.mocked(invoke).mockImplementation((command, args) => {
      switch (command) {
        case "get_installed_skills":
          return Promise.resolve([]);
        case "get_settings":
          return Promise.resolve({});
        case "get_cache_size":
          return Promise.resolve(1024);
        case "get_skill_update_history":
          return Promise.resolve([
            {
              id: "history-1",
              startedAt: "2026-01-01T00:00:00Z",
              finishedAt: "2026-01-01T00:01:00Z",
              mode: "selected",
              requestedSkills: ["demo"],
              updatedSkills: ["demo"],
              failedSkills: [],
              errors: [],
              status: "success",
            },
          ]);
        case "delete_skill_update_history_record":
          expect(args).toEqual({ id: "history-1" });
          return Promise.resolve();
        case "clear_skill_update_history":
          return Promise.resolve();
        default:
          return Promise.reject(new Error(`Unexpected command: ${command}`));
      }
    });

    renderSettings();

    await user.click(await screen.findByRole("button", { name: /update manager/i }));
    await user.click(await screen.findByRole("button", { name: /history/i }));
    await screen.findByText("1 updated, 0 failed");

    await user.click(await screen.findByRole("button", { name: /delete history record/i }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("delete_skill_update_history_record", {
        id: "history-1",
      }),
    );

    await user.click(await screen.findByRole("button", { name: /clear history/i }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("clear_skill_update_history"));
  });

  it("does not describe rate limiting as partial results when no repository was checked", async () => {
    const user = userEvent.setup();
    vi.mocked(invoke).mockImplementation((command) => {
      switch (command) {
        case "get_installed_skills":
          return Promise.resolve([
            { id: "skill:agent-browser", directory: "agent-browser", origin: "ssot" },
          ]);
        case "get_settings":
          return Promise.resolve({});
        case "get_cache_size":
          return Promise.resolve(1024);
        case "get_skill_update_history":
          return Promise.resolve([]);
        case "check_skill_updates":
          return Promise.resolve({
            skills: [
              {
                skillName: "agent-browser",
                hasUpdate: false,
                currentSha: "old",
                latestSha: null,
                repo: "vercel-labs/agent-browser",
              },
            ],
            totalRepos: 1,
            checkedRepos: 0,
            rateLimited: true,
          });
        default:
          return Promise.reject(new Error(`Unexpected command: ${command}`));
      }
    });

    renderSettings();

    await user.click(await screen.findByRole("button", { name: /check updates/i }));

    await screen.findByText("Updates could not be checked because GitHub is rate limited.");
    expect(screen.queryByText(/Only some repositories were checked/i)).not.toBeInTheDocument();
    expect(toast.warning).not.toHaveBeenCalled();
  });
});

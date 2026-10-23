import "@/i18n";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { SkillMaintenanceSettings } from "./SkillMaintenanceSettings";
import { useBackgroundSkillUpdates } from "@/hooks/useBackgroundSkillUpdates";
import { GitHubTokenSettings } from "./GitHubTokenSettings";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

function BackgroundUpdates() {
  useBackgroundSkillUpdates();
  return null;
}

function renderSettings(withGitHubConnection = false) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  function Connected() {
    const [githubOpen, setGithubOpen] = useState(false);
    return (
      <>
        <SkillMaintenanceSettings onRequestGitHubTokenConfig={() => setGithubOpen(true)} />
        {withGitHubConnection && (
          <GitHubTokenSettings open={githubOpen} onOpenChange={setGithubOpen} />
        )}
      </>
    );
  }

  return render(
    <QueryClientProvider client={queryClient}>
      <BackgroundUpdates />
      <Connected />
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
        case "update_setting":
          return Promise.resolve(undefined);
        case "get_github_credential_status":
          return Promise.resolve({ hasToken: false, expiresAt: null });
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

  it("keeps an update running after close and refreshes history when reopened", async () => {
    const user = userEvent.setup();
    let finish!: (result: unknown) => void;
    let finished = false;
    vi.mocked(invoke).mockImplementation((command) => {
      switch (command) {
        case "get_installed_skills":
          return Promise.resolve([{ id: "skill:demo", directory: "demo", origin: "ssot" }]);
        case "get_settings":
          return Promise.resolve({});
        case "get_github_credential_status":
          return Promise.resolve({ hasToken: false, expiresAt: null });
        case "get_cache_size":
          return Promise.resolve(0);
        case "check_skill_updates":
          return Promise.resolve({
            skills: [
              {
                skillName: "demo",
                hasUpdate: true,
                currentSha: "old",
                latestSha: "new",
                repo: "owner/repo",
              },
            ],
            totalRepos: 1,
            checkedRepos: 1,
            rateLimited: false,
          });
        case "get_skill_update_history":
          return Promise.resolve(
            finished
              ? [
                  {
                    id: "done",
                    startedAt: "2026-01-01T00:00:00Z",
                    finishedAt: "2026-01-01T00:01:00Z",
                    mode: "selected",
                    requestedSkills: ["demo"],
                    updatedSkills: ["demo"],
                    failedSkills: [],
                    errors: [],
                    status: "success",
                  },
                ]
              : [],
          );
        case "update_all_skills":
          return new Promise((resolve) => {
            finish = resolve;
          });
        default:
          return Promise.reject(new Error(`Unexpected command: ${command}`));
      }
    });
    vi.mocked(toast.success).mockClear();
    renderSettings();
    await user.click(await screen.findByRole("button", { name: /check updates/i }));
    await user.click(await screen.findByRole("button", { name: /update manager/i }));
    await user.click(screen.getByRole("button", { name: /^update selected$/i }));
    await waitFor(() => expect(finish).toBeDefined());
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /update manager/i }));
    expect(screen.getByRole("button", { name: /^update selected$/i })).toBeDisabled();
    await user.keyboard("{Escape}");
    finished = true;
    act(() =>
      finish({ skills: [], successCount: 1, failCount: 0, errors: [], skippedDrifted: [] }),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledExactlyOnceWith("1 skill(s) updated successfully"),
    );
    await user.click(screen.getByRole("button", { name: /update manager/i }));
    await screen.findByText(/No checked updates are available/);
    await user.click(screen.getByRole("button", { name: /history/i }));
    await screen.findByText("1 updated, 0 failed");
  });

  it("takes rate-limited update items to the GitHub token input on dialog close", async () => {
    const user = userEvent.setup();
    vi.mocked(invoke).mockImplementation((command) => {
      switch (command) {
        case "get_installed_skills":
          return Promise.resolve([
            { id: "skill:limited", directory: "limited", origin: "ssot" },
            { id: "skill:missing", directory: "missing", origin: "ssot" },
          ]);
        case "get_settings":
          return Promise.resolve({});
        case "get_github_credential_status":
          return Promise.resolve({ hasToken: false, expiresAt: null });
        case "get_cache_size":
          return Promise.resolve(0);
        case "get_skill_update_history":
          return Promise.resolve([]);
        case "check_skill_updates":
          return Promise.resolve({
            skills: [
              {
                skillName: "limited",
                hasUpdate: false,
                repo: "owner/repo",
                checkErrorCode: "rateLimited",
                checkError: "Quota exhausted",
              },
              {
                skillName: "missing",
                hasUpdate: false,
                repo: "owner/other",
                checkErrorCode: "repoUnavailable",
                checkError: "Repository missing",
              },
            ],
            totalRepos: 2,
            checkedRepos: 1,
            rateLimited: true,
          });
        default:
          return Promise.reject(new Error(`Unexpected command: ${command}`));
      }
    });
    renderSettings(true);
    await user.click(screen.getByRole("button", { name: /check updates/i }));
    await user.click(await screen.findByRole("button", { name: /update manager/i }));
    const links = await screen.findAllByRole("button", { name: "Configure GitHub Token" });
    expect(links).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Configure GitHub Token" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /update manager/i })).not.toBeInTheDocument(),
    );
    const input = await screen.findByLabelText("Personal access token");
    await waitFor(() => expect(input).toHaveFocus());
  });

  it("shows authenticated quota guidance and offers token setup only for invalid credentials", async () => {
    const user = userEvent.setup();
    vi.mocked(invoke).mockImplementation((command) => {
      switch (command) {
        case "get_installed_skills":
          return Promise.resolve([
            { id: "skill:limited", directory: "limited", origin: "ssot" },
            { id: "skill:invalid", directory: "invalid", origin: "ssot" },
          ]);
        case "get_settings":
          return Promise.resolve({});
        case "get_github_credential_status":
          return Promise.resolve({ hasToken: true, expiresAt: null });
        case "get_cache_size":
          return Promise.resolve(0);
        case "get_skill_update_history":
          return Promise.resolve([]);
        case "check_skill_updates":
          return Promise.resolve({
            skills: [
              {
                skillName: "limited",
                hasUpdate: false,
                repo: "owner/repo",
                checkErrorCode: "rateLimited",
                checkError: JSON.stringify({
                  code: "rateLimited",
                  authenticated: true,
                  retryAt: 2000000000,
                }),
              },
              {
                skillName: "invalid",
                hasUpdate: false,
                repo: "owner/other",
                checkErrorCode: "githubUnauthorized",
                checkError: JSON.stringify({ code: "githubUnauthorized" }),
              },
            ],
            totalRepos: 2,
            checkedRepos: 0,
            rateLimited: true,
          });
        default:
          return Promise.reject(new Error(`Unexpected command: ${command}`));
      }
    });
    renderSettings(true);
    await user.click(screen.getByRole("button", { name: /check updates/i }));
    await user.click(await screen.findByRole("button", { name: /update manager/i }));
    expect(await screen.findByText(/Wait before trying again/)).toHaveTextContent(
      "Try again after",
    );
    expect(screen.getByText(/invalid or revoked/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Configure GitHub Token" })).toHaveLength(1);
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
        case "get_github_credential_status":
          return Promise.resolve({ hasToken: false, expiresAt: null });
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
            skippedDrifted: [],
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
      expect(toast.error).toHaveBeenCalledWith(
        "Update failed: 0 updated, 1 failed: GitHub requests are temporarily rate limited. Please try again later.",
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
        case "get_github_credential_status":
          return Promise.resolve({ hasToken: false, expiresAt: null });
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
            skippedDrifted: [],
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
      expect(toast.error).toHaveBeenCalledWith(
        "Update failed: 0 updated, 1 failed: vercel-labs/agent-browser is temporarily unavailable. Please try again later.",
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
        case "get_github_credential_status":
          return Promise.resolve({ hasToken: false, expiresAt: null });
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
            skippedDrifted: [],
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
        case "get_github_credential_status":
          return Promise.resolve({ hasToken: false, expiresAt: null });
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
        case "get_github_credential_status":
          return Promise.resolve({ hasToken: false, expiresAt: null });
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

  it("shows update check diagnostics in the update manager", async () => {
    const user = userEvent.setup();
    vi.mocked(invoke).mockImplementation((command) => {
      switch (command) {
        case "get_installed_skills":
          return Promise.resolve([
            { id: "repo:owner/repo:missing-skill", directory: "missing-skill", origin: "ssot" },
          ]);
        case "get_settings":
          return Promise.resolve({});
        case "get_github_credential_status":
          return Promise.resolve({ hasToken: false, expiresAt: null });
        case "get_cache_size":
          return Promise.resolve(1024);
        case "get_skill_update_history":
          return Promise.resolve([]);
        case "check_skill_updates":
          return Promise.resolve({
            skills: [
              {
                skillName: "missing-skill",
                hasUpdate: false,
                currentSha: "old",
                latestSha: null,
                repo: "owner/repo",
                checkErrorCode: "missingRemotePath",
                checkError: "Skill path no longer exists in owner/repo@main: skills/missing-skill",
              },
            ],
            totalRepos: 1,
            checkedRepos: 1,
            rateLimited: false,
          });
        default:
          return Promise.reject(new Error(`Unexpected command: ${command}`));
      }
    });

    renderSettings();

    await user.click(await screen.findByRole("button", { name: /check updates/i }));

    await screen.findByText("1 skill(s) could not be checked. Open Update Manager for details.");
    await user.click(await screen.findByRole("button", { name: /update manager/i }));

    await screen.findByText("Needs attention (1)");
    await screen.findByText("missing-skill");
    await screen.findByText("Skill path no longer exists in owner/repo@main: skills/missing-skill");
    expect(await screen.findByRole("button", { name: /^update selected$/i })).toBeDisabled();
  });

  it("shows non-SSOT skills but leaves plugin discovery off by default", async () => {
    renderSettings();

    expect(await screen.findByRole("switch", { name: "Show non-SSOT skills" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Show plugin skills" })).not.toBeChecked();
  });

  it("writes the non-SSOT preference when switched off", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole("switch", { name: "Show non-SSOT skills" }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("update_setting", {
        key: "show_non_ssot",
        value: "false",
      }),
    );
  });
});

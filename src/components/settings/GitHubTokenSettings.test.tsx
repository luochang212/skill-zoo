import "@/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { GitHubTokenSettings } from "./GitHubTokenSettings";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));

/** Saved-state fixture the status command serves; token material never ships. */
let saved: { token: string; expiresAt: string | null };

function statusResponse() {
  return { hasToken: saved.token.trim().length > 0, expiresAt: saved.expiresAt };
}

function mockDefault() {
  vi.mocked(invoke).mockImplementation((command, args) => {
    if (command === "get_settings") return Promise.resolve({ theme: "dark" });
    if (command === "get_github_credential_status") return Promise.resolve(statusResponse());
    if (command === "verify_github_token") {
      return Promise.resolve({ authenticated: true, limit: 5000 });
    }
    if (command === "save_github_credentials") {
      const { token, expiresAt } = (args ?? {}) as { token?: string; expiresAt?: string | null };
      saved = { token: token ?? "", expiresAt: token ? (expiresAt ?? null) : null };
      return Promise.resolve();
    }
    return Promise.reject(new Error(`Unexpected command: ${command}`));
  });
}

function renderSettings() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <GitHubTokenSettings />
    </QueryClientProvider>,
  );
}

async function openDialog(label = "Personal access token") {
  await userEvent.setup().click(screen.getByRole("button", { name: /set up|manage|配置|管理/i }));
  const input = await screen.findByLabelText(label);
  await waitFor(() => expect(input).toBeEnabled());
  return input;
}

function stubUserAgent(ua: string) {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(ua);
}

describe("GitHubTokenSettings", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    saved = { token: "", expiresAt: null };
    vi.mocked(invoke).mockReset();
    vi.mocked(openUrl).mockClear();
    mockDefault();
  });

  afterEach(() => {
    // Restore userAgent spies used by the mask-glyph tests.
    vi.restoreAllMocks();
  });

  it("reflects the connection state on the row before any dialog is opened", async () => {
    saved = { token: "previous-token", expiresAt: null };
    renderSettings();
    expect(await screen.findByText("Token configured")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /manage/i })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Saved state arrives via the status command, not the generic settings read.
    expect(
      vi.mocked(invoke).mock.calls.some(([command]) => command === "get_github_credential_status"),
    ).toBe(true);
  });

  it("stands in the saved credential with a selectable mask, never the token", async () => {
    stubUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    );
    saved = { token: "previous-token", expiresAt: null };
    renderSettings();
    const input = await openDialog();
    expect(input).toHaveAttribute("type", "password");
    // Real value, so select-all/delete/paste work; the glyph matches what the
    // platform draws for password masking (U+F79A on macOS WebKit).
    const maskValue = (input as HTMLInputElement).value;
    expect(maskValue).toBe("\uF79A".repeat(40));
    expect(maskValue).not.toContain("previous");
    // Nothing new entered yet → saving is unavailable. (Row and dialog share
    // the copy now, so scope to the dialog.)
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
    expect(within(screen.getByRole("dialog")).getByText("Token configured")).toBeInTheDocument();
  });

  it("verifies the saved token when the dialog opens and shows the live quota", async () => {
    saved = { token: "previous-token", expiresAt: null };
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "get_github_credential_status") return Promise.resolve(statusResponse());
      if (command === "verify_saved_github_token") {
        return Promise.resolve({ authenticated: true, limit: 4900, expiresAt: null });
      }
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });
    renderSettings();
    await openDialog();
    await screen.findByText("Active · quota: 4900 requests/hour");
    const call = vi
      .mocked(invoke)
      .mock.calls.find(([command]) => command === "verify_saved_github_token");
    expect(call).toBeDefined();
    // The saved token never crosses the bridge: the backend verifies it itself.
    expect(call?.[1]).toBeUndefined();
  });

  it("marks a saved token no longer valid when the live check reports unauthenticated", async () => {
    saved = { token: "previous-token", expiresAt: null };
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "get_github_credential_status") return Promise.resolve(statusResponse());
      if (command === "verify_saved_github_token") {
        return Promise.resolve({ authenticated: false, limit: 0, expiresAt: null });
      }
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });
    renderSettings();
    await openDialog();
    const line = await screen.findByText(
      "Token no longer valid · GitHub rejected it, save a new one",
    );
    expect(line).toHaveClass("text-amber-600");
    // The invalid verdict does not alter the saved credential.
    expect(saved.token).toBe("previous-token");
  });

  it("keeps the saved-state line when the live check cannot run", async () => {
    saved = { token: "previous-token", expiresAt: null };
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "get_github_credential_status") return Promise.resolve(statusResponse());
      if (command === "verify_saved_github_token") {
        return Promise.reject(new Error("offline"));
      }
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });
    renderSettings();
    await openDialog();
    // A failed passive check is not the save flow's "Verification failed".
    // The dialog just keeps the saved-state display.
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Token configured")).toBeInTheDocument();
    expect(within(dialog).queryByText(/Verification failed/)).not.toBeInTheDocument();
  });

  it("matches the plain bullet mask on non-macOS engines", async () => {
    stubUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    );
    saved = { token: "previous-token", expiresAt: null };
    renderSettings();
    const input = await openDialog();
    expect(input).toHaveValue("•".repeat(40));
  });

  it("keeps saving unavailable while mask characters remain in the field", async () => {
    stubUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    );
    const user = userEvent.setup();
    saved = { token: "previous-token", expiresAt: null };
    renderSettings();
    const input = await openDialog();
    const save = screen.getByRole("button", { name: /^save$/i });
    // Partially cleared. Still unchanged semantics.
    fireEvent.change(input, { target: { value: "\uF79A".repeat(20) } });
    expect(save).toBeDisabled();
    // Dots mixed with new text. Still not a token, still unavailable.
    fireEvent.change(input, { target: { value: "\uF79A".repeat(10) + "abc" } });
    expect(save).toBeDisabled();
    await user.click(save);
    expect(
      vi.mocked(invoke).mock.calls.some(([command]) => command === "save_github_credentials"),
    ).toBe(false);
    expect(saved.token).toBe("previous-token");
  });

  it("verifies the trimmed candidate before saving and restores the mask afterwards", async () => {
    const user = userEvent.setup();
    saved = { token: "previous-token", expiresAt: null };
    renderSettings();
    const input = await openDialog();
    expect(input).toHaveAttribute("type", "password");
    await user.clear(input);
    await user.type(input, "  candidate-token  ");
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await screen.findAllByText("Active · quota: 5000 requests/hour");
    expect(invoke).toHaveBeenCalledWith("verify_github_token", { token: "candidate-token" });
    expect(invoke).toHaveBeenCalledWith("save_github_credentials", {
      token: "candidate-token",
      expiresAt: null,
    });
    const commands = vi.mocked(invoke).mock.calls.map(([command]) => command);
    expect(commands.indexOf("verify_github_token")).toBeLessThan(
      commands.indexOf("save_github_credentials"),
    );
    // Write-only: the saved token never re-enters the input; the mask does.
    // (Unstubbed jsdom UA → the plain-bullet mask branch.)
    await waitFor(() => expect(input).toHaveValue("•".repeat(40)));
    expect(saved.token).toBe("candidate-token");
  });

  it.each([0, 60])(
    "rejects unauthenticated quota %s without replacing a saved token",
    async (limit) => {
      saved = { token: "previous-token", expiresAt: null };
      vi.mocked(invoke).mockImplementation((command) => {
        if (command === "get_github_credential_status") return Promise.resolve(statusResponse());
        return Promise.resolve({ authenticated: false, limit });
      });
      const user = userEvent.setup();
      renderSettings();
      const input = await openDialog();
      await user.clear(input);
      await user.type(input, "invalid-token");
      await user.click(screen.getByRole("button", { name: /^save$/i }));
      await screen.findByText(/Verification failed/);
      expect(
        vi.mocked(invoke).mock.calls.some(([command]) => command === "save_github_credentials"),
      ).toBe(false);
      expect(saved.token).toBe("previous-token");
      expect(input).toHaveValue("invalid-token");
    },
  );

  it("keeps saving disabled while verification is pending", async () => {
    let finish!: (result: { authenticated: boolean; limit: number }) => void;
    const verification = new Promise((resolve) => {
      finish = resolve;
    });
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "get_github_credential_status") return Promise.resolve(statusResponse());
      return verification;
    });
    const user = userEvent.setup();
    renderSettings();
    const input = await openDialog();
    await user.type(input, "candidate-token");
    const button = screen.getByRole("button", { name: /^save$/i });
    await user.click(button);
    await screen.findByText("Verifying and saving…");
    expect(button).toBeDisabled();
    expect(
      vi.mocked(invoke).mock.calls.some(([command]) => command === "save_github_credentials"),
    ).toBe(false);
    await act(async () => finish({ authenticated: false, limit: 0 }));
    await waitFor(() => expect(button).toBeEnabled());
  });

  it("shows verification network failures without persisting or exposing raw errors", async () => {
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "get_github_credential_status") return Promise.resolve(statusResponse());
      return Promise.reject(new Error("raw candidate-token error"));
    });
    const user = userEvent.setup();
    renderSettings();
    const input = await openDialog();
    await user.type(input, "candidate-token");
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await screen.findByText(/Verification failed/);
    expect(screen.queryByText(/raw candidate-token error/)).not.toBeInTheDocument();
    expect(
      vi.mocked(invoke).mock.calls.some(([command]) => command === "save_github_credentials"),
    ).toBe(false);
  });

  it("does not report active when persistence fails after verification", async () => {
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "get_github_credential_status") return Promise.resolve(statusResponse());
      if (command === "verify_github_token")
        return Promise.resolve({ authenticated: true, limit: 5000 });
      return Promise.reject(new Error("disk write failed"));
    });
    const user = userEvent.setup();
    renderSettings();
    const input = await openDialog();
    await user.type(input, "candidate-token");
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await screen.findByText(
      "Could not save the token. Your previous configuration is still active.",
    );
    expect(screen.queryByText(/Active · quota/)).not.toBeInTheDocument();
  });

  it("does not change the saved credential when nothing new is entered", async () => {
    saved = { token: "previous-token", expiresAt: null };
    const user = userEvent.setup();
    renderSettings();
    const input = await openDialog();
    const save = screen.getByRole("button", { name: /^save$/i });
    // Untouched mask: saving is unavailable.
    expect(save).toBeDisabled();
    // Fully cleared: still nothing new to save.
    await user.clear(input);
    expect(input).toHaveValue("");
    expect(save).toBeDisabled();
    await user.click(save);
    expect(
      vi.mocked(invoke).mock.calls.some(([command]) => command === "save_github_credentials"),
    ).toBe(false);
    expect(saved.token).toBe("previous-token");
  });

  it("offers no removal affordance because saving a new token is the only way a credential changes", async () => {
    saved = { token: "previous-token", expiresAt: null };
    const user = userEvent.setup();
    renderSettings();
    const input = await openDialog();
    expect(screen.queryByRole("button", { name: /remove token|confirm removal/i })).toBeNull();
    // Select-all + paste (the clear) replaces the mask; the new token saves.
    await user.clear(input);
    await user.type(input, "replacement-token");
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await screen.findAllByText("Active · quota: 5000 requests/hour");
    expect(invoke).toHaveBeenCalledWith("save_github_credentials", {
      token: "replacement-token",
      expiresAt: null,
    });
    expect(saved.token).toBe("replacement-token");
  });

  it("shows the verified token's expiry on the row and persists it", async () => {
    const user = userEvent.setup();
    vi.mocked(invoke).mockImplementation((command, args) => {
      if (command === "get_github_credential_status") return Promise.resolve(statusResponse());
      if (command === "verify_github_token") {
        return Promise.resolve({
          authenticated: true,
          limit: 5000,
          expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        });
      }
      if (command === "save_github_credentials") {
        const { token, expiresAt } = (args ?? {}) as { token?: string; expiresAt?: string | null };
        saved = { token: token ?? "", expiresAt: token ? (expiresAt ?? null) : null };
        return Promise.resolve();
      }
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });
    renderSettings();
    await openDialog();
    await user.type(screen.getByLabelText("Personal access token"), "candidate-token");
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await screen.findAllByText(/Active · quota: 5000 requests\/hour · expires /);
    expect(invoke).toHaveBeenCalledWith("save_github_credentials", {
      token: "candidate-token",
      expiresAt: expect.any(String),
    });
  });

  it("warns when the verified token expires within seven days", async () => {
    const user = userEvent.setup();
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "get_github_credential_status") return Promise.resolve(statusResponse());
      if (command === "verify_github_token") {
        return Promise.resolve({
          authenticated: true,
          limit: 5000,
          expiresAt: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(),
        });
      }
      if (command === "save_github_credentials") return Promise.resolve();
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });
    renderSettings();
    await openDialog();
    await user.type(screen.getByLabelText("Personal access token"), "candidate-token");
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await screen.findAllByText(/expires soon/);
  });

  it("flags an expired saved token on the row without a fresh verification", async () => {
    saved = {
      token: "previous-token",
      expiresAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    };
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "get_github_credential_status") return Promise.resolve(statusResponse());
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });
    renderSettings();
    await screen.findByText(/Token expired/);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      vi.mocked(invoke).mock.calls.some(([command]) => command === "verify_github_token"),
    ).toBe(false);
  });

  it("distinguishes a saved token from a fresh verification and opens the creation page", async () => {
    saved = { token: "previous-token", expiresAt: null };
    const user = userEvent.setup();
    renderSettings();
    expect(await screen.findByText("Token configured")).toBeInTheDocument();
    expect(
      vi.mocked(invoke).mock.calls.some(([command]) => command === "verify_github_token"),
    ).toBe(false);
    await openDialog();
    await user.click(screen.getByRole("button", { name: "Open GitHub token creation page" }));
    expect(openUrl).toHaveBeenCalledWith("https://github.com/settings/personal-access-tokens/new");
  });

  it("does not submit Enter during IME composition", async () => {
    renderSettings();
    const input = await openDialog();
    fireEvent.change(input, { target: { value: "token" } });
    expect(fireEvent.keyDown(input, { key: "Enter", isComposing: true })).toBe(false);
    expect(
      vi.mocked(invoke).mock.calls.some(([command]) => command === "verify_github_token"),
    ).toBe(false);
  });

  it("provides Chinese public-only instructions inside the dialog and anonymous status on the row", async () => {
    await i18n.changeLanguage("zh");
    renderSettings();
    await screen.findByText("未配置 · 匿名配额 60 次/小时");
    await openDialog("个人访问令牌");
    expect(
      screen.getByText("此 Token 不需要任何仓库权限，无法访问你的私有仓库。"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Repository access 选择 Public Repositories/)).toBeInTheDocument();
    expect(screen.getByLabelText("个人访问令牌")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("个人访问令牌")).toHaveValue("");
  });
});

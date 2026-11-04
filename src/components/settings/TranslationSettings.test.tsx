import "@/i18n";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import i18n from "@/i18n";
import { createTestQueryClient } from "@/test/utils";
import { TranslationSettings } from "./TranslationSettings";
import { AiSettingsDialog, AiSettingsRows } from "./AiSettings";
import { translationApi } from "@/lib/api/translation";
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api/translation", () => ({
  translationApi: {
    canToggleThinking: vi.fn().mockResolvedValue(false),
    providers: vi.fn(),
    providerApiKey: vi.fn(),
    preferences: vi.fn(),
    saveProvider: vi.fn(),
    savePreferences: vi.fn(),
    deleteProvider: vi.fn(),
    recoverProviders: vi.fn(),
    clearCache: vi.fn(),
    start: vi.fn(),
    resolveModel: vi.fn(),
    testConnection: vi.fn(),
  },
}));
const provider = {
  id: "p",
  name: "Private gateway",
  enabled: true,
  protocol: "openai-chat-completions" as const,
  baseUrl: "http://localhost/v1/",
  hasApiKey: true,
  models: [{ id: "m", enabled: true, maxOutputTokens: null }],
};
beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(translationApi.providerApiKey).mockResolvedValue("saved-key");
  await i18n.changeLanguage("en");
  vi.mocked(translationApi.resolveModel).mockResolvedValue(null);
  vi.mocked(translationApi.testConnection).mockResolvedValue(12);
  vi.mocked(translationApi.providers).mockResolvedValue([provider]);
  vi.mocked(translationApi.preferences).mockResolvedValue({
    providerId: "p",
    modelId: "m",
    targetLanguage: "ja",
  });
  vi.mocked(translationApi.savePreferences).mockResolvedValue();
  vi.mocked(translationApi.saveProvider).mockImplementation(async ({ apiKey, ...update }) => [
    {
      ...provider,
      ...update,
      id: update.id ?? "new",
      hasApiKey: apiKey === null ? provider.hasApiKey : !!apiKey,
    },
  ]);
});
const wrap = (element: React.ReactNode) =>
  render(<QueryClientProvider client={createTestQueryClient()}>{element}</QueryClientProvider>);
describe("translation settings", () => {
  it("saves the cache-display preference without changing the selected language or model", async () => {
    const user = userEvent.setup();
    wrap(<TranslationSettings onConfigureModels={vi.fn()} />);
    const toggle = screen.getByRole("switch", { name: "Prefer translations" });
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await user.click(toggle);
    await waitFor(() =>
      expect(translationApi.savePreferences).toHaveBeenCalledWith({
        providerId: "p",
        modelId: "m",
        targetLanguage: "ja",
        preferCachedTranslations: true,
      }),
    );
    expect(translationApi.start).not.toHaveBeenCalled();
  });
  it("loads and edits the real saved key without a fixed mask", async () => {
    wrap(<AiSettingsDialog open initialPage="providers" onOpenChange={vi.fn()} />);
    const key = await screen.findByLabelText("API key");
    await waitFor(() => expect(key).toHaveValue("saved-key"));
    expect(key).toHaveAttribute("type", "password");
    expect(screen.queryByRole("button", { name: "Replace" })).not.toBeInTheDocument();
    fireEvent.change(key, { target: { value: "saved-key-edited" } });
    fireEvent.blur(key);
    await waitFor(() =>
      expect(translationApi.saveProvider).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: "saved-key-edited" }),
      ),
    );
  });
  it("routes an empty model picker through configuration and back without silently selecting a model", async () => {
    vi.mocked(translationApi.providers).mockResolvedValue([]);
    vi.mocked(translationApi.saveProvider).mockImplementation(async (update) => {
      const configured = [{ ...provider, name: update.name, models: update.models }];
      vi.mocked(translationApi.providers).mockResolvedValue(configured);
      return configured;
    });
    const user = userEvent.setup();
    wrap(<AiSettingsDialog open initialPage="translation" onOpenChange={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: /Configure models/ }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Model management" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "OpenAI" }));
    await user.click(screen.getByRole("button", { name: "Add model" }));
    const editor = screen.getByRole("dialog", { name: "Add model" });
    fireEvent.change(within(editor).getByLabelText("Model ID"), { target: { value: "new-model" } });
    await user.click(within(editor).getByRole("button", { name: "Confirm" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(await screen.findByRole("button", { name: "Back to translation settings" }));
    expect(screen.getByRole("dialog", { name: "Translation settings" })).toBeInTheDocument();
    expect(screen.getByLabelText("Target language")).toHaveTextContent("日本語");
    expect(screen.queryByRole("button", { name: /Configure models/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Translation model")).toHaveTextContent(
      "Selected model unavailable",
    );
    expect(translationApi.savePreferences).not.toHaveBeenCalled();
    expect(translationApi.start).not.toHaveBeenCalled();
    await user.click(screen.getByLabelText("Translation model"));
    expect(screen.getByRole("menuitemradio", { name: "OpenAI · new-model" })).toBeInTheDocument();
    expect(screen.queryByText(/Document content is sent to/)).not.toBeInTheDocument();
  });
  it.each([
    { ...provider, enabled: false },
    { ...provider, models: [] },
    { ...provider, models: [{ id: "m", enabled: false, maxOutputTokens: null }] },
  ])(
    "offers model configuration when the service has no usable models (%#)",
    async (configured) => {
      vi.mocked(translationApi.providers).mockResolvedValue([configured]);
      const configure = vi.fn();
      const user = userEvent.setup();
      wrap(<TranslationSettings onConfigureModels={configure} />);
      await user.click(await screen.findByRole("button", { name: /Configure models/ }));
      expect(configure).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    },
  );
  it("does not treat provider loading or a failed read as an empty model configuration", async () => {
    let reject!: (reason: string) => void;
    vi.mocked(translationApi.providers).mockImplementation(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    wrap(<TranslationSettings onConfigureModels={vi.fn()} />);
    expect(screen.getByLabelText("Translation model")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Configure models/ })).not.toBeInTheDocument();
    reject("network");
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Configure models/ })).not.toBeInTheDocument();
  });
  it("tests only on click using the unsaved connection and prevents duplicate requests", async () => {
    let complete!: (ms: number) => void;
    vi.mocked(translationApi.testConnection).mockImplementation(
      () => new Promise<number>((resolve) => (complete = resolve)),
    );
    const user = userEvent.setup();
    wrap(<AiSettingsDialog open initialPage="providers" onOpenChange={vi.fn()} />);
    const test = await screen.findByRole("button", { name: "Test connection for m" });
    expect(translationApi.testConnection).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "http://localhost:1234/v1" },
    });
    await user.click(test);
    expect(vi.mocked(translationApi.testConnection).mock.calls[0]?.[0]).toEqual({
      provider: expect.objectContaining({
        id: "p",
        baseUrl: "http://localhost:1234/v1",
        apiKey: null,
      }),
      modelId: "m",
    });
    expect(test).toBeDisabled();
    expect(test).toHaveAttribute("aria-busy", "true");
    expect(test.textContent).toBe("");
    await user.click(test);
    expect(translationApi.testConnection).toHaveBeenCalledTimes(1);
    complete(25);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("m connected · 25 ms"));
    expect(translationApi.saveProvider).not.toHaveBeenCalled();
    expect(translationApi.savePreferences).not.toHaveBeenCalled();
    expect(translationApi.start).not.toHaveBeenCalled();
  });
  it("tests replacement and cleared credentials with independent autosave and classified failure", async () => {
    vi.mocked(translationApi.testConnection).mockRejectedValue("authentication");
    const user = userEvent.setup();
    wrap(<AiSettingsDialog open initialPage="providers" onOpenChange={vi.fn()} />);
    const test = await screen.findByRole("button", { name: "Test connection for m" });
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "draft-key" } });
    await user.click(test);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
    expect(vi.mocked(translationApi.testConnection).mock.lastCall?.[0]).toEqual({
      provider: expect.objectContaining({ apiKey: "draft-key" }),
      modelId: "m",
    });
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("m connection failed:"));
    await user.clear(screen.getByLabelText("API key"));
    await user.click(test);
    await waitFor(() => expect(translationApi.testConnection).toHaveBeenCalledTimes(2));
    expect(vi.mocked(translationApi.testConnection).mock.lastCall?.[0]).toEqual({
      provider: expect.objectContaining({ apiKey: "" }),
      modelId: "m",
    });
    expect(translationApi.saveProvider).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "" }),
    );
  });
  it("ignores test results after the draft changes or its editor unmounts", async () => {
    let complete!: (ms: number) => void;
    vi.mocked(translationApi.testConnection).mockImplementation(
      () => new Promise<number>((resolve) => (complete = resolve)),
    );
    const user = userEvent.setup();
    const view = wrap(<AiSettingsDialog open initialPage="providers" onOpenChange={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "Test connection for m" }));
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "http://localhost:1234/v1" },
    });
    complete(12);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Test connection for m" })).toBeEnabled(),
    );
    expect(toast.success).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Test connection for m" }));
    view.unmount();
    complete(20);
    await waitFor(() => expect(translationApi.testConnection).toHaveBeenCalledTimes(2));
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
  it("notifies each completed cache clear with a toast without adding inline feedback", async () => {
    let finishClear!: () => void;
    vi.mocked(translationApi.clearCache).mockImplementation(
      () => new Promise<void>((resolve) => (finishClear = resolve)),
    );
    const user = userEvent.setup();
    wrap(<TranslationSettings onConfigureModels={vi.fn()} />);
    const clear = screen.getByRole("button", { name: "Clear" });
    await user.click(clear);
    expect(translationApi.clearCache).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(clear).toBeDisabled();
    expect(toast.success).not.toHaveBeenCalled();
    finishClear();
    await waitFor(() => expect(clear).toBeEnabled());
    expect(toast.success).toHaveBeenCalledWith("Translation cache cleared.");
    expect(screen.queryByText("Translation cache cleared.")).not.toBeInTheDocument();
    await user.click(clear);
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    finishClear();
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(2));
  });
  it("resets the cache-clear confirmation when translation settings are reopened", async () => {
    const user = userEvent.setup();
    wrap(<AiSettingsRows />);
    await user.click(screen.getByRole("button", { name: "Open Translation settings" }));
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Open Translation settings" }));
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
    expect(translationApi.clearCache).not.toHaveBeenCalled();
  });
  it("shows the empty model hint until a model is added and restores it after removal", async () => {
    vi.mocked(translationApi.providers).mockResolvedValue([{ ...provider, models: [] }]);
    const user = userEvent.setup();
    wrap(<AiSettingsDialog open initialPage="providers" onOpenChange={vi.fn()} />);
    const hint = "No models are configured. Add a model to use it for translation.";
    expect(await screen.findByText(hint)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add model" }));
    const editor = screen.getByRole("dialog", { name: "Add model" });
    await user.type(within(editor).getByLabelText("Model ID"), "new-model");
    await user.click(within(editor).getByRole("button", { name: "Confirm" }));
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit model new-model" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove model 1" }));
    expect(screen.getByText(hint)).toBeInTheDocument();
    expect(translationApi.saveProvider).toHaveBeenLastCalledWith(
      expect.objectContaining({ models: [] }),
    );
  });
  it("keeps saved target language and only saves a user change", async () => {
    const user = userEvent.setup();
    wrap(<TranslationSettings onConfigureModels={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByLabelText("Target language")).toHaveTextContent("日本語"),
    );
    expect(screen.queryByText(/Document content is sent to/)).not.toBeInTheDocument();
    expect(translationApi.savePreferences).not.toHaveBeenCalled();
    expect(translationApi.start).not.toHaveBeenCalled();
    await user.click(screen.getByLabelText("Target language"));
    await user.click(screen.getByRole("menuitemradio", { name: "繁體中文" }));
    expect(translationApi.savePreferences).toHaveBeenCalledWith({
      providerId: "p",
      modelId: "m",
      targetLanguage: "zh-TW",
    });
  });
  it("does not silently replace an unavailable selected model", async () => {
    vi.mocked(translationApi.preferences).mockResolvedValue({
      providerId: "removed",
      modelId: "m",
      targetLanguage: "en",
    });
    wrap(<TranslationSettings onConfigureModels={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByLabelText("Translation model")).toHaveTextContent(
        "Selected model unavailable",
      ),
    );
    expect(translationApi.savePreferences).not.toHaveBeenCalled();
  });
  it("editing a name preserves write-only credentials and does not generate", async () => {
    const user = userEvent.setup();
    wrap(<AiSettingsDialog open initialPage="providers" onOpenChange={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "Edit Private gateway" }));
    expect(screen.queryByLabelText("New API key")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Provider name")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Rename provider" }));
    await user.clear(screen.getByLabelText("Provider name"));
    await user.type(screen.getByLabelText("Provider name"), "Renamed");
    await user.tab();
    await waitFor(() =>
      expect(translationApi.saveProvider).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Renamed", apiKey: null }),
      ),
    );
    expect(translationApi.start).not.toHaveBeenCalled();
  });
  it("cancels inline rename without closing the dialog and treats IME Enter as text input", async () => {
    const user = userEvent.setup();
    wrap(<AiSettingsDialog open initialPage="providers" onOpenChange={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "Rename provider" }));
    const input = screen.getByLabelText("Provider name");
    fireEvent.change(input, { target: { value: "临时名称" } });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(input).toBeInTheDocument();
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(input).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Model management" })).toBeInTheDocument();
    const rename = screen.getByRole("button", { name: "Rename provider" });
    expect(rename).toHaveTextContent("Private gateway");
    expect(rename).toHaveFocus();
    await user.click(rename);
    fireEvent.change(screen.getByLabelText("Provider name"), { target: { value: "   " } });
    await user.tab();
    expect(screen.getByRole("button", { name: "Rename provider" })).toHaveTextContent(
      "Private gateway",
    );
    expect(translationApi.saveProvider).not.toHaveBeenCalled();
  });
  it("retains failed edits, guards close and retries explicitly", async () => {
    vi.mocked(translationApi.saveProvider).mockRejectedValueOnce("configWrite");
    const close = vi.fn();
    const user = userEvent.setup();
    wrap(<AiSettingsDialog open initialPage="providers" onOpenChange={close} />);
    const url = await screen.findByLabelText("Base URL");
    await waitFor(() => expect(url).toBeEnabled());
    await user.clear(url);
    await user.type(url, "https://retry.test/v1");
    await user.tab();
    await screen.findByText("Could not save");
    expect(url).toHaveValue("https://retry.test/v1");
    await user.click(screen.getByRole("button", { name: "Close" }));
    await screen.findByRole("dialog", { name: "Unsaved changes" });
    expect(close).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(screen.queryByText("Saving...", { exact: true })).not.toBeInTheDocument(),
    );
    expect(screen.queryByText("Saved", { exact: true })).not.toBeInTheDocument();
    expect(translationApi.saveProvider).toHaveBeenCalledTimes(2);
  });
  it("keeps newer typing when an earlier autosave resolves", async () => {
    let finish!: (value: (typeof provider)[]) => void;
    vi.mocked(translationApi.saveProvider).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const user = userEvent.setup();
    wrap(<AiSettingsRows />);
    await user.click(screen.getByRole("button", { name: "Open Model management" }));
    const url = await screen.findByLabelText("Base URL");
    await waitFor(() => expect(url).toBeEnabled());
    await user.clear(url);
    await user.type(url, "https://first.test/v1");
    await user.tab();
    await waitFor(() => expect(translationApi.saveProvider).toHaveBeenCalledTimes(1));
    await user.clear(url);
    await user.type(url, "https://second.test/v1");
    finish([{ ...provider, baseUrl: "https://first.test/v1" }]);
    await screen.findByText("Unsaved changes", { exact: true });
    expect(url).toHaveValue("https://second.test/v1");
    await user.tab();
    await waitFor(() =>
      expect(translationApi.saveProvider).toHaveBeenLastCalledWith(
        expect.objectContaining({ baseUrl: "https://second.test/v1" }),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByText("Saving...", { exact: true })).not.toBeInTheDocument(),
    );
    expect(screen.queryByText("Saved", { exact: true })).not.toBeInTheDocument();
  });
  it("saves the managed service switch immediately without footer action buttons", async () => {
    const user = userEvent.setup();
    wrap(<AiSettingsRows />);
    await user.click(screen.getByRole("button", { name: "Open Model management" }));
    const toggle = await screen.findByRole("switch", { name: "Enable" });
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    await user.click(toggle);
    await waitFor(() =>
      expect(translationApi.saveProvider).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: false }),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByText("Saving...", { exact: true })).not.toBeInTheDocument(),
    );
    expect(screen.queryByText("Saved", { exact: true })).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });
  it("shows only entry cards until a detail dialog is opened and restores focus on close", async () => {
    const user = userEvent.setup();
    wrap(<AiSettingsRows />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Target language")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add service" })).not.toBeInTheDocument();
    const entry = screen.getByRole("button", { name: "Open Model management" });
    expect(entry).toHaveTextContent("Manage");
    expect(screen.getByRole("button", { name: "Open Translation settings" })).toHaveTextContent(
      "Configure",
    );
    await user.click(entry);
    expect(screen.getByRole("dialog", { name: "Model management" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Target language")).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(entry).toHaveFocus();
    expect(translationApi.savePreferences).not.toHaveBeenCalled();
  });
  it("manages services from its independent entry without changing translation preferences", async () => {
    const user = userEvent.setup();
    vi.mocked(translationApi.saveProvider).mockImplementation(async (update) => {
      const providers = [
        provider,
        { ...provider, id: "new", name: update.name, models: update.models },
      ];
      vi.mocked(translationApi.providers).mockResolvedValue(providers);
      return providers;
    });
    wrap(<AiSettingsRows />);
    await user.click(screen.getByRole("button", { name: "Open Translation settings" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Target language")).toHaveTextContent("日本語"),
    );
    expect(screen.queryByRole("button", { name: "Model management" })).not.toBeInTheDocument();
    expect(
      screen.queryByText("Add a service in Model management, then choose a model here."),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Open Model management" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Add service" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Add service" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "OpenAI" }));
    expect(screen.getByRole("dialog", { name: "Connect OpenAI" })).toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    await user.clear(screen.getByLabelText("Provider name"));
    await user.type(screen.getByLabelText("Provider name"), "New gateway");
    expect(screen.queryByRole("button", { name: /Edit model / })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add model" }));
    await user.type(screen.getByLabelText("Model ID"), "user-chosen-model");
    await user.click(
      within(screen.getByRole("dialog", { name: "Add model" })).getByRole("button", {
        name: "Confirm",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("button", { name: "Edit New gateway" });
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Open Translation settings" }));
    expect(screen.getByRole("dialog", { name: "Translation settings" })).toBeInTheDocument();
    expect(screen.getByLabelText("Target language")).toHaveTextContent("日本語");
    expect(screen.getByLabelText("Translation model")).toHaveTextContent("Private gateway · m");
    await user.click(screen.getByLabelText("Translation model"));
    expect(
      screen.getByRole("menuitemradio", { name: "New gateway · user-chosen-model" }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(translationApi.savePreferences).not.toHaveBeenCalled();
    expect(translationApi.start).not.toHaveBeenCalled();
    await user.click(screen.getByLabelText("Translation model"));
    await user.click(
      screen.getByRole("menuitemradio", { name: "New gateway · user-chosen-model" }),
    );
    await waitFor(() =>
      expect(translationApi.savePreferences).toHaveBeenCalledWith({
        providerId: "new",
        modelId: "user-chosen-model",
        targetLanguage: "ja",
      }),
    );
    expect(translationApi.start).not.toHaveBeenCalled();
  });
  it("keeps the options dialog open when dismissing a custom picker", async () => {
    const user = userEvent.setup();
    wrap(<AiSettingsRows />);
    await user.click(screen.getByRole("button", { name: "Open Translation settings" }));
    await user.click(screen.getByLabelText("Target language"));
    expect(screen.getByRole("menuitemradio", { name: "日本語" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Translation settings" })).toBeInTheDocument();
    expect(screen.getByLabelText("Target language")).toHaveFocus();
    await user.click(screen.getByLabelText("Target language"));
    fireEvent.pointerDown(document.body, { button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(document.body, { button: 0, pointerType: "mouse" });
    fireEvent.click(document.body);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(screen.getByRole("dialog", { name: "Translation settings" })).toBeInTheDocument();
    expect(translationApi.savePreferences).not.toHaveBeenCalled();
  });
  it("starts an empty setup with service templates and prefills the chosen service", async () => {
    vi.mocked(translationApi.providers).mockResolvedValue([]);
    const user = userEvent.setup();
    wrap(<AiSettingsRows />);
    await user.click(screen.getByRole("button", { name: "Open Model management" }));
    await user.click(await screen.findByRole("button", { name: "Anthropic" }));
    expect(screen.getByRole("dialog", { name: "Connect Anthropic" })).toBeInTheDocument();
    expect(screen.getByLabelText("Provider name")).toHaveValue("Anthropic");
    expect(screen.getByLabelText("Provider name").parentElement?.parentElement).toContainElement(
      screen.getByRole("switch", { name: "Enable" }),
    );
    expect(screen.queryByRole("button", { name: /More actions for/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Base URL")).toHaveValue("https://api.anthropic.com/v1/");
    expect(screen.getByLabelText("API type")).toHaveTextContent("Anthropic Messages");
    expect(screen.queryByLabelText("Service")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit model / })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("New model ID")).not.toBeInTheDocument();
    expect(translationApi.saveProvider).not.toHaveBeenCalled();
    expect(translationApi.start).not.toHaveBeenCalled();
    const back = screen.getByRole("button", { name: "Back to service selection" });
    expect(back).toHaveTextContent("");
    await user.click(back);
    expect(screen.getByRole("dialog", { name: "Model management" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Custom" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ollama" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ZCode" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "智谱" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Custom" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Add service" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Custom" }));
    expect(screen.getByLabelText("Base URL")).toHaveValue("");
    expect(screen.getByRole("dialog", { name: "Custom service" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { name: "Model management" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "OpenAI" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(translationApi.savePreferences).not.toHaveBeenCalled();
  });
  it("saves before switching services and guards invalid drafts before adding", async () => {
    const other = { ...provider, id: "other", name: "Other service" };
    vi.mocked(translationApi.providers).mockResolvedValue([provider, other]);
    vi.mocked(translationApi.saveProvider).mockImplementation(
      async ({ apiKey: _key, ...update }) => [{ ...provider, ...update, id: "p" }, other],
    );
    const user = userEvent.setup();
    wrap(<AiSettingsRows />);
    await user.click(screen.getByRole("button", { name: "Open Model management" }));
    const url = await screen.findByLabelText("Base URL");
    await waitFor(() => expect(url).toBeEnabled());
    await user.clear(url);
    await user.type(url, "https://changed.test/v1");
    expect(translationApi.saveProvider).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Edit Other service" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Rename provider" })).toHaveTextContent(
        "Other service",
      ),
    );
    expect(translationApi.saveProvider).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "https://changed.test/v1" }),
    );
    await waitFor(() => expect(screen.getByLabelText("Base URL")).toBeEnabled());
    await user.clear(screen.getByLabelText("Base URL"));
    await user.type(screen.getByLabelText("Base URL"), "incomplete");
    await user.click(screen.getByRole("button", { name: "Add service" }));
    await screen.findByRole("dialog", { name: "Unsaved changes" });
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByLabelText("Base URL")).toHaveValue("incomplete");
    expect(translationApi.saveProvider).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Add service" }));
    await user.click(await screen.findByRole("button", { name: "Discard and continue" }));
    expect(screen.getByRole("dialog", { name: "Add service" })).toBeInTheDocument();
    expect(translationApi.savePreferences).not.toHaveBeenCalled();
    expect(translationApi.start).not.toHaveBeenCalled();
  });
  it("edits write-only keys and model parameters without advanced options", async () => {
    const user = userEvent.setup();
    wrap(<AiSettingsRows />);
    await user.click(screen.getByRole("button", { name: "Open Model management" }));
    await screen.findByLabelText("API key");
    expect(screen.queryByText("Advanced options")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Custom headers")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("New API key")).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("API key"));
    await user.type(screen.getByLabelText("API key"), "new-key");
    await user.click(screen.getByRole("button", { name: "Show API key" }));
    expect(screen.getByLabelText("API key")).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "Add model" }));
    const editor = screen.getByRole("dialog", { name: "Add model" });
    expect(within(editor).getByLabelText("Model ID")).toHaveValue("");
    await user.type(within(editor).getByLabelText("Model ID"), "new-model");
    await user.type(within(editor).getByLabelText("Maximum output tokens"), "4096");
    await user.click(within(editor).getByRole("button", { name: "Confirm" }));
    expect(screen.getByRole("button", { name: "Edit model new-model" })).toBeInTheDocument();
    const enabled = screen.getByRole("switch", { name: "Enable" });
    expect(enabled).toHaveAttribute("aria-checked", "true");
    enabled.focus();
    await user.keyboard(" ");
    expect(enabled).toHaveAttribute("aria-checked", "false");
    await user.keyboard(" ");
    expect(screen.getAllByRole("switch")).toHaveLength(1);

    fireEvent.blur(screen.getByLabelText("API key"));
    await waitFor(() =>
      expect(translationApi.saveProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: "new-key",
          models: [
            provider.models[0],
            { id: "new-model", enabled: true, maxOutputTokens: 4096, thinking: false },
          ],
        }),
      ),
    );
    await screen.findByLabelText("API key");
    await user.clear(screen.getByLabelText("API key"));
    expect(screen.getByLabelText("API key")).toHaveValue("");
    fireEvent.blur(screen.getByLabelText("API key"));
    await waitFor(() =>
      expect(translationApi.saveProvider).toHaveBeenLastCalledWith(
        expect.objectContaining({ apiKey: "" }),
      ),
    );
    expect(translationApi.savePreferences).not.toHaveBeenCalled();
    expect(translationApi.start).not.toHaveBeenCalled();
  });
  it("preserves previously disabled models without exposing model switches", async () => {
    const disabledModel = { id: "disabled-model", enabled: false, maxOutputTokens: null };
    vi.mocked(translationApi.providers).mockResolvedValue([
      { ...provider, models: [disabledModel] },
    ]);
    const user = userEvent.setup();
    wrap(<AiSettingsRows />);
    await user.click(screen.getByRole("button", { name: "Open Model management" }));
    await screen.findByRole("button", { name: "Edit model disabled-model" });
    expect(screen.getAllByRole("switch")).toHaveLength(1);
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.queryByText("Enable", { exact: true })).not.toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "Enable" }));
    await waitFor(() =>
      expect(translationApi.saveProvider).toHaveBeenCalledWith(
        expect.objectContaining({ models: [disabledModel] }),
      ),
    );
  });

  it("opens a blank add form only from the button and does not submit an IME confirmation", async () => {
    const user = userEvent.setup();
    wrap(<AiSettingsRows />);
    await user.click(screen.getByRole("button", { name: "Open Model management" }));
    await screen.findByRole("button", { name: "Add model" });
    expect(screen.queryByLabelText("New model ID")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add model" }));
    const dialog = screen.getByRole("dialog", { name: "Add model" });
    const input = within(dialog).getByLabelText("Model ID");
    expect(input).toHaveValue("");
    await user.type(input, "moxing");
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229, isComposing: false });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter", isComposing: false });
    fireEvent.compositionEnd(input);
    expect(dialog).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit model moxing" })).not.toBeInTheDocument();
    expect(translationApi.saveProvider).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(dialog).toBeInTheDocument();
    expect(translationApi.saveProvider).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    expect(screen.queryByRole("dialog", { name: "Add model" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit model moxing" })).toBeInTheDocument();
    expect(translationApi.start).not.toHaveBeenCalled();
  });
});

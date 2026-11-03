import "@/i18n";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { createTestQueryClient } from "@/test/utils";
import { TranslationSettings } from "./TranslationSettings";
import { AiSettingsDialog, AiSettingsRows } from "./AiSettings";
import { translationApi } from "@/lib/api/translation";
vi.mock("@/lib/api/translation", () => ({
  translationApi: {
    providers: vi.fn(),
    preferences: vi.fn(),
    saveProvider: vi.fn(),
    savePreferences: vi.fn(),
    deleteProvider: vi.fn(),
    recoverProviders: vi.fn(),
    clearCache: vi.fn(),
    start: vi.fn(),
    resolveModel: vi.fn(),
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
  await i18n.changeLanguage("en");
  vi.mocked(translationApi.resolveModel).mockResolvedValue(null);
  vi.mocked(translationApi.providers).mockResolvedValue([provider]);
  vi.mocked(translationApi.preferences).mockResolvedValue({
    providerId: "p",
    modelId: "m",
    targetLanguage: "ja",
  });
  vi.mocked(translationApi.savePreferences).mockResolvedValue();
  vi.mocked(translationApi.saveProvider).mockResolvedValue([provider]);
});
const wrap = (element: React.ReactNode) =>
  render(<QueryClientProvider client={createTestQueryClient()}>{element}</QueryClientProvider>);
describe("translation settings", () => {
  it("keeps saved target language and only saves a user change", async () => {
    const user = userEvent.setup();
    wrap(<TranslationSettings />);
    await waitFor(() =>
      expect(screen.getByLabelText("Target language")).toHaveTextContent("日本語"),
    );
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
    wrap(<TranslationSettings />);
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
    await user.clear(screen.getByLabelText("Provider name"));
    await user.type(screen.getByLabelText("Provider name"), "Renamed");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(translationApi.saveProvider).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Renamed", apiKey: null }),
      ),
    );
    expect(translationApi.start).not.toHaveBeenCalled();
  });
  it("shows only entry cards until a detail dialog is opened and restores focus on close", async () => {
    const user = userEvent.setup();
    wrap(<AiSettingsRows />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Target language")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add service" })).not.toBeInTheDocument();
    const entry = screen.getByRole("button", { name: "Open Model settings" });
    expect(entry).toHaveTextContent("Manage");
    expect(screen.getByRole("button", { name: "Open Translation options" })).toHaveTextContent(
      "Configure",
    );
    await user.click(entry);
    expect(screen.getByRole("dialog", { name: "Model settings" })).toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "Open Translation options" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Target language")).toHaveTextContent("日本語"),
    );
    expect(screen.queryByRole("button", { name: "Model settings" })).not.toBeInTheDocument();
    expect(
      screen.queryByText("Add a service in Model settings, then choose a model here."),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Open Model settings" }));
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
    await user.click(screen.getByRole("button", { name: "Open Translation options" }));
    expect(screen.getByRole("dialog", { name: "Translation options" })).toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "Open Translation options" }));
    await user.click(screen.getByLabelText("Target language"));
    expect(screen.getByRole("menuitemradio", { name: "日本語" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Translation options" })).toBeInTheDocument();
    expect(screen.getByLabelText("Target language")).toHaveFocus();
    await user.click(screen.getByLabelText("Target language"));
    fireEvent.pointerDown(document.body, { button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(document.body, { button: 0, pointerType: "mouse" });
    fireEvent.click(document.body);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(screen.getByRole("dialog", { name: "Translation options" })).toBeInTheDocument();
    expect(translationApi.savePreferences).not.toHaveBeenCalled();
  });
  it("starts an empty setup with service templates and prefills the chosen service", async () => {
    vi.mocked(translationApi.providers).mockResolvedValue([]);
    const user = userEvent.setup();
    wrap(<AiSettingsRows />);
    await user.click(screen.getByRole("button", { name: "Open Model settings" }));
    await user.click(await screen.findByRole("button", { name: "Anthropic" }));
    expect(screen.getByRole("dialog", { name: "Connect Anthropic" })).toBeInTheDocument();
    expect(screen.getByLabelText("Provider name")).toHaveValue("Anthropic");
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
    expect(screen.getByRole("dialog", { name: "Model settings" })).toBeInTheDocument();
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
    expect(screen.getByRole("dialog", { name: "Model settings" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "OpenAI" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(translationApi.savePreferences).not.toHaveBeenCalled();
  });
  it("confirms draft discard before switching services or adding, and cancel restores saved values", async () => {
    vi.mocked(translationApi.providers).mockResolvedValue([
      provider,
      { ...provider, id: "second", name: "Other service" },
    ]);
    const user = userEvent.setup();
    wrap(<AiSettingsRows />);
    await user.click(screen.getByRole("button", { name: "Open Model settings" }));
    await screen.findByLabelText("Provider name");
    await user.clear(screen.getByLabelText("Provider name"));
    await user.type(screen.getByLabelText("Provider name"), "Draft name");
    await user.click(screen.getByRole("button", { name: "Edit Other service" }));
    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByLabelText("Provider name")).toHaveValue("Draft name");
    await user.click(screen.getByRole("button", { name: "Add service" }));
    await user.click(screen.getByRole("button", { name: "Discard and continue" }));
    await user.click(screen.getByRole("button", { name: "Back to model settings" }));
    expect(screen.getByLabelText("Provider name")).toHaveValue("Private gateway");
    await user.click(screen.getByRole("button", { name: "Edit Other service" }));
    expect(screen.getByLabelText("Provider name")).toHaveValue("Other service");
    await user.clear(screen.getByLabelText("Provider name"));
    await user.type(screen.getByLabelText("Provider name"), "Discard me");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("Provider name")).toHaveValue("Other service");
    expect(translationApi.saveProvider).not.toHaveBeenCalled();
    expect(translationApi.savePreferences).not.toHaveBeenCalled();
    expect(translationApi.start).not.toHaveBeenCalled();
  });
  it("edits write-only keys and model parameters without advanced options", async () => {
    const user = userEvent.setup();
    wrap(<AiSettingsRows />);
    await user.click(screen.getByRole("button", { name: "Open Model settings" }));
    await screen.findByText("API key configured");
    expect(screen.queryByText("Advanced options")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Custom headers")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("New API key")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Replace" }));
    await user.type(screen.getByLabelText("New API key"), "new-key");
    await user.click(screen.getByRole("button", { name: "Show API key" }));
    expect(screen.getByLabelText("New API key")).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "Add model" }));
    const editor = screen.getByRole("dialog", { name: "Add model" });
    expect(within(editor).getByLabelText("Model ID")).toHaveValue("");
    await user.type(within(editor).getByLabelText("Model ID"), "new-model");
    await user.type(within(editor).getByLabelText("Maximum output"), "4096");
    await user.click(within(editor).getByRole("button", { name: "Confirm" }));
    expect(screen.getByRole("button", { name: "Edit model new-model" })).toBeInTheDocument();
    const enabled = screen.getByRole("switch", { name: "Enable" });
    expect(enabled).toHaveAttribute("aria-checked", "true");
    enabled.focus();
    await user.keyboard(" ");
    expect(enabled).toHaveAttribute("aria-checked", "false");
    await user.keyboard(" ");
    expect(screen.getAllByRole("switch")).toHaveLength(1);
    expect(translationApi.saveProvider).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(translationApi.saveProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: "new-key",
          models: [provider.models[0], { id: "new-model", enabled: true, maxOutputTokens: 4096 }],
        }),
      ),
    );
    await screen.findByText("API key configured");
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByText("API key will be cleared when saved")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
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
    await user.click(screen.getByRole("button", { name: "Open Model settings" }));
    await screen.findByRole("button", { name: "Edit model disabled-model" });
    expect(screen.getAllByRole("switch")).toHaveLength(1);
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.queryByText("Enable", { exact: true })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(translationApi.saveProvider).toHaveBeenCalledWith(
        expect.objectContaining({ models: [disabledModel] }),
      ),
    );
  });

  it("opens a blank add form only from the button and does not submit an IME confirmation", async () => {
    const user = userEvent.setup();
    wrap(<AiSettingsRows />);
    await user.click(screen.getByRole("button", { name: "Open Model settings" }));
    await screen.findByRole("button", { name: "Add model" });
    expect(screen.queryByLabelText("New model ID")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add model" }));
    const dialog = screen.getByRole("dialog", { name: "Add model" });
    const input = within(dialog).getByLabelText("Model ID");
    expect(input).toHaveValue("");
    await user.type(input, "moxing");
    expect(fireEvent.keyDown(input, { key: "Enter", keyCode: 229, isComposing: false })).toBe(
      false,
    );
    expect(fireEvent.keyDown(input, { key: "Enter", isComposing: true })).toBe(false);
    fireEvent.compositionStart(input);
    expect(fireEvent.keyDown(input, { key: "Enter", isComposing: false })).toBe(false);
    fireEvent.compositionEnd(input);
    expect(dialog).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit model moxing" })).not.toBeInTheDocument();
    expect(translationApi.saveProvider).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("dialog", { name: "Add model" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit model moxing" })).toBeInTheDocument();
    expect(translationApi.start).not.toHaveBeenCalled();
  });
});

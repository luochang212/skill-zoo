import "@/i18n";
import { act, fireEvent, render as renderUI, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { toast } from "sonner";
import { translationApi } from "@/lib/api/translation";
import { ModelEditorDialog } from "./ModelEditorDialog";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const render = (element: Parameters<typeof renderUI>[0]) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderUI(element, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
};

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/api/translation", () => ({
  translationApi: { resolveModel: vi.fn(), thinkingControl: vi.fn() },
}));
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const model = { id: "model-a", enabled: true, maxOutputTokens: null, thinking: false };
const props = () => ({
  model,
  protocol: "openai-chat-completions" as const,
  baseUrl: "https://api.example.test/v1/",
  otherModelIds: ["duplicate"],
  returnFocusRef: { current: null },
  onClose: vi.fn(),
  onConfirm: vi.fn(),
});
beforeEach(async () => {
  vi.resetAllMocks();
  await i18n.changeLanguage("en");
  vi.mocked(translationApi.resolveModel).mockResolvedValue(null);
  vi.mocked(translationApi.thinkingControl).mockResolvedValue("providerDefault");
});
const user = () => userEvent.setup();
const tick = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 420));
  });
describe("model configuration editor", () => {
  it("shows fixed thinking as on and disabled without changing the stored preference", async () => {
    vi.mocked(translationApi.thinkingControl).mockResolvedValue("alwaysOn");
    const config = props();
    render(<ModelEditorDialog {...config} />);
    const toggle = screen.getByRole("switch", { name: "Deep thinking" });
    await waitFor(() => expect(toggle).toBeChecked());
    expect(toggle).toBeDisabled();
    await user().click(screen.getByRole("button", { name: "Confirm" }));
    expect(config.onConfirm).toHaveBeenCalledWith(model);
  });

  it("places thinking first, defaults it off and commits only on confirmation", async () => {
    vi.mocked(translationApi.thinkingControl).mockResolvedValue("toggle");
    const config = props();
    const input = user();
    const view = render(<ModelEditorDialog {...config} />);
    const toggle = screen.getByRole("switch", { name: "Deep thinking" });
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).not.toBeChecked();
    expect(
      toggle.compareDocumentPosition(screen.getByLabelText("Model ID")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await input.click(toggle);
    expect(config.onConfirm).not.toHaveBeenCalled();
    await input.click(screen.getByRole("button", { name: "Cancel" }));
    expect(config.onClose).toHaveBeenCalled();
    expect(config.onConfirm).not.toHaveBeenCalled();
    view.unmount();

    render(<ModelEditorDialog {...config} />);
    await waitFor(() => expect(screen.getByRole("switch")).toBeEnabled());
    expect(screen.getByRole("switch")).not.toBeChecked();
    await input.click(screen.getByRole("switch"));
    await input.click(screen.getByRole("button", { name: "Confirm" }));
    expect(config.onConfirm).toHaveBeenCalledWith({ ...model, thinking: true });
  });

  it("keeps unknown and pending models disabled without exposing capability status", async () => {
    const pending = deferred<"toggle" | "alwaysOn" | "providerDefault">();
    vi.mocked(translationApi.thinkingControl).mockReturnValue(pending.promise);
    const config = props();
    const view = render(<ModelEditorDialog {...config} />);
    expect(screen.getByRole("switch")).toBeDisabled();
    view.rerender(<ModelEditorDialog {...config} baseUrl="https://other.test/v1" />);
    vi.mocked(translationApi.thinkingControl).mockResolvedValue("providerDefault");
    await user().type(screen.getByLabelText("Model ID"), "-other");
    await act(async () => pending.resolve("alwaysOn"));
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.getByRole("switch")).not.toBeChecked();
    expect(screen.queryByText(/unsupported|unknown|checking|capability/i)).not.toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("preserves a saved preference when confirming before capability lookup finishes", async () => {
    vi.mocked(translationApi.thinkingControl).mockReturnValue(new Promise(() => {}));
    const config = props();
    render(<ModelEditorDialog {...config} model={{ ...model, thinking: true }} />);
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.getByRole("switch")).toBeChecked();
    await user().click(screen.getByRole("button", { name: "Confirm" }));
    expect(config.onConfirm).toHaveBeenCalledWith({ ...model, thinking: true });
  });

  it("opens with the caret at the end of the model ID without selecting it", async () => {
    render(<ModelEditorDialog {...props()} />);
    const input = screen.getByLabelText("Model ID") as HTMLInputElement;
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(model.id.length);
    expect(input.selectionEnd).toBe(model.id.length);
    await user().keyboard("-suffix");
    expect(input).toHaveValue("model-a-suffix");
  });
  it("restores the stored thinking choice when the edited ID returns to the saved value", async () => {
    vi.mocked(translationApi.thinkingControl).mockResolvedValue("toggle");
    const config = props();
    const input = user();
    render(<ModelEditorDialog {...config} model={{ ...model, thinking: true }} />);
    const toggle = screen.getByRole("switch", { name: "Deep thinking" });
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).toBeChecked();
    const idInput = screen.getByLabelText("Model ID");
    await input.type(idInput, "-suffix");
    expect(toggle).not.toBeChecked();
    await input.type(idInput, "{backspace>7}");
    expect(toggle).toBeChecked();
    expect(config.onConfirm).not.toHaveBeenCalled();
  });
  it("warns that deep thinking slows down translation when enabled", async () => {
    vi.mocked(translationApi.thinkingControl).mockResolvedValue("toggle");
    const input = user();
    render(<ModelEditorDialog {...props()} />);
    const toggle = screen.getByRole("switch", { name: "Deep thinking" });
    await waitFor(() => expect(toggle).toBeEnabled());
    await input.click(toggle);
    expect(toast.info).toHaveBeenCalledWith("Enabling deep thinking slows down translation");
    await input.click(toggle);
    expect(toast.info).toHaveBeenCalledTimes(1);
  });
  it("debounces lookup and preserves manual input made while the recommendation is pending", async () => {
    const request = deferred<{ contextWindow: number; maxOutputTokens: number } | null>();
    vi.mocked(translationApi.resolveModel).mockReturnValue(request.promise);
    const input = user();
    const config = props();
    render(<ModelEditorDialog {...config} />);
    expect(translationApi.resolveModel).not.toHaveBeenCalled();
    await input.keyboard("{Enter}");
    expect(config.onConfirm).not.toHaveBeenCalled();
    await tick();
    expect(translationApi.resolveModel).toHaveBeenCalledWith(config.baseUrl, "model-a");
    await input.type(screen.getByLabelText("Maximum output tokens"), "300");
    await act(async () => {
      request.resolve({ contextWindow: 1000, maxOutputTokens: 200 });
    });
    expect(screen.getByLabelText("Context window")).toHaveValue("");
    expect(screen.getByLabelText("Maximum output tokens")).toHaveValue("300");
    expect(toast.success).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Use recommended values" }),
    ).not.toBeInTheDocument();
    await input.click(screen.getByRole("button", { name: "Confirm" }));
    expect(config.onConfirm).toHaveBeenCalledWith({
      ...model,
      maxOutputTokens: 300,
    });
  });
  it("preserves matched parameters and avoids lookup when only surrounding whitespace changes", async () => {
    vi.mocked(translationApi.resolveModel).mockResolvedValue({
      contextWindow: 1000,
      maxOutputTokens: 200,
    });
    render(<ModelEditorDialog {...props()} />);
    await tick();
    expect(screen.getByLabelText("Context window")).toHaveValue("1000");
    fireEvent.change(screen.getByLabelText("Model ID"), { target: { value: " model-a " } });
    expect(screen.getByLabelText("Context window")).toHaveValue("1000");
    expect(screen.getByLabelText("Maximum output tokens")).toHaveValue("200");
    await tick();
    expect(translationApi.resolveModel).toHaveBeenCalledTimes(1);
  });
  it("waits for IME composition to finish before starting the lookup debounce", async () => {
    render(<ModelEditorDialog {...props()} model={{ ...model, id: "" }} />);
    const field = screen.getByLabelText("Model ID");
    fireEvent.compositionStart(field);
    fireEvent.change(field, { target: { value: "model-a" } });
    await tick();
    expect(translationApi.resolveModel).not.toHaveBeenCalled();
    fireEvent.compositionEnd(field);
    expect(translationApi.resolveModel).not.toHaveBeenCalled();
    await tick();
    expect(translationApi.resolveModel).toHaveBeenCalledTimes(1);
    expect(translationApi.resolveModel).toHaveBeenCalledWith(props().baseUrl, "model-a");
  });
  it("isolates A→B→A results and failures, and ignores a response after close", async () => {
    const old = deferred<null>();
    const middle = deferred<null>();
    const latest = deferred<{ contextWindow: number; maxOutputTokens: number }>();
    vi.mocked(translationApi.resolveModel)
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(middle.promise)
      .mockReturnValueOnce(latest.promise);
    const input = user();
    const config = props();
    const view = render(<ModelEditorDialog {...config} />);
    await tick();
    await input.clear(screen.getByLabelText("Model ID"));
    await input.type(screen.getByLabelText("Model ID"), "model-b");
    await tick();
    await input.clear(screen.getByLabelText("Model ID"));
    await input.type(screen.getByLabelText("Model ID"), "model-a");
    await tick();
    await act(async () => {
      old.resolve(null);
      middle.reject(new Error("old failure"));
    });
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    view.unmount();
    await act(async () => {
      latest.resolve({ contextWindow: 1000, maxOutputTokens: 200 });
    });
    expect(config.onConfirm).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
  it.each([
    { contextWindow: 1200, maxOutputTokens: null },
    { maxOutputTokens: 300 },
    { contextWindow: 1200, maxOutputTokens: 300 },
  ])("skips lookup when either saved limit exists: %j", async (limits) => {
    const input = user();
    const config = { ...props(), model: { ...model, ...limits } };
    render(<ModelEditorDialog {...config} />);
    await tick();
    expect(translationApi.resolveModel).not.toHaveBeenCalled();
    await input.clear(screen.getByLabelText("Model ID"));
    await input.type(screen.getByLabelText("Model ID"), "model-b");
    await tick();
    expect(translationApi.resolveModel).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
  it.each(["missing", "offline"] as const)(
    "silently allows manual editing on %s and still validates user input",
    async (failure) => {
      if (failure === "offline")
        vi.mocked(translationApi.resolveModel).mockRejectedValue(new Error("unavailable"));
      const input = user();
      const config = props();
      render(<ModelEditorDialog {...config} />);
      await tick();
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(
        screen.queryByText("Enter a model ID to look up its configuration."),
      ).not.toBeInTheDocument();
      await input.clear(screen.getByLabelText("Model ID"));
      await input.type(screen.getByLabelText("Model ID"), "duplicate");
      await input.click(screen.getByRole("button", { name: "Confirm" }));
      expect(screen.getByRole("alert")).toHaveTextContent("unique");
      await input.clear(screen.getByLabelText("Model ID"));
      await input.type(screen.getByLabelText("Model ID"), "custom");
      await input.type(screen.getByLabelText("Context window"), "100");
      await input.type(screen.getByLabelText("Maximum output tokens"), "200");
      await input.click(screen.getByRole("button", { name: "Confirm" }));
      expect(config.onConfirm).not.toHaveBeenCalled();
      await input.click(screen.getByRole("button", { name: "Cancel" }));
      expect(config.onClose).toHaveBeenCalled();
      expect(config.onConfirm).not.toHaveBeenCalled();
    },
  );
});

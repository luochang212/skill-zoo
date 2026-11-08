import "@/i18n";
import { act, fireEvent, render as renderUI, screen } from "@testing-library/react";
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
  translationApi: { resolveModel: vi.fn() },
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
const model = { id: "model-a", enabled: true, maxOutputTokens: null };
const props = () => ({
  model,
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
});
const user = () => userEvent.setup();
const tick = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 420));
  });
describe("model configuration editor", () => {
  it("offers no thinking switch and commits model parameters on confirmation", async () => {
    const config = props();
    render(<ModelEditorDialog {...config} />);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByText("Deep thinking")).not.toBeInTheDocument();
    await user().click(screen.getByRole("button", { name: "Confirm" }));
    expect(config.onConfirm).toHaveBeenCalledWith(model);
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
  ])("refreshes inherited limits from a lookup once the ID changes: %j", async (limits) => {
    vi.mocked(translationApi.resolveModel).mockResolvedValue({
      contextWindow: 2000,
      maxOutputTokens: 500,
    });
    const input = user();
    const config = { ...props(), model: { ...model, ...limits } };
    render(<ModelEditorDialog {...config} />);
    await tick();
    // Saved values keep the dialog quiet until the ID itself changes.
    expect(translationApi.resolveModel).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    await input.clear(screen.getByLabelText("Model ID"));
    await input.type(screen.getByLabelText("Model ID"), "model-b");
    await tick();
    expect(translationApi.resolveModel).toHaveBeenCalledWith(config.baseUrl, "model-b");
    expect(screen.getByLabelText("Context window")).toHaveValue("2000");
    expect(screen.getByLabelText("Maximum output tokens")).toHaveValue("500");
    expect(toast.success).toHaveBeenCalled();
  });
  it("keeps inherited limits when the lookup finds nothing for the new ID", async () => {
    vi.mocked(translationApi.resolveModel).mockResolvedValue(null);
    const input = user();
    const config = { ...props(), model: { ...model, contextWindow: 1200, maxOutputTokens: 300 } };
    render(<ModelEditorDialog {...config} />);
    await tick();
    expect(translationApi.resolveModel).not.toHaveBeenCalled();
    await input.clear(screen.getByLabelText("Model ID"));
    await input.type(screen.getByLabelText("Model ID"), "model-b");
    await tick();
    expect(translationApi.resolveModel).toHaveBeenCalledWith(config.baseUrl, "model-b");
    // A fruitless lookup must not wipe the user's saved values.
    expect(screen.getByLabelText("Context window")).toHaveValue("1200");
    expect(screen.getByLabelText("Maximum output tokens")).toHaveValue("300");
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

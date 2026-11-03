import "@/i18n";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { toast } from "sonner";
import { translationApi } from "@/lib/api/translation";
import { ModelEditorDialog } from "./ModelEditorDialog";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api/translation", () => ({ translationApi: { resolveModel: vi.fn() } }));
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
  it("debounces lookup and preserves manual input made while the recommendation is pending", async () => {
    const request = deferred<{ contextWindow: number; maxOutputTokens: number } | null>();
    vi.mocked(translationApi.resolveModel).mockReturnValue(request.promise);
    const input = user();
    const config = props();
    render(<ModelEditorDialog {...config} />);
    expect(translationApi.resolveModel).not.toHaveBeenCalled();
    await tick();
    expect(translationApi.resolveModel).toHaveBeenCalledWith(config.baseUrl, "model-a");
    await input.type(screen.getByLabelText("Maximum output"), "300");
    await act(async () => {
      request.resolve({ contextWindow: 1000, maxOutputTokens: 200 });
    });
    expect(screen.getByLabelText("Context window")).toHaveValue("1000");
    expect(screen.getByLabelText("Maximum output")).toHaveValue("300");
    expect(toast.success).toHaveBeenCalledWith(
      "Model configuration matched",
      expect.objectContaining({ id: expect.any(String) }),
    );
    expect(
      screen.queryByRole("button", { name: "Use recommended values" }),
    ).not.toBeInTheDocument();
    await input.click(screen.getByRole("button", { name: "Confirm" }));
    expect(config.onConfirm).toHaveBeenCalledWith({
      ...model,
      contextWindow: 1000,
      maxOutputTokens: 300,
    });
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
  it("automatically matches without overwriting saved limits or offering a restore button", async () => {
    const input = user();
    const config = { ...props(), model: { ...model, contextWindow: 1200, maxOutputTokens: 300 } };
    vi.mocked(translationApi.resolveModel).mockResolvedValue({
      contextWindow: 2000,
      maxOutputTokens: 500,
    });
    render(<ModelEditorDialog {...config} />);
    await tick();
    expect(screen.getByLabelText("Context window")).toHaveValue("1200");
    expect(screen.getByLabelText("Maximum output")).toHaveValue("300");
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "Use recommended values" }),
    ).not.toBeInTheDocument();
    await input.clear(screen.getByLabelText("Model ID"));
    await input.type(screen.getByLabelText("Model ID"), "model-b");
    await tick();
    expect(screen.getByLabelText("Context window")).toHaveValue("1200");
    expect(screen.getByLabelText("Maximum output")).toHaveValue("300");
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
      await input.type(screen.getByLabelText("Maximum output"), "200");
      await input.click(screen.getByRole("button", { name: "Confirm" }));
      expect(config.onConfirm).not.toHaveBeenCalled();
      await input.click(screen.getByRole("button", { name: "Cancel" }));
      expect(config.onClose).toHaveBeenCalled();
      expect(config.onConfirm).not.toHaveBeenCalled();
    },
  );
});

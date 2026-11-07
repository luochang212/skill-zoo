import "@/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { translationApi, type LlmProvider } from "@/lib/api/translation";
import { ProviderEditor } from "./ModelProvidersSection";

vi.mock("@/lib/api/translation", () => ({
  translationApi: {
    providerApiKey: vi.fn(),
    testConnection: vi.fn(),
  },
}));
const provider: LlmProvider = {
  id: "provider-a",
  name: "Example",
  enabled: true,
  protocol: "openai-chat-completions",
  baseUrl: "https://example.test/v1",
  hasApiKey: true,
  models: [],
};
beforeEach(async () => {
  vi.resetAllMocks();
  await i18n.changeLanguage("en");
  vi.mocked(translationApi.providerApiKey).mockResolvedValue("saved-key-16char");
});
function setup() {
  const onSave = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ProviderEditor
        provider={provider}
        formId="provider-form"
        headerActions={<span />}
        error={null}
        onSave={onSave}
      />
    </QueryClientProvider>,
  );
  return { ...view, onSave };
}
it("loads the saved key, allows viewing and editing, and clears only on save", async () => {
  const { container, onSave } = setup();
  const input = screen.getByLabelText("API key");
  await waitFor(() => expect(input).toHaveValue("saved-key-16char"));
  expect(input).toHaveAttribute("type", "password");
  await userEvent.click(screen.getByRole("button", { name: "Show API key" }));
  expect(input).toHaveAttribute("type", "text");
  expect(onSave).not.toHaveBeenCalled();
  fireEvent.submit(container.querySelector("form")!);
  expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: null }));
  await userEvent.clear(input);
  await userEvent.type(input, "replacement");
  fireEvent.submit(container.querySelector("form")!);
  expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: "replacement" }));
  await userEvent.clear(input);
  expect(input).toHaveValue("");
  expect(onSave).toHaveBeenCalledTimes(2);
  fireEvent.submit(container.querySelector("form")!);
  expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: "" }));
  expect(translationApi.testConnection).not.toHaveBeenCalled();
});
it("does not save an empty replacement when reading the saved key fails", async () => {
  vi.mocked(translationApi.providerApiKey).mockRejectedValue(new Error("configRead"));
  const { container, onSave } = setup();
  await screen.findByRole("status");
  expect(screen.getByLabelText("API key")).toBeDisabled();
  fireEvent.submit(container.querySelector("form")!);
  expect(onSave).not.toHaveBeenCalled();
});

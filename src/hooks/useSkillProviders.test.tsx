import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { translationApi, type ProviderUpdate } from "@/lib/api/translation";
import { useSaveSkillProvider } from "./useSkillProviders";

vi.mock("@/lib/api/translation", () => ({ translationApi: { saveProvider: vi.fn() } }));
beforeEach(() => vi.resetAllMocks());
it.each(["replacement-key", ""])(
  "keeps the saved key %j in cache even if an older read finishes later",
  async (apiKey) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryKey = ["llmProviderApiKey", "p"];
    client.setQueryData(queryKey, "old-key");
    let resolveRead!: (value: string) => void;
    const pending = client
      .fetchQuery({
        queryKey,
        queryFn: () =>
          new Promise<string>((resolve) => {
            resolveRead = resolve;
          }),
      })
      .catch(() => undefined);
    vi.mocked(translationApi.saveProvider).mockResolvedValue([]);
    const { result } = renderHook(() => useSaveSkillProvider(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    const update: ProviderUpdate = {
      id: "p",
      name: "Example",
      enabled: true,
      protocol: "openai-chat-completions",
      baseUrl: "https://example.test/v1/",
      apiKey,
      models: [],
    };
    await act(async () => {
      await result.current.mutateAsync(update);
    });
    resolveRead("old-key");
    await pending;
    expect(client.getQueryData(queryKey)).toBe(apiKey);
    client.clear();
  },
);

import "@/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { useSaveGitHubToken } from "./useSettings";
import { useRepoMetadata, useRepoReadme, useSearchRepo } from "./useSkills";

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: 2 }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "verify_github_token") return { authenticated: true, limit: 5000 };
    if (command === "save_github_credentials") return;
    if (command === "get_repo_metadata") return { owner: "o", name: "r", stars: 42 };
    if (command === "get_repo_readme") return "recovered README";
    if (command === "search_repo") return { owner: "o", name: "r", stars: 42 };
    throw new Error(`Unexpected command: ${command}`);
  });
  return { client, wrapper };
}

describe("GitHub credential recovery", () => {
  it("refreshes active degraded reads and marks inactive reads stale, preserving unrelated caches", async () => {
    const { client, wrapper } = setup();
    client.setQueryData(["repos", "metadata", "o", "r"], { stars: 1 });
    client.setQueryData(["repos", "readme", "o", "r", undefined], "stale README");
    client.setQueryData(["repos", "search", "o/r"], { owner: "o", name: "r" });
    client.setQueryData(["repos", "metadata", "other", "repo"], { stars: 2 });
    client.setQueryData(["repos", "skills", "o", "r"], ["installed"]);
    client.setQueryData(["skills.sh", "search", "test"], ["result"]);
    const { result } = renderHook(
      () => ({
        save: useSaveGitHubToken(),
        metadata: useRepoMetadata("o", "r"),
        readme: useRepoReadme("o", "r"),
        search: useSearchRepo("o/r"),
      }),
      { wrapper },
    );
    await act(async () => {
      await result.current.save.mutateAsync("new-token");
    });
    await waitFor(() => expect(result.current.metadata.data?.stars).toBe(42));
    expect(result.current.readme.data).toBe("recovered README");
    expect(result.current.search.data?.stars).toBe(42);
    expect(client.getQueryState(["repos", "metadata", "other", "repo"])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["repos", "skills", "o", "r"])?.isInvalidated).toBe(false);
    expect(client.getQueryState(["skills.sh", "search", "test"])?.isInvalidated).toBe(false);
    expect(
      vi.mocked(invoke).mock.calls.filter(([command]) => command === "get_repo_metadata"),
    ).toHaveLength(1);
  });

  it("ignores results from obsolete in-flight requests", async () => {
    const { client, wrapper } = setup();
    let finishOld!: (value: unknown) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    );
    const { result } = renderHook(
      () => ({ save: useSaveGitHubToken(), metadata: useRepoMetadata("o", "r") }),
      { wrapper },
    );
    await waitFor(() => expect(finishOld).toBeDefined());
    await act(async () => {
      await result.current.save.mutateAsync("new-token");
    });
    await act(async () => {
      finishOld({ stars: 1 });
    });
    await waitFor(() => expect(result.current.metadata.data?.stars).toBe(42));
    client.clear();
  });

  it("recovers an errored active query after a successful save", async () => {
    const { client, wrapper } = setup();
    vi.mocked(invoke).mockRejectedValueOnce({ code: "rateLimited" });
    const { result } = renderHook(
      () => ({ save: useSaveGitHubToken(), metadata: useRepoMetadata("o", "r") }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.metadata.isError).toBe(true));
    await act(async () => {
      await result.current.save.mutateAsync("new-token");
    });
    await waitFor(() => expect(result.current.metadata.data?.stars).toBe(42));
    expect(result.current.metadata.isError).toBe(false);
    client.clear();
  });

  it.each(["metadata", "readme", "search"])(
    "does not automatically retry a failed %s API read",
    async (kind) => {
      const { client, wrapper } = setup();
      vi.mocked(invoke).mockRejectedValue({ code: "rateLimited" });
      const { result } = renderHook(
        () => {
          const metadata = useRepoMetadata(kind === "metadata" ? "o" : null, "r");
          const readme = useRepoReadme(kind === "readme" ? "o" : null, "r");
          const search = useSearchRepo(kind === "search" ? "o/r" : null);
          return { metadata, readme, search }[kind as "metadata" | "readme" | "search"];
        },
        { wrapper },
      );
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(invoke).toHaveBeenCalledTimes(1);
      client.clear();
    },
  );

  it.each(["verify_github_token", "save_github_credentials"])(
    "leaves reads unchanged when %s fails",
    async (failedCommand) => {
      const { client, wrapper } = setup();
      client.setQueryData(["repos", "metadata", "o", "r"], { stars: 1 });
      vi.mocked(invoke).mockImplementation(async (command) => {
        if (command === failedCommand) throw new Error("unavailable");
        return { authenticated: true, limit: 5000 };
      });
      const { result } = renderHook(() => useSaveGitHubToken(), { wrapper });
      await act(async () => {
        await expect(result.current.mutateAsync("new-token")).rejects.toThrow();
      });
      expect(client.getQueryState(["repos", "metadata", "o", "r"])?.isInvalidated).toBe(false);
      expect(client.getQueryData(["repos", "metadata", "o", "r"])).toEqual({ stars: 1 });
    },
  );
});

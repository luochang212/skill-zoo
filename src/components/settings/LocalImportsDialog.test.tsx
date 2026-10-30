import "@/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import type { ExternalImportInfo } from "@/types/skills";
import { LocalImportsDialog } from "./LocalImportsDialog";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const entry: ExternalImportInfo = {
  id: "import-1",
  sourcePath: "/Users/demo/skills/demo",
  directory: "demo",
  name: "Demo",
  status: "valid",
  linkedAgents: ["claude-code"],
  importedAt: 0,
  updatedAt: 0,
};

function mockImports() {
  vi.mocked(invoke).mockImplementation((command) => {
    switch (command) {
      case "list_external_imports":
        return Promise.resolve([entry]);
      case "get_agent_configs":
        return Promise.resolve([]);
      case "get_visible_agents":
        return Promise.resolve({});
      case "get_settings":
        return Promise.resolve({});
      default:
        return Promise.resolve(undefined);
    }
  });
}

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <LocalImportsDialog open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

async function openManageTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Manage (1)" }));
  await screen.findByText("Demo");
}

describe("LocalImportsDialog removal", () => {
  beforeEach(async () => {
    vi.mocked(invoke).mockReset();
    await i18n.changeLanguage("en");
  });

  it("requires confirmation before removing an import", async () => {
    mockImports();
    const user = userEvent.setup();
    renderDialog();
    await openManageTab(user);

    await user.click(screen.getByRole("button", { name: "Remove import" }));

    const confirm = await screen.findByRole("dialog", { name: "Remove import" });
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("remove_external_import", expect.anything());

    await user.click(within(confirm).getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("remove_external_import", {
        importId: "import-1",
      }),
    );
  });

  it("leaves the import alone when the confirmation is cancelled", async () => {
    mockImports();
    const user = userEvent.setup();
    renderDialog();
    await openManageTab(user);

    await user.click(screen.getByRole("button", { name: "Remove import" }));
    const confirm = await screen.findByRole("dialog", { name: "Remove import" });
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Remove import" })).not.toBeInTheDocument(),
    );
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("remove_external_import", expect.anything());
  });
});

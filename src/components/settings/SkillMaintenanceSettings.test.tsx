import "@/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { SkillMaintenanceSettings } from "./SkillMaintenanceSettings";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

function renderSettings() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <SkillMaintenanceSettings />
    </QueryClientProvider>,
  );
}

describe("SkillMaintenanceSettings", () => {
  beforeEach(async () => {
    vi.mocked(invoke).mockReset();
    vi.mocked(toast.error).mockReset();
    await i18n.changeLanguage("en");
    vi.mocked(invoke).mockImplementation((command) => {
      switch (command) {
        case "get_installed_skills":
          return Promise.resolve([]);
        case "get_settings":
          return Promise.resolve({});
        case "get_cache_size":
          return Promise.resolve(1024);
        case "clear_download_cache":
          return Promise.reject(new Error("clear failed"));
        default:
          return Promise.reject(new Error(`Unexpected command: ${command}`));
      }
    });
  });

  it("recovers the clear-cache button after clearing fails", async () => {
    const user = userEvent.setup();
    renderSettings();

    const button = await screen.findByRole("button", { name: /clear cache/i });
    await user.click(button);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not clear download cache"));
    expect(button).toBeEnabled();
  });
});

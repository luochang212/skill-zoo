import "@/i18n";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppUpdaterProvider } from "@/hooks/useAppUpdater";
import { AboutSection } from "./AboutSection";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function renderAboutSection() {
  return render(
    <AppUpdaterProvider>
      <AboutSection />
    </AppUpdaterProvider>,
  );
}

describe("AboutSection feedback buttons", () => {
  beforeEach(() => {
    vi.mocked(getVersion).mockResolvedValue("0.4.8");
    vi.mocked(check).mockResolvedValue(null);
    vi.mocked(toast.error).mockClear();
    window.open = vi.fn();
  });

  it("opens the issue template without toasting when the opener succeeds", async () => {
    vi.mocked(openUrl).mockResolvedValue(undefined);
    renderAboutSection();

    await userEvent.click(screen.getByRole("button", { name: /report a bug/i }));

    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledWith(expect.stringContaining("template=bug_report.md"));
    expect(toast.error).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });

  it("shows exactly one error and never calls window.open when the opener fails", async () => {
    vi.mocked(openUrl).mockRejectedValue(new Error("opener unavailable"));
    renderAboutSection();

    await userEvent.click(screen.getByRole("button", { name: /report a bug/i }));

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(window.open).not.toHaveBeenCalled();
  });
});

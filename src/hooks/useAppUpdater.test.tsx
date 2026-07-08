import "@/i18n";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import type { Update } from "@tauri-apps/plugin-updater";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { AppUpdaterProvider, useAppUpdater } from "./useAppUpdater";

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function createUpdate(downloadAndInstall: Update["downloadAndInstall"]): Update {
  return {
    available: true,
    currentVersion: "0.2.8",
    version: "0.2.9",
    rawJson: {},
    downloadAndInstall,
  } as Update;
}

function Probe() {
  const updater = useAppUpdater();

  return (
    <div>
      <span>{updater.status}</span>
      <button onClick={updater.checkAndDownload}>check</button>
    </div>
  );
}

function renderProbe() {
  return render(
    <AppUpdaterProvider>
      <Probe />
    </AppUpdaterProvider>,
  );
}

describe("useAppUpdater", () => {
  beforeEach(async () => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(false);
    vi.mocked(check).mockReset();
    await i18n.changeLanguage("en");
  });

  it("does not check for updates on portable builds", async () => {
    vi.mocked(invoke).mockResolvedValue(true);

    renderProbe();

    expect(await screen.findByText("unsupported")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /check/i }));

    expect(check).not.toHaveBeenCalled();
  });

  it("ignores repeated check requests while a download is running", async () => {
    const user = userEvent.setup();
    const downloadAndInstall = vi.fn<Update["downloadAndInstall"]>(() => new Promise(() => {}));
    vi.mocked(check).mockResolvedValue(createUpdate(downloadAndInstall));

    renderProbe();

    await screen.findByText("idle");
    const button = screen.getByRole("button", { name: /check/i });
    await user.click(button);
    await user.click(button);

    await waitFor(() => expect(downloadAndInstall).toHaveBeenCalledTimes(1));
    expect(check).toHaveBeenCalledTimes(1);
  });
});

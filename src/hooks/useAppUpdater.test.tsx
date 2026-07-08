import "@/i18n";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import type { Update } from "@tauri-apps/plugin-updater";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { AppUpdaterProvider, useAppUpdater } from "./useAppUpdater";

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(),
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
      <span data-testid="version">{updater.version}</span>
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
    vi.mocked(getVersion).mockReset();
    vi.mocked(getVersion).mockResolvedValue("0.2.8");
    vi.mocked(check).mockReset();
    localStorage.clear();
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

  it("keeps a cached update visible when background revalidation fails", async () => {
    localStorage.setItem("skill-zoo.lastKnownUpdateVersion", "0.2.9");
    vi.mocked(check).mockRejectedValue(new Error("offline"));

    renderProbe();

    expect(await screen.findByText("available")).toBeInTheDocument();
    expect(screen.getByTestId("version")).toHaveTextContent("0.2.9");
    await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
  });

  it("clears a cached update when background revalidation finds no update", async () => {
    localStorage.setItem("skill-zoo.lastKnownUpdateVersion", "0.2.9");
    vi.mocked(check).mockResolvedValue(null);

    renderProbe();

    expect(await screen.findByText("idle")).toBeInTheDocument();
    expect(localStorage.getItem("skill-zoo.lastKnownUpdateVersion")).toBeNull();
  });

  it("clears the cached update when the current app is already on that version", async () => {
    localStorage.setItem("skill-zoo.lastKnownUpdateVersion", "0.2.9");
    vi.mocked(getVersion).mockResolvedValue("0.2.9");

    renderProbe();

    expect(await screen.findByText("idle")).toBeInTheDocument();
    expect(localStorage.getItem("skill-zoo.lastKnownUpdateVersion")).toBeNull();
  });

  it("checks again before downloading a cached update", async () => {
    const user = userEvent.setup();
    const downloadAndInstall = vi.fn<Update["downloadAndInstall"]>().mockResolvedValue(undefined);
    localStorage.setItem("skill-zoo.lastKnownUpdateVersion", "0.2.9");
    vi.mocked(check).mockResolvedValue(createUpdate(downloadAndInstall));

    renderProbe();

    await screen.findByText("available");
    await user.click(screen.getByRole("button", { name: /check/i }));

    await waitFor(() => expect(downloadAndInstall).toHaveBeenCalledTimes(1));
    expect(check).toHaveBeenCalledTimes(1);
  });
});

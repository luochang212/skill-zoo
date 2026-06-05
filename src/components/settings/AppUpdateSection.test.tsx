import "@/i18n";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { AppUpdateSection } from "./AppUpdateSection";

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn(),
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

type DownloadHandler = (event: DownloadEvent) => void;

function createUpdate(downloadAndInstall: Update["downloadAndInstall"]): Update {
  return {
    available: true,
    currentVersion: "0.2.8",
    version: "0.2.9",
    rawJson: {},
    downloadAndInstall,
  } as Update;
}

function createDeferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("AppUpdateSection", () => {
  beforeEach(async () => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(false);
    vi.mocked(check).mockReset();
    vi.mocked(relaunch).mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    await i18n.changeLanguage("en");
  });

  it("automatically downloads a discovered update and waits for restart confirmation", async () => {
    const user = userEvent.setup();
    const downloadAndInstall = vi.fn<Update["downloadAndInstall"]>(async (onEvent) => {
      onEvent?.({ event: "Finished" });
    });
    vi.mocked(check).mockResolvedValue(createUpdate(downloadAndInstall));

    render(<AppUpdateSection />);

    await user.click(await screen.findByRole("button", { name: /check for updates/i }));

    await waitFor(() => expect(downloadAndInstall).toHaveBeenCalledTimes(1));
    await user.click(await screen.findByRole("button", { name: /restart now/i }));

    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it("shows the target version and cumulative progress while downloading", async () => {
    const user = userEvent.setup();
    const deferred = createDeferred();
    let emitDownloadEvent: DownloadHandler | undefined;
    const downloadAndInstall = vi.fn<Update["downloadAndInstall"]>((onEvent) => {
      emitDownloadEvent = onEvent;
      return deferred.promise;
    });
    vi.mocked(check).mockResolvedValue(createUpdate(downloadAndInstall));

    render(<AppUpdateSection />);

    await user.click(await screen.findByRole("button", { name: /check for updates/i }));
    await waitFor(() => expect(downloadAndInstall).toHaveBeenCalledTimes(1));

    act(() => {
      emitDownloadEvent?.({ event: "Progress", data: { chunkLength: 1536 } });
    });

    expect(await screen.findByText("v0.2.9 Downloading... (2 KB)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /downloading/i })).toBeDisabled();

    await act(async () => {
      emitDownloadEvent?.({ event: "Finished" });
      deferred.resolve();
      await deferred.promise;
    });
  });

  it("lets the user retry the same update download after an automatic download failure", async () => {
    const user = userEvent.setup();
    const downloadAndInstall = vi
      .fn<Update["downloadAndInstall"]>()
      .mockRejectedValueOnce(new Error("download failed"))
      .mockResolvedValueOnce(undefined);
    vi.mocked(check).mockResolvedValue(createUpdate(downloadAndInstall));

    render(<AppUpdateSection />);

    await user.click(await screen.findByRole("button", { name: /check for updates/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Download failed"));
    await user.click(await screen.findByRole("button", { name: /update now/i }));

    await waitFor(() => expect(downloadAndInstall).toHaveBeenCalledTimes(2));
    expect(check).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: /restart now/i })).toBeInTheDocument();
  });

  it("returns to idle and notifies when the app is up to date", async () => {
    const user = userEvent.setup();
    vi.mocked(check).mockResolvedValue(null);

    render(<AppUpdateSection />);

    await user.click(await screen.findByRole("button", { name: /check for updates/i }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Skill Zoo is up to date"));
    expect(await screen.findByRole("button", { name: /check for updates/i })).toBeInTheDocument();
  });

  it("returns to idle and notifies when checking fails", async () => {
    const user = userEvent.setup();
    vi.mocked(check).mockRejectedValue(new Error("check failed"));

    render(<AppUpdateSection />);

    await user.click(await screen.findByRole("button", { name: /check for updates/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not check for updates"));
    expect(await screen.findByRole("button", { name: /check for updates/i })).toBeInTheDocument();
  });

  it("hides update controls for portable builds", async () => {
    vi.mocked(invoke).mockResolvedValue(true);

    render(<AppUpdateSection />);

    expect(await screen.findByRole("button", { name: /official site/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /github/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /check for updates/i })).not.toBeInTheDocument();
  });
});

import "@/i18n";
import { useState } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { AppUpdaterProvider } from "@/hooks/useAppUpdater";
import { APP_UPDATE_SECTION_ID, AppUpdateShortcut } from "./AppUpdateShortcut";
import { AppUpdateSection } from "./AppUpdateSection";

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(),
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

function renderAppUpdateSection() {
  return render(
    <AppUpdaterProvider>
      <AppUpdateSection />
    </AppUpdaterProvider>,
  );
}

function renderAppUpdateShortcut() {
  return render(
    <AppUpdaterProvider>
      <div id={APP_UPDATE_SECTION_ID}>update target</div>
      <AppUpdateShortcut />
    </AppUpdaterProvider>,
  );
}

function ToggleableAppUpdateSection() {
  const [show, setShow] = useState(true);

  return (
    <AppUpdaterProvider>
      <button onClick={() => setShow((value) => !value)}>toggle updater</button>
      {show && <AppUpdateSection />}
    </AppUpdaterProvider>
  );
}

describe("AppUpdateSection", () => {
  beforeEach(async () => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(false);
    vi.mocked(getVersion).mockReset();
    vi.mocked(getVersion).mockResolvedValue("0.2.8");
    vi.mocked(check).mockReset();
    vi.mocked(relaunch).mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    Element.prototype.scrollIntoView = vi.fn();
    localStorage.clear();
    await i18n.changeLanguage("en");
  });

  it("shows the settings shortcut only after an update is found", async () => {
    const user = userEvent.setup();
    const downloadAndInstall = vi.fn<Update["downloadAndInstall"]>().mockResolvedValue(undefined);
    vi.mocked(check).mockResolvedValue(createUpdate(downloadAndInstall));

    renderAppUpdateShortcut();

    expect(screen.queryByRole("button", { name: /^update$/i })).not.toBeInTheDocument();
    await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    await user.click(await screen.findByRole("button", { name: /^update$/i }));

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
    await waitFor(() => expect(downloadAndInstall).toHaveBeenCalledTimes(1));
  });

  it("automatically downloads a discovered update and waits for restart confirmation", async () => {
    const user = userEvent.setup();
    const downloadAndInstall = vi.fn<Update["downloadAndInstall"]>(async (onEvent) => {
      onEvent?.({ event: "Finished" });
    });
    vi.mocked(check).mockResolvedValue(createUpdate(downloadAndInstall));

    renderAppUpdateSection();

    await user.click(await screen.findByRole("button", { name: /check for updates/i }));

    await waitFor(() => expect(downloadAndInstall).toHaveBeenCalledTimes(1));
    await user.click(await screen.findByRole("button", { name: /restart now/i }));

    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it("notifies when restarting the app fails", async () => {
    const user = userEvent.setup();
    const downloadAndInstall = vi.fn<Update["downloadAndInstall"]>().mockResolvedValue(undefined);
    vi.mocked(check).mockResolvedValue(createUpdate(downloadAndInstall));
    vi.mocked(relaunch).mockRejectedValue(new Error("restart failed"));

    renderAppUpdateSection();

    await user.click(await screen.findByRole("button", { name: /check for updates/i }));
    await user.click(await screen.findByRole("button", { name: /restart now/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not restart the app"));
    expect(screen.getByRole("button", { name: /restart now/i })).toBeInTheDocument();
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

    renderAppUpdateSection();

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

    renderAppUpdateSection();

    await user.click(await screen.findByRole("button", { name: /check for updates/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Download failed"));
    expect(screen.getByText("v0.2.9")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /update now/i }));

    await waitFor(() => expect(downloadAndInstall).toHaveBeenCalledTimes(2));
    expect(check).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: /restart now/i })).toBeInTheDocument();
  });

  it("returns to idle and notifies when the app is up to date", async () => {
    const user = userEvent.setup();
    vi.mocked(check).mockResolvedValue(null);

    renderAppUpdateSection();

    await user.click(await screen.findByRole("button", { name: /check for updates/i }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Skill Zoo is up to date"));
    expect(await screen.findByRole("button", { name: /check for updates/i })).toBeInTheDocument();
  });

  it("returns to idle and notifies when checking fails", async () => {
    const user = userEvent.setup();
    vi.mocked(check).mockRejectedValue(new Error("check failed"));

    renderAppUpdateSection();

    await user.click(await screen.findByRole("button", { name: /check for updates/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not check for updates"));
    expect(await screen.findByRole("button", { name: /check for updates/i })).toBeInTheDocument();
  });

  it("hides update controls for portable builds", async () => {
    vi.mocked(invoke).mockResolvedValue(true);

    renderAppUpdateSection();

    expect(await screen.findByRole("button", { name: /official site/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /github/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /check for updates/i })).not.toBeInTheDocument();
  });

  it("keeps downloading after the settings section unmounts", async () => {
    const user = userEvent.setup();
    const deferred = createDeferred();
    let emitDownloadEvent: DownloadHandler | undefined;
    const downloadAndInstall = vi.fn<Update["downloadAndInstall"]>((onEvent) => {
      emitDownloadEvent = onEvent;
      return deferred.promise;
    });
    vi.mocked(check).mockResolvedValue(createUpdate(downloadAndInstall));

    render(<ToggleableAppUpdateSection />);

    await user.click(await screen.findByRole("button", { name: /check for updates/i }));
    await waitFor(() => expect(downloadAndInstall).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: /toggle updater/i }));

    await act(async () => {
      emitDownloadEvent?.({ event: "Progress", data: { chunkLength: 1536 } });
      emitDownloadEvent?.({ event: "Finished" });
      deferred.resolve();
      await deferred.promise;
    });

    await user.click(screen.getByRole("button", { name: /toggle updater/i }));

    expect(await screen.findByRole("button", { name: /restart now/i })).toBeInTheDocument();
  });
});

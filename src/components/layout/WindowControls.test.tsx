import "@/i18n";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { Header } from "./Header";
import { WindowControls } from "./WindowControls";

const win = vi.hoisted(() => ({
  isMaximized: vi.fn(),
  onResized: vi.fn(),
  minimize: vi.fn(),
  toggleMaximize: vi.fn(),
  close: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => win,
}));

const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36";
const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15";

function stubUserAgent(value: string) {
  Object.defineProperty(window.navigator, "userAgent", { value, configurable: true });
}

function restoreUserAgent() {
  delete (window.navigator as { userAgent?: string }).userAgent;
}

function windowResizeHandler(): () => void {
  const handler = win.onResized.mock.calls.at(-1)?.[0];
  if (!handler) throw new Error("onResized was not subscribed");
  return () => void handler();
}

beforeEach(() => {
  vi.resetAllMocks();
  win.onResized.mockResolvedValue(() => {});
});

afterEach(restoreUserAgent);

it("renders nothing outside Windows", () => {
  stubUserAgent(MAC_UA);
  const { container } = render(<WindowControls />);
  expect(container).toBeEmptyDOMElement();
  expect(win.isMaximized).not.toHaveBeenCalled();
});

it("starts with the maximize icon and toggles on click", async () => {
  stubUserAgent(WINDOWS_UA);
  win.isMaximized.mockResolvedValue(false);
  render(<WindowControls />);

  const maximize = await screen.findByRole("button", { name: "Maximize" });
  await userEvent.click(maximize);
  expect(win.toggleMaximize).toHaveBeenCalled();
});

it("shows the restore icon while maximized", async () => {
  stubUserAgent(WINDOWS_UA);
  win.isMaximized.mockResolvedValue(true);
  render(<WindowControls />);

  await screen.findByRole("button", { name: "Restore" });
});

it("follows resize events to switch between maximize and restore", async () => {
  stubUserAgent(WINDOWS_UA);
  let maximized = false;
  win.isMaximized.mockImplementation(() => Promise.resolve(maximized));
  render(<WindowControls />);

  await screen.findByRole("button", { name: "Maximize" });
  maximized = true;
  await act(async () => windowResizeHandler()());
  await screen.findByRole("button", { name: "Restore" });

  maximized = false;
  await act(async () => windowResizeHandler()());
  await screen.findByRole("button", { name: "Maximize" });
});

it("minimizes and closes through the window API", async () => {
  stubUserAgent(WINDOWS_UA);
  win.isMaximized.mockResolvedValue(false);
  render(<WindowControls />);

  await userEvent.click(await screen.findByRole("button", { name: "Minimize" }));
  await userEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(win.minimize).toHaveBeenCalled();
  expect(win.close).toHaveBeenCalled();
});

it.each([false, true])(
  "shares the top-right row with header actions (hideTabs=%s)",
  async (hideTabs) => {
    stubUserAgent(WINDOWS_UA);
    render(
      <Header
        view="local"
        onViewChange={() => {}}
        hideTabs={hideTabs}
        actions={<button>tasks</button>}
      />,
    );

    const row = (await screen.findByRole("button", { name: "Close" })).parentElement!
      .parentElement!;
    expect(row).toHaveClass("self-stretch", "items-start", "-mr-5");
    expect(screen.getByRole("button", { name: "tasks" }).parentElement).toBe(row);
  },
);

it("centers header actions outside Windows", () => {
  stubUserAgent(MAC_UA);
  render(<Header view="local" onViewChange={() => {}} actions={<button>tasks</button>} />);

  expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  expect(screen.getByRole("button", { name: "tasks" }).parentElement).toHaveClass(
    "self-stretch",
    "items-center",
  );
});

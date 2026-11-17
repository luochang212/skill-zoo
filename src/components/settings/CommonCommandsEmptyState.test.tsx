import "@/i18n";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { animate } from "framer-motion";
import i18n from "@/i18n";
import { CommonCommandsEmptyState } from "./CommonCommandsEmptyState";

const animation = vi.hoisted(() => ({
  pause: vi.fn(),
  play: vi.fn(),
  stop: vi.fn(),
  reduced: false,
}));
vi.mock("@/hooks/useReducedMotion", () => ({
  useReducedMotion: () => animation.reduced,
}));
vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("framer-motion")>()),
  animate: vi.fn(() => animation),
}));

function advance(time: number) {
  const options = vi.mocked(animate).mock.calls.at(-1)?.[2] as {
    onUpdate: (time: number) => void;
  };
  act(() => options.onUpdate(time));
}

describe("CommonCommandsEmptyState", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    animation.reduced = false;
    await i18n.changeLanguage("en");
  });
  afterEach(cleanup);

  it("adds only the SVG to the blank area, with no HTML copy or buttons", () => {
    const { container } = render(<CommonCommandsEmptyState />);
    expect(screen.getByRole("img")).toBeInTheDocument();
    expect(container.querySelector("button, p, h3")).toBeNull();
    expect(container.textContent).not.toContain("Save once. Use whenever.");
  });

  it("types, saves, opens the tray submenu, copies and pastes in the same desktop", () => {
    render(<CommonCommandsEmptyState />);
    advance(1);
    expect(screen.getByText("Plan first, t")).toBeInTheDocument();
    advance(2.8);
    expect(screen.getAllByText("Plan first, then make changes.")).toHaveLength(2);
    advance(4);
    const submenu = screen.getByText("Plan first, then make changes.", {
      selector: "text[x='70']",
    }).parentElement!;
    expect(submenu).toHaveAttribute("opacity", "0");
    advance(5.5);
    expect(submenu).toHaveAttribute("opacity", "1");
    advance(6.7);
    expect(screen.getByText("Copied to clipboard").parentElement).toHaveAttribute("opacity", "1");
    advance(7.99);
    expect(screen.getByText("Copied to clipboard").parentElement).toHaveAttribute("opacity", "1");
    advance(8);
    expect(screen.getByText("Copied to clipboard").parentElement).toHaveAttribute("opacity", "0");
    advance(9.5);
    expect(screen.getByText("Codex", { selector: "text[x='280']" })).toBeInTheDocument();
    expect(screen.getAllByText("Plan first, then make changes.")).toHaveLength(3);
    advance(0);
    expect(screen.getByText("Ask Codex…")).toBeInTheDocument();
  });

  it("shows the command manager as a modal over the branded app, then closes it before opening the tray", () => {
    const { container } = render(<CommonCommandsEmptyState />);
    const app = container.querySelector('[data-scene="skill-zoo"]')!;
    const dialog = app.querySelector('[data-scene="command-dialog"]')!;
    expect(dialog).toHaveAttribute("opacity", "1");
    expect(screen.getByText("Discover")).toBeInTheDocument();
    expect(screen.getByText("Local")).toBeInTheDocument();
    expect(
      screen.getByText("Skill Zoo", { selector: "text[font-style='italic']" }),
    ).toHaveAttribute("fill", expect.stringContaining("url(#"));
    advance(3.5);
    expect(dialog).toHaveAttribute("opacity", "0");
    expect(app).toHaveAttribute("opacity", "1");
    advance(5.5);
    expect(screen.getByText("Open main window")).toBeInTheDocument();
    expect(screen.getByText("Recently Used")).toBeInTheDocument();
    expect(screen.getByText("Click an item to copy")).toBeInTheDocument();
    expect(container.querySelector("image")).toHaveAttribute(
      "href",
      expect.stringContaining("tray-template.png"),
    );
  });

  it("uses the menu bar selection without a click ring over the tray icon", () => {
    const { container } = render(<CommonCommandsEmptyState />);
    advance(3.85);
    const cursor = container.querySelector('[data-scene="cursor"]')!;
    expect(cursor.querySelector("circle")).toBeNull();
    expect(container.querySelector("image")!.previousElementSibling).toHaveClass(
      "fill-foreground/10",
    );
    advance(4.2);
    expect(container.querySelector('[data-scene="tray-menu"]')).toHaveAttribute("opacity", "1");
    advance(6.4);
    expect(container.querySelector("image")!.previousElementSibling).toHaveClass(
      "fill-transparent",
    );
  });

  it("highlights Common Commands after the cursor arrives, before opening its submenu", () => {
    const { container } = render(<CommonCommandsEmptyState />);
    const menu = container.querySelector('[data-scene="tray-menu"]')!;
    const label = menu.querySelector("text[y='116']")!;
    const submenu = menu.querySelector("g")!;
    advance(4.3);
    expect(label).toHaveClass("fill-foreground");
    advance(4.7);
    expect(label).toHaveClass("fill-foreground");
    advance(4.8);
    expect(label).toHaveClass("fill-background");
    expect(submenu).toHaveAttribute("opacity", "0");
    advance(5.3);
    expect(submenu).toHaveAttribute("opacity", "1");
  });

  it("aligns save feedback with the click and dismisses the menu after copying", () => {
    const { container } = render(<CommonCommandsEmptyState />);
    const dialog = container.querySelector('[data-scene="command-dialog"]')!;
    const cursor = container.querySelector('[data-scene="cursor"]')!;
    const menu = container.querySelector('[data-scene="tray-menu"]')!;
    advance(2.6);
    expect(dialog.querySelector(".lucide-check")).toBeInTheDocument();
    expect(cursor.querySelector("circle")).toBeNull();
    advance(2.7);
    expect(dialog.querySelector(".lucide-check")).toBeNull();
    expect(dialog.querySelector(".lucide-pen-line")).toBeInTheDocument();
    expect(cursor.querySelector("circle")).toBeInTheDocument();
    advance(6);
    expect(menu).toHaveAttribute("opacity", "1");
    expect(cursor.querySelector("circle")).toBeInTheDocument();
    advance(6.4);
    expect(menu).toHaveAttribute("opacity", "0");
    expect(screen.getByText("Copied to clipboard").parentElement).toHaveAttribute("opacity", "1");
  });

  it("shows the paste shortcut with the pasted phrase, then clears the shortcut", () => {
    const { container } = render(<CommonCommandsEmptyState />);
    const shortcut = container.querySelector('[data-scene="paste-shortcut"]')!;
    advance(8.8);
    expect(shortcut).toHaveAttribute("opacity", "0");
    expect(screen.getByText("Ask Codex…")).toBeInTheDocument();
    advance(9);
    expect(shortcut).toHaveAttribute("opacity", "1");
    expect(
      screen.getByText("Plan first, then make changes.", { selector: "text[x='80']" }),
    ).toBeInTheDocument();
    advance(10);
    expect(shortcut).toHaveAttribute("opacity", "0");
    expect(
      screen.getByText("Plan first, then make changes.", { selector: "text[x='80']" }),
    ).toBeInTheDocument();
  });

  it("sends the pasted draft and holds the pending reply before restarting", () => {
    const { container } = render(<CommonCommandsEmptyState />);
    advance(10);
    const context = container.querySelector('[data-scene="chat-context"]')!;
    expect(context).toHaveTextContent("List the page layout issues.");
    expect(context).toHaveTextContent("Uneven spacing and unclear hierarchy.");
    expect(
      screen.getByText("Plan first, then make changes.", { selector: "text[x='80']" }),
    ).toBeInTheDocument();
    expect(container.querySelector('[data-scene="sent-message"]')).toBeNull();
    advance(10.5);
    expect(screen.getByText("Ask Codex…")).toBeInTheDocument();
    expect(container.querySelector('[data-scene="sent-message"]')).toHaveTextContent(
      "Plan first, then make changes.",
    );
    const pending = container.querySelector('[data-scene="reply-pending"]')!;
    expect(pending).toHaveTextContent("Codex");
    expect(pending.querySelectorAll("circle")).toHaveLength(3);
    const opacity = pending.querySelector("circle")!.getAttribute("opacity");
    advance(10.8);
    expect(pending.querySelector("circle")).not.toHaveAttribute("opacity", opacity);
    advance(14);
    expect(context).toBeInTheDocument();
    expect(pending).toBeInTheDocument();
    advance(0);
    expect(container.querySelector('[data-scene="sent-message"]')).toBeNull();
    expect(container.querySelector('[data-scene="reply-pending"]')).toBeNull();
  });

  it("keeps playing the same animation while hovered", () => {
    render(<CommonCommandsEmptyState />);
    fireEvent.mouseEnter(screen.getByRole("img"));
    expect(animation.pause).not.toHaveBeenCalled();
    fireEvent.mouseLeave(screen.getByRole("img"));
    expect(animation.pause).not.toHaveBeenCalled();
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("shows a static sent message and pending reply for reduced motion", () => {
    animation.reduced = true;
    render(<CommonCommandsEmptyState />);
    expect(animate).not.toHaveBeenCalled();
    expect(screen.getByText("⌘ V").parentElement).toHaveAttribute("opacity", "0");
    expect(screen.getByText("Codex", { selector: "text[x='280']" })).toBeInTheDocument();
    expect(
      screen.getByText("Plan first, then make changes.", {
        selector: "g[data-scene='sent-message'] span",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Codex", { selector: "g[data-scene='reply-pending'] > text" }).parentElement,
    ).toHaveAttribute("data-scene", "reply-pending");
  });

  it("stops on preference changes and unmount", () => {
    const { rerender, unmount } = render(<CommonCommandsEmptyState />);
    fireEvent.mouseEnter(screen.getByRole("img"));
    animation.reduced = true;
    rerender(<CommonCommandsEmptyState />);
    expect(animation.stop).toHaveBeenCalledTimes(1);
    animation.reduced = false;
    rerender(<CommonCommandsEmptyState />);
    expect(animate).toHaveBeenCalledTimes(2);
    unmount();
    expect(animation.stop).toHaveBeenCalledTimes(2);
  });

  it("localizes the simulated UI and accessible description", async () => {
    await i18n.changeLanguage("zh");
    render(<CommonCommandsEmptyState />);
    advance(9.5);
    expect(screen.getByText("列出网页布局目前存在的问题。")).toBeInTheDocument();
    expect(screen.getByText("间距不统一，层级不清晰。")).toBeInTheDocument();
    expect(screen.getAllByText("先给出计划，再开始修改")).toHaveLength(3);
    expect(screen.getByRole("img")).toHaveAccessibleName(/此演示不会修改你的剪贴板/);
  });
});

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
    expect(screen.getByText("Chatbot", { selector: "text[x='280']" })).toBeInTheDocument();
    expect(screen.getAllByText("Plan first, then make changes.")).toHaveLength(3);
    advance(0);
    expect(screen.getByText("Ask your chatbot…")).toBeInTheDocument();
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

  it("keeps playing the same animation while hovered", () => {
    render(<CommonCommandsEmptyState />);
    fireEvent.mouseEnter(screen.getByRole("img"));
    expect(animation.pause).not.toHaveBeenCalled();
    fireEvent.mouseLeave(screen.getByRole("img"));
    expect(animation.pause).not.toHaveBeenCalled();
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("shows a static pasted phrase without starting animation for reduced motion", () => {
    animation.reduced = true;
    render(<CommonCommandsEmptyState />);
    expect(animate).not.toHaveBeenCalled();
    expect(screen.getByText("Chatbot", { selector: "text[x='280']" })).toBeInTheDocument();
    expect(
      screen.getByText("Plan first, then make changes.", { selector: "text[x='80']" }),
    ).toBeInTheDocument();
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
    expect(screen.getAllByText("先给出计划，再开始修改")).toHaveLength(3);
    expect(screen.getByRole("img")).toHaveAccessibleName(/此演示不会修改你的剪贴板/);
  });
});

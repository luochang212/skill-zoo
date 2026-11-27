import "@/i18n";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BannerCarousel } from "./BannerCarousel";
import type { ResolvedBanner } from "@/types/skills";

const listeners = new Set<() => void>();
let reduced = false;
const media = {
  get matches() {
    return reduced;
  },
  addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
  removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
};
function setReduced(value: boolean) {
  act(() => {
    reduced = value;
    listeners.forEach((listener) => listener());
  });
}

const banners: ResolvedBanner[] = [
  { title: "First", subtitle: "First banner", image: "first.png", imageUrl: "first.png" },
  { title: "Second", subtitle: "Second banner", image: "second.png", imageUrl: "second.png" },
];

function showCarousel() {
  const view = render(<BannerCarousel banners={banners} pending={false} />);
  view.container.querySelectorAll("img").forEach((image) => fireEvent.load(image));
  return view;
}

function activeTitle() {
  return ["First", "Second"].find(
    (title) =>
      (screen.getByRole("img", { name: title }).parentElement as HTMLElement).style.zIndex === "20",
  );
}

let resourceVersion = 0;

describe("BannerCarousel", () => {
  beforeEach(() => {
    resourceVersion += 1;
    banners.forEach((banner, index) => {
      const image = `${resourceVersion}-${index}.png`;
      banner.image = image;
      banner.imageUrl = image;
    });
    vi.useFakeTimers();
    reduced = false;
    listeners.clear();
    vi.stubGlobal("matchMedia", () => media);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reserves its height with muted cards while banners are pending", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
    const view = render(<BannerCarousel banners={undefined} pending={true} />);
    const container = view.container.firstElementChild as HTMLElement;
    expect(container.style.height).toBe("354px");
    expect(container).toHaveAttribute("aria-busy", "true");
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelectorAll(".bg-muted")).toHaveLength(3);
  });

  it("keeps card geometry when pending banners resolve", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
    const view = render(<BannerCarousel banners={undefined} pending={true} />);
    const container = view.container.firstElementChild as HTMLElement;
    expect(container.style.height).toBe("354px");
    view.rerender(<BannerCarousel banners={banners} pending={false} />);
    expect(view.container.firstElementChild).toBe(container);
    expect(container.style.height).toBe("354px");
    expect(container.querySelectorAll(".bg-muted")).toHaveLength(2);
    expect(screen.getByAltText("First").className).toContain("opacity-0");
    expect(container).toHaveAttribute("aria-busy", "true");
  });

  it("shows muted cards immediately and reveals images as they decode", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
    const view = render(<BannerCarousel banners={banners} pending={false} />);
    const container = view.container.firstElementChild as HTMLElement;
    expect(container.style.height).toBe("354px");
    expect(container.querySelectorAll(".bg-muted")).toHaveLength(2);
    expect(screen.getByAltText("First").className).toContain("opacity-0");
    expect(container).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Next banner" })).toBeVisible();

    act(() => vi.advanceTimersByTime(7000));
    expect(activeTitle()).toBe("Second");
    fireEvent.load(screen.getByAltText("First"));
    fireEvent.load(screen.getByAltText("Second"));
    expect(screen.getByAltText("First").className).toContain("opacity-100");
    expect(container).toHaveAttribute("aria-busy", "false");
    expect(activeTitle()).toBe("Second");

    act(() => vi.advanceTimersByTime(6999));
    expect(activeTitle()).toBe("Second");
    act(() => vi.advanceTimersByTime(1));
    expect(activeTitle()).toBe("First");
    expect(container.style.height).toBe("354px");
  });

  it("ends loading with readable titles when an image or resource url is missing", () => {
    const broken: ResolvedBanner[] = [
      { title: "First", subtitle: "First banner", image: "first.png", imageUrl: "" },
      { title: "Second", subtitle: "Second banner", image: "second.png", imageUrl: "second.png" },
    ];
    const view = render(<BannerCarousel banners={broken} pending={false} />);
    expect(screen.queryByAltText("First")).toBeNull();
    fireEvent.error(screen.getByAltText("Second"));
    expect(screen.getByText("First")).toBeVisible();
    expect(screen.getByText("Second")).toBeVisible();
    expect(view.container.firstElementChild).toHaveAttribute("aria-busy", "false");
  });

  it("shows previously loaded banners immediately when returning to the page", () => {
    const first = showCarousel();
    first.unmount();
    const returned = showCarousel();
    expect(screen.getByRole("img", { name: "First" }).className).toContain("opacity-100");
    expect(returned.container.firstElementChild).toHaveAttribute("aria-busy", "false");
  });

  it("does not autoplay under reduce, but manual navigation remains available", () => {
    setReduced(true);
    showCarousel();
    act(() => vi.advanceTimersByTime(16000));
    expect(activeTitle()).toBe("First");

    act(() => screen.getByRole("button", { name: "Next banner" }).click());
    expect(activeTitle()).toBe("Second");
    expect(
      (screen.getByRole("img", { name: "Second" }).parentElement as HTMLElement).style.transition,
    ).toBe("none");
  });

  it("clears autoplay when reduce is enabled and resumes without duplicate timers", () => {
    const view = showCarousel();
    act(() => vi.advanceTimersByTime(7000));
    expect(activeTitle()).toBe("Second");

    setReduced(true);
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(16000));
    expect(activeTitle()).toBe("Second");

    setReduced(false);
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(7000));
    expect(activeTitle()).toBe("First");
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(listeners.size).toBe(0);
  });

  it("keeps autoplay running on hover and whitens the active dot only over the dots", () => {
    const view = showCarousel();
    const progress = () =>
      view.container.querySelector('[aria-current="true"] > span > span') as HTMLElement;
    const track = () => view.container.querySelector('[aria-current="true"] > span') as HTMLElement;
    const dots = view.container.querySelector(".bottom-3") as HTMLElement;

    expect(progress().style.animation).toContain("7000ms");
    expect(track().className).toContain("bg-white/30");

    act(() => vi.advanceTimersByTime(6000));
    fireEvent.click(screen.getByRole("button", { name: "Next banner" }));
    act(() => vi.advanceTimersByTime(1000));
    expect(activeTitle()).toBe("Second");

    fireEvent.mouseEnter(view.container.firstElementChild!);
    act(() => vi.advanceTimersByTime(7000));
    expect(activeTitle()).toBe("First");
    expect(progress().style.animation).toContain("7000ms");
    expect(track().className).toContain("bg-white/30");

    fireEvent.mouseEnter(dots);
    expect(track().className).not.toContain("bg-white/30");
    act(() => vi.advanceTimersByTime(7000));
    expect(activeTitle()).toBe("Second");

    fireEvent.mouseLeave(dots);
    expect(track().className).toContain("bg-white/30");

    setReduced(true);
    expect(progress().style.animation).toBe("none");
    expect(vi.getTimerCount()).toBe(0);
  });
});

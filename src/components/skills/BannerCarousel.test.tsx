import "@/i18n";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { resolveResource } from "@tauri-apps/api/path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BannerCarousel } from "./BannerCarousel";
import type { Banner } from "@/types/skills";

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
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => path }));
vi.mock("@tauri-apps/api/path", () => ({ resolveResource: vi.fn(async (path: string) => path) }));

const banners: Banner[] = [
  { title: "First", subtitle: "First banner", image: "first.png" },
  { title: "Second", subtitle: "Second banner", image: "second.png" },
];

async function showCarousel() {
  const view = render(<BannerCarousel banners={banners} />);
  await act(async () => {});
  return view;
}

function activeTitle() {
  return ["First", "Second"].find(
    (title) =>
      (screen.getByRole("img", { name: title }).parentElement as HTMLElement).style.zIndex === "20",
  );
}

describe("BannerCarousel motion preference", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reduced = false;
    listeners.clear();
    vi.mocked(resolveResource).mockImplementation(async (path: string) => path);
    vi.stubGlobal("matchMedia", () => media);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("measures the loading container and preserves its height until images finish", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
    const view = render(<BannerCarousel banners={banners} />);
    const container = view.container.firstElementChild as HTMLElement;
    expect(container.style.height).toBe("354px");
    expect(container.querySelectorAll(".skeleton")).toHaveLength(2);
    await act(async () => {});
    expect(container).toHaveAttribute("aria-busy", "true");
    fireEvent.load(screen.getByRole("img", { name: "First" }));
    expect(container.querySelectorAll(".skeleton")).toHaveLength(1);
    fireEvent.load(screen.getByRole("img", { name: "Second" }));
    expect(container.querySelectorAll(".skeleton")).toHaveLength(0);
    expect(container).toHaveAttribute("aria-busy", "false");
    expect(container.style.height).toBe("354px");
  });

  it("ends loading with readable titles when an image or resource path fails", async () => {
    vi.mocked(resolveResource).mockRejectedValueOnce(new Error("missing resource"));
    const view = await showCarousel();
    expect(screen.getByText("First")).toBeVisible();
    expect(screen.queryByRole("img", { name: "First" })).toBeNull();
    fireEvent.error(screen.getByRole("img", { name: "Second" }));
    expect(screen.getByText("Second")).toBeVisible();
    expect(view.container.querySelectorAll(".skeleton")).toHaveLength(0);
    expect(view.container.firstElementChild).toHaveAttribute("aria-busy", "false");
  });

  it("does not autoplay under reduce, but manual navigation remains available", async () => {
    setReduced(true);
    await showCarousel();
    act(() => vi.advanceTimersByTime(16000));
    expect(activeTitle()).toBe("First");

    act(() => screen.getByRole("button", { name: "Next banner" }).click());
    expect(activeTitle()).toBe("Second");
    expect(
      (screen.getByRole("img", { name: "Second" }).parentElement as HTMLElement).style.transition,
    ).toBe("none");
  });

  it("clears autoplay when reduce is enabled and resumes without duplicate timers", async () => {
    const view = await showCarousel();
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

  it("restarts the progress and autoplay together after navigation or hover", async () => {
    const view = await showCarousel();
    const progress = () =>
      view.container.querySelector('[aria-current="true"] > span > span') as HTMLElement;
    expect(progress().style.animation).toContain("7000ms");
    act(() => vi.advanceTimersByTime(6000));
    fireEvent.click(screen.getByRole("button", { name: "Next banner" }));
    act(() => vi.advanceTimersByTime(1000));
    expect(activeTitle()).toBe("Second");
    fireEvent.mouseEnter(view.container.firstElementChild!);
    expect(progress().style.animation).toBe("none");
    expect(vi.getTimerCount()).toBe(0);
    fireEvent.mouseLeave(view.container.firstElementChild!);
    expect(progress().style.animation).toContain("7000ms");
    act(() => vi.advanceTimersByTime(7000));
    expect(activeTitle()).toBe("First");
    setReduced(true);
    expect(progress().style.animation).toBe("none");
    expect(vi.getTimerCount()).toBe(0);
  });
});

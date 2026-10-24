import "@/i18n";
import { act, render, screen } from "@testing-library/react";
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
vi.mock("@tauri-apps/api/path", () => ({ resolveResource: async (path: string) => path }));

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
    vi.stubGlobal("matchMedia", () => media);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
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
    act(() => vi.advanceTimersByTime(8000));
    expect(activeTitle()).toBe("Second");

    setReduced(true);
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(16000));
    expect(activeTitle()).toBe("Second");

    setReduced(false);
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(8000));
    expect(activeTitle()).toBe("First");
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(listeners.size).toBe(0);
  });
});

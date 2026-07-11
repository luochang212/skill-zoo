import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme } from "@/hooks/useTheme";

vi.mock("@tauri-apps/api/core");

describe("applyTheme", () => {
  beforeEach(() => {
    document.documentElement.className = "";
    document.documentElement.removeAttribute("style");
    document.head.innerHTML = '<meta name="color-scheme" content="light dark" />';
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("applies dark without leaving a light color scheme", () => {
    applyTheme("dark");

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(document.querySelector('meta[name="color-scheme"]')).toHaveAttribute("content", "dark");
  });

  it("applies light without leaving a dark color scheme", () => {
    applyTheme("light");

    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(document.querySelector('meta[name="color-scheme"]')).toHaveAttribute("content", "light");
  });
});

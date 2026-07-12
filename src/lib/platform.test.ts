import { afterEach, describe, expect, it, vi } from "vitest";
import { isWindows, supportsSkillDragAndDrop } from "./platform";

function stubNavigator(userAgent: string, platform: string) {
  vi.stubGlobal("navigator", { userAgent, platform });
}

describe("platform", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("detects Windows from the user agent or platform", () => {
    stubNavigator("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "MacIntel");
    expect(isWindows()).toBe(true);

    stubNavigator("Mozilla/5.0", "Win32");
    expect(isWindows()).toBe(true);
  });

  it("does not treat macOS or Darwin as Windows", () => {
    stubNavigator("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)", "MacIntel");
    expect(isWindows()).toBe(false);

    stubNavigator("Mozilla/5.0", "Darwin");
    expect(isWindows()).toBe(false);
  });

  it("disables skill drag and drop only on Windows", () => {
    stubNavigator("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Win32");
    expect(supportsSkillDragAndDrop()).toBe(false);

    stubNavigator("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)", "MacIntel");
    expect(supportsSkillDragAndDrop()).toBe(true);
  });
});

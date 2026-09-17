import "@/i18n";
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SkillContentPane } from "./SkillContentPane";
import { createTestQueryClient } from "@/test/utils";

/**
 * Why this test exists (not a tautology):
 *
 * Tailwind CSS v4 compiles `-translate-x-full` to the INDIVIDUAL css property
 * `translate: var(--tw-translate-x) ...` and never to `transform`. The sidebar
 * previously declared `transition-[transform,opacity]`, so the transition never
 * covered the property that actually changed and the slide silently degraded to a
 * pure fade. Verified in a real browser against the repo's built CSS:
 * `.-translate-x-full{--tw-translate-x:-100%;translate:...}`,
 * `.transition-\[transform\,opacity\]{transition-property:transform,opacity}`,
 * `.transition-transform{transition-property:transform,translate,scale,rotate}`.
 *
 * So the guard is: the element that gets the translate utility must declare a
 * transition that covers `translate`, and the container whose width changes must
 * animate that width (otherwise it snaps to 0 in the same frame and the outgoing
 * slide is clipped, which is why collapsing looked like an instant vanish).
 */
function renderPane(sidebarOpen: boolean) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <SkillContentPane
        content=""
        onChange={() => {}}
        activeTab="overview"
        onTabChange={() => {}}
        hideFileTree={!sidebarOpen}
      />
    </QueryClientProvider>,
  );
}

function findWidthContainer(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>("[class]")).find((el) => {
    const style = (el.getAttribute("style") ?? "").replace(/\s/g, "");
    return style.includes("width:") && el.className.includes("overflow-hidden");
  });
}

describe("SkillContentPane sidebar animation", () => {
  it("declares a transition that covers the property it translates", () => {
    const { container } = renderPane(true);

    const translated = Array.from(container.querySelectorAll("[class]")).filter((el) =>
      /(^|\s)-?translate-x-(full|0)(\s|$)/.test(el.className),
    );
    expect(translated.length).toBeGreaterThan(0);

    for (const el of translated) {
      expect(el.className).toMatch(/\btransition-(?:\[translate|transform)/);
      expect(el.className).not.toContain("transition-[transform,opacity]");
    }
  });

  it("animates the container width when the sidebar is open", () => {
    const { container } = renderPane(true);

    const widthContainer = findWidthContainer(container);

    expect(widthContainer).toBeTruthy();
    expect(widthContainer?.className).toMatch(/\btransition-\[width/);
    expect(widthContainer?.className).not.toContain("duration-0");
  });

  it("collapses the container width to zero when the file tree is hidden", () => {
    const { container } = renderPane(false);

    const widthContainer = findWidthContainer(container);

    expect(widthContainer).toBeTruthy();
    expect(widthContainer?.className).toMatch(/\btransition-\[width/);
    expect((widthContainer?.getAttribute("style") ?? "").replace(/\s/g, "")).toMatch(/width:0/);
  });

  it("keeps the inner element animating its own translate while open", () => {
    const { container } = renderPane(true);

    const translated = Array.from(container.querySelectorAll("[class]")).find((el) =>
      /\btranslate-x-0(\s|$)/.test(el.className),
    );

    expect(translated?.className).toMatch(/\bopacity-100(\s|$)/);
    expect(translated?.className).not.toContain("-translate-x-full");
  });
});

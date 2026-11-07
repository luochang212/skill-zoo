import "@/i18n";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommunitySkills, diversifySkills } from "./CommunitySkills";
import type { CatalogSkill } from "@/types/skills";
const mocks = vi.hoisted(() => ({ result: {} as Record<string, unknown>, hook: vi.fn() }));
vi.mock("@/hooks/useSkillCatalog", () => ({
  useSkillCatalog: (kind: string) => {
    mocks.hook(kind);
    return mocks.result;
  },
}));
const skill = (source: string, skillId: string): CatalogSkill => ({
  source,
  skillId,
  name: skillId,
  installs: 1200,
  weeklyInstalls: [100, 300, 200, 500, 400, 800, 700, 900],
});
describe("community discovery", () => {
  it("spreads repository exposure without losing skills", () => {
    const skills = [skill("a/repo", "one"), skill("a/repo", "two"), skill("b/repo", "three")];
    expect(diversifySkills(skills).map((s) => s.skillId)).toEqual(["one", "three", "two"]);
  });
  it("opens the exact source slug, auto-extends on scroll, and switches metrics", () => {
    const observer = { callback: null as IntersectionObserverCallback | null };
    class MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        observer.callback = callback;
      }
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    const skills = Array.from({ length: 13 }, (_, i) => skill("owner/repo", `skill-${i}`));
    mocks.result = { data: { skills, fetchedAt: 123, stale: true }, isPending: false };
    const onOpen = vi.fn();
    const { container } = render(<CommunitySkills onOpen={onOpen} />);
    // Each card shows the weekly trend area in its bottom-right corner.
    const sparklines = container.querySelectorAll('svg[viewBox="0 0 104 30"]');
    expect(sparklines).toHaveLength(12);
    expect(sparklines[0]?.querySelectorAll("path")).toHaveLength(2);
    expect(sparklines[0]?.querySelector("circle")).toBeTruthy();
    expect(screen.queryByText("skill-12")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^skill-0 ·/ }));
    expect(onOpen).toHaveBeenCalledWith(skills[0]);
    act(() =>
      observer.callback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    );
    // The window widens ahead of the viewport; the batch itself staggers in.
    expect(screen.getByText("skill-12")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Latest" }));
    expect(mocks.hook).toHaveBeenLastCalledWith("trending");
    expect(screen.getAllByText(/installs · 24h/)).toHaveLength(12);
    vi.unstubAllGlobals();
  });
});

import "@/i18n";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConsistencyPanel } from "./ConsistencyPanel";
import type { DuplicateGroup } from "@/hooks/useSkillIssues";
import type { InstalledSkill } from "@/types/skills";

vi.mock("@/hooks/useSkills", () => ({
  useMergeDuplicates: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

function skill(id: string, name: string): InstalledSkill {
  return {
    id,
    name,
    directory: id,
    homePath: `/skills/${id}`,
    contentHash: `${id}-hash`,
    apps: {},
    origin: "ssot",
    installedAt: 1,
    updatedAt: 1,
  };
}

function duplicateGroup(name: string): DuplicateGroup {
  return {
    name,
    sameContent: false,
    skills: [skill(`${name}-one`, name), skill(`${name}-two`, name)],
  };
}

describe("ConsistencyPanel navigation highlight", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("highlights the target issue after navigation", async () => {
    render(
      <ConsistencyPanel
        duplicateGroups={[duplicateGroup("conflict")]}
        nameMismatches={[]}
        initialTab="conflicts"
        scrollToId="conflict"
      />,
    );

    const target = document.querySelector('[data-dup-group="conflict"]');

    await waitFor(() => {
      expect(target).toHaveAttribute("data-highlighted-target", "true");
    });
    expect(target).not.toHaveClass("motion-safe:animate-pulse");
    expect(target).not.toHaveClass("motion-safe:animate-target-arrival");
    expect(target?.querySelector("[data-target-rail]")).toHaveClass(
      "motion-safe:animate-target-arrival",
    );
    expect(target?.className).toContain("bg-rose-50/60");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
  });

  it("keeps the target highlight visible long enough to confirm the landing", async () => {
    vi.useFakeTimers();

    render(
      <ConsistencyPanel
        duplicateGroups={[duplicateGroup("conflict")]}
        nameMismatches={[]}
        initialTab="conflicts"
        scrollToId="conflict"
      />,
    );

    const target = document.querySelector('[data-dup-group="conflict"]');

    await act(async () => {
      vi.advanceTimersByTime(80);
    });
    expect(target).toHaveAttribute("data-highlighted-target", "true");

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(target).not.toHaveAttribute("data-highlighted-target");
  });
});

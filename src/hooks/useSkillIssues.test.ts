import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useConsistencyCheck } from "./useSkillIssues";
import type { InstalledSkill } from "@/types/skills";

import type { SkillOrigin } from "@/types/skills";

function makeSkill(id: string, contentHash?: string, origin: SkillOrigin = "ssot"): InstalledSkill {
  return {
    id,
    name: "duplicate",
    directory: id,
    contentHash,
    apps: {},
    origin,
    installedAt: 1,
    updatedAt: 1,
  };
}

describe("useConsistencyCheck", () => {
  it("requires every duplicate to have the same verified content hash", () => {
    const { result, rerender } = renderHook(
      ({ skills }: { skills: InstalledSkill[] }) => useConsistencyCheck(skills),
      {
        initialProps: {
          skills: [makeSkill("one", "hash"), makeSkill("two")],
        },
      },
    );

    expect(result.current.duplicateGroups[0].sameContent).toBe(false);

    rerender({
      skills: [makeSkill("one", "hash"), makeSkill("two", "hash")],
    });

    expect(result.current.duplicateGroups[0].sameContent).toBe(true);
  });

  it("does not treat external imports as local duplicates", () => {
    const { result } = renderHook(() =>
      useConsistencyCheck([makeSkill("local", "hash"), makeSkill("external", "hash", "external")]),
    );

    expect(result.current.duplicateGroups).toEqual([]);
    expect(result.current.issuesMap.size).toBe(0);
  });
});

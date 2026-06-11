import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useConsistencyCheck } from "./useSkillIssues";
import type { InstalledSkill } from "@/types/skills";

function makeSkill(id: string, contentHash?: string): InstalledSkill {
  return {
    id,
    name: "duplicate",
    directory: id,
    contentHash,
    apps: {},
    origin: "ssot",
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
});

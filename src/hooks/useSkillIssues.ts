import { useMemo } from "react";
import type { InstalledSkill } from "@/types/skills";

export type ConsistencyTab = "duplicates" | "conflicts" | "mismatches";

export interface SkillIssues {
  isDuplicate?: boolean;
  hasConflict?: boolean;
  isMismatch?: boolean;
  /** For duplicate/conflict: the group name (= skill name) to scroll to in ConsistencyPanel */
  duplicateGroupName?: string;
  /** For mismatch: the skill ID to scroll to in ConsistencyPanel */
  mismatchSkillId?: string;
}

export interface DuplicateGroup {
  name: string;
  skills: InstalledSkill[];
  sameContent: boolean;
}

export interface NameMismatch {
  skillId: string;
  skillName: string;
  directory: string;
  homePath?: string;
}

export function useConsistencyCheck(skills: InstalledSkill[]) {
  return useMemo(() => {
    const issuesMap = new Map<string, SkillIssues>();
    const nameGroups = new Map<string, InstalledSkill[]>();

    for (const s of skills) {
      if (s.origin === "external") continue;
      const existing = nameGroups.get(s.name);
      if (existing) {
        existing.push(s);
      } else {
        nameGroups.set(s.name, [s]);
      }
    }

    const duplicateGroups: DuplicateGroup[] = [];
    for (const [name, group] of nameGroups) {
      if (group.length <= 1) continue;
      const sameContent =
        group.every((s) => !!s.contentHash) &&
        group.every((s) => s.contentHash === group[0].contentHash);
      duplicateGroups.push({ name, skills: group, sameContent });
      for (const s of group) {
        const e = issuesMap.get(s.id) ?? {};
        if (sameContent) e.isDuplicate = true;
        else e.hasConflict = true;
        e.duplicateGroupName = name;
        issuesMap.set(s.id, e);
      }
    }

    const nameMismatches: NameMismatch[] = [];
    for (const s of skills) {
      if (s.origin === "external") continue;
      if (s.yamlName) {
        nameMismatches.push({
          skillId: s.id,
          skillName: s.yamlName,
          directory: s.directory,
          homePath: s.homePath,
        });
        const e = issuesMap.get(s.id) ?? {};
        e.isMismatch = true;
        e.mismatchSkillId = s.id;
        issuesMap.set(s.id, e);
      }
    }

    const consistencyCount = duplicateGroups.length + nameMismatches.length;
    return { duplicateGroups, nameMismatches, issuesMap, consistencyCount };
  }, [skills]);
}

import type { DiscoverableSkill } from "@/types/skills";

export interface RepoSkillGroup {
  parentPath: string;
  skills: DiscoverableSkill[];
}

export function parentPathOf(key: string): string {
  if (key === ".") return "";
  const idx = key.lastIndexOf("/");
  return idx === -1 ? "" : key.slice(0, idx);
}

export function groupSkillsByParentPath(skills: DiscoverableSkill[]): RepoSkillGroup[] {
  const groups = new Map<string, DiscoverableSkill[]>();
  for (const skill of skills) {
    const parent = parentPathOf(skill.key);
    const bucket = groups.get(parent);
    if (bucket) {
      bucket.push(skill);
    } else {
      groups.set(parent, [skill]);
    }
  }
  return [...groups.entries()]
    .toSorted(([a], [b]) => {
      const depthA = a === "" ? 0 : a.split("/").length;
      const depthB = b === "" ? 0 : b.split("/").length;
      if (depthA !== depthB) return depthA - depthB;
      return a.localeCompare(b);
    })
    .map(([parentPath, groupSkills]) => ({
      parentPath,
      skills: groupSkills.toSorted((a, b) => a.name.localeCompare(b.name)),
    }));
}

export function duplicateSkillNames(skills: DiscoverableSkill[]): Set<string> {
  const counts = new Map<string, number>();
  for (const skill of skills) {
    counts.set(skill.name, (counts.get(skill.name) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name));
}

export function filterSkillsBySubtree(
  skills: DiscoverableSkill[],
  path: string,
): DiscoverableSkill[] {
  const normalized = path.trim().replace(/\/+$/, "");
  if (!normalized) return skills;
  return skills.filter(
    (skill) => skill.key === normalized || skill.key.startsWith(`${normalized}/`),
  );
}

const tailSegments = (path: string, n: number) => path.split("/").slice(-n).join("/");

export function compressedGroupLabels(parentPaths: string[]): Map<string, string> {
  return new Map(
    parentPaths.map((path) => {
      if (path === "") return [path, "/"] as const;
      const segments = path.split("/").length;
      let n = 1;
      while (
        n < segments &&
        parentPaths.some(
          (other) => other !== path && tailSegments(other, n) === tailSegments(path, n),
        )
      ) {
        n += 1;
      }
      return [path, tailSegments(path, n)] as const;
    }),
  );
}

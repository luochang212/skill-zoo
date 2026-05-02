import type { QueryClient } from "@tanstack/react-query";

/**
 * Central mapping of which query keys each mutation should invalidate.
 * Adding a new dependent query requires changing only this map.
 */
export const INVALIDATION_MAP = {
  installSkills: [
    ["skills", "installed"],
    ["repos", "skills"],
    ["skills", "symlinks"],
    ["skills.sh", "search"],
  ],
  removeSkill: [
    ["skills", "installed"],
    ["repos", "skills"],
    ["skills", "symlinks"],
    ["skills.sh", "search"],
  ],
  toggleSymlink: [
    ["skills", "symlinks"],
    ["skills", "installed"],
  ],
  starSkill: [["skills", "installed"]],
  unstarSkill: [["skills", "installed"]],
  setSkillIsMine: [["skills", "installed"]],
  createSkill: [
    ["skills", "installed"],
    ["skills", "symlinks"],
  ],
  updateSkill: [
    ["skills", "installed"],
    ["skills", "content"],
  ],
  updateAllSkills: [["skills", "installed"]],
  rescanSkills: [
    ["skills", "installed"],
    ["skills", "symlinks"],
  ],
  saveSkillContent: [
    ["skills", "content"],
    ["skills", "installed"],
  ],
  mergeDuplicates: [
    ["skills", "installed"],
    ["skills", "symlinks"],
  ],
} as const;

export type MutationName = keyof typeof INVALIDATION_MAP;

export function invalidateFor(
  queryClient: QueryClient,
  mutation: MutationName,
) {
  for (const key of INVALIDATION_MAP[mutation]) {
    queryClient.invalidateQueries({ queryKey: [...key] });
  }
}

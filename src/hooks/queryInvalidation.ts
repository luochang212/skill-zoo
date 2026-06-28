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
    ["skills", "archived"],
    ["repos", "skills"],
    ["skills", "symlinks"],
    ["skills.sh", "search"],
  ],
  archiveSkill: [
    ["skills", "installed"],
    ["skills", "archived"],
    ["repos", "skills"],
    ["skills", "symlinks"],
    ["skills.sh", "search"],
  ],
  archiveSkills: [
    ["skills", "installed"],
    ["skills", "archived"],
    ["repos", "skills"],
    ["skills", "symlinks"],
    ["skills.sh", "search"],
  ],
  restoreArchivedSkill: [
    ["skills", "installed"],
    ["skills", "archived"],
    ["repos", "skills"],
    ["skills", "symlinks"],
    ["skills.sh", "search"],
  ],
  restoreArchivedSkills: [
    ["skills", "installed"],
    ["skills", "archived"],
    ["repos", "skills"],
    ["skills", "symlinks"],
    ["skills.sh", "search"],
  ],
  toggleSymlink: [
    ["skills", "symlinks"],
    ["skills", "installed"],
  ],
  createSkill: [
    ["skills", "installed"],
    ["skills", "symlinks"],
  ],
  updateSkill: [
    ["skills", "installed"],
    ["skills", "content"],
    ["skills", "updateHistory"],
  ],
  updateAllSkills: [
    ["skills", "installed"],
    ["skills", "updateHistory"],
  ],
  deleteSkillUpdateHistory: [["skills", "updateHistory"]],
  clearSkillUpdateHistory: [["skills", "updateHistory"]],
  rescanSkills: [
    ["skills", "installed"],
    ["skills", "archived"],
    ["skills", "symlinks"],
    ["skills", "content"],
    ["skills", "files"],
    ["skills", "fileChildren"],
    ["skills", "file"],
    ["skills", "image"],
  ],
  saveSkillContent: [
    ["skills", "content"],
    ["skills", "installed"],
  ],
  saveSkillFileContent: [["skills", "installed"]],
  mergeDuplicates: [
    ["skills", "installed"],
    ["skills", "symlinks"],
  ],
} as const;

export type MutationName = keyof typeof INVALIDATION_MAP;

export function invalidateFor(queryClient: QueryClient, mutation: MutationName) {
  for (const key of INVALIDATION_MAP[mutation]) {
    queryClient.invalidateQueries({ queryKey: [...key] });
  }
}

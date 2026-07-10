import type { QueryClient } from "@tanstack/react-query";

/**
 * Central mapping of which query keys each mutation should invalidate.
 * Adding a new dependent query requires changing only this map.
 */
const SKILL_LIST_INVALIDATION = [
  ["skills", "installed"],
  ["skills", "archived"],
  ["repos", "skills"],
  ["skills", "symlinks"],
  ["skills.sh", "search"],
] as const;

const REMOVE_SKILL_INVALIDATION = [
  ...SKILL_LIST_INVALIDATION,
  ["skills", "externalImports"],
] as const;

export const INVALIDATION_MAP = {
  installSkills: [
    ["skills", "installed"],
    ["repos", "skills"],
    ["skills", "symlinks"],
    ["skills.sh", "search"],
  ],
  externalImports: [
    ["skills", "externalImports"],
    ["skills", "installed"],
    ["skills", "symlinks"],
    ["skills", "content"],
    ["skills", "files"],
    ["skills", "fileChildren"],
    ["skills", "file"],
    ["skills", "image"],
  ],
  removeSkill: REMOVE_SKILL_INVALIDATION,
  archiveSkill: SKILL_LIST_INVALIDATION,
  archiveSkills: SKILL_LIST_INVALIDATION,
  restoreArchivedSkill: SKILL_LIST_INVALIDATION,
  restoreArchivedSkills: SKILL_LIST_INVALIDATION,
  toggleSymlink: [
    ["skills", "symlinks"],
    ["skills", "installed"],
  ],
  batchUnlinkSkills: [
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
    ["repos", "skills"],
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

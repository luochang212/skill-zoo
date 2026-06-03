import { CliError } from "../lib/errors.js";
import type { InstalledSkill } from "./types.js";

export type ResolvedSkillRef = { ref: string; skill: InstalledSkill } | { ref: string; error: string };

export function resolveSkillRefs(skills: InstalledSkill[], refs: string[]): ResolvedSkillRef[] {
  return refs.map((ref) => {
    const matches = skills.filter((skill) => skill.id === ref || skill.directory === ref || skill.name === ref);
    if (matches.length === 0) {
      return { ref, error: `Skill not found: ${ref}` };
    }

    const unique = new Map(matches.map((skill) => [skill.id, skill]));
    if (unique.size > 1) {
      return {
        ref,
        error: `Skill reference is ambiguous: ${ref}. Matches: ${[...unique.values()]
          .map((skill) => skill.id)
          .join(", ")}`,
      };
    }

    const skill = [...unique.values()][0];
    if (!skill) {
      return { ref, error: `Skill not found: ${ref}` };
    }

    return { ref, skill };
  });
}

export function resolveOneSkillRef(skills: InstalledSkill[], ref: string): InstalledSkill {
  const resolved = resolveSkillRefs(skills, [ref])[0];
  if (!resolved) {
    throw new CliError(`Skill not found: ${ref}`);
  }
  if ("error" in resolved) {
    throw new CliError(resolved.error);
  }
  return resolved.skill;
}

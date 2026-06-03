import type { ArchivedSkill, Change, InstalledSkill } from "./protocol/types.js";
import { enabledAgentIds } from "./protocol/archive.js";

export interface JsonEnvelope {
  ok: boolean;
  data?: unknown;
  changes?: Change[];
  error?: string;
}

export function jsonEnvelope(envelope: JsonEnvelope): string {
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

export function formatSkillList(skills: InstalledSkill[]): string {
  if (skills.length === 0) {
    return "No installed skills found.\n";
  }

  return `${skills
    .map((skill) => {
      const agents = enabledAgentIds(skill);
      const suffix = agents.length > 0 ? ` [${agents.join(", ")}]` : "";
      return `${skill.directory}${suffix}`;
    })
    .join("\n")}\n`;
}

export function formatArchivedList(skills: ArchivedSkill[]): string {
  if (skills.length === 0) {
    return "No archived skills found.\n";
  }

  return `${skills.map((skill) => `${skill.archiveId} (${skill.name})`).join("\n")}\n`;
}

export function formatChanges(changes: Change[]): string {
  if (changes.length === 0) {
    return "No changes.\n";
  }

  return `${changes
    .map((change) => {
      const target = change.target ? ` -> ${change.target}` : "";
      return `${change.action}: ${change.path}${target}`;
    })
    .join("\n")}\n`;
}

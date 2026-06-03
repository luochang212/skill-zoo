import { scanInstalledSkills } from "./scan.js";
import type { InstalledSkill } from "./types.js";

export type ConsistencyStatus = "ok" | "warn";
export type ConsistencyIssueKind = "duplicate" | "conflict" | "mismatch";

export interface ConsistencySkillRef {
  id: string;
  name: string;
  yamlName?: string | null;
  directory: string;
  origin: string;
  homePath?: string | null;
  homeAgent?: string | null;
  contentHash?: string | null;
}

export interface ConsistencyIssue {
  kind: ConsistencyIssueKind;
  status: "warn";
  name: string;
  message: string;
  recommendation: string;
  skills: ConsistencySkillRef[];
}

export interface ConsistencySummary {
  total: number;
  duplicate: number;
  conflict: number;
  mismatch: number;
}

export interface ConsistencyReport {
  status: ConsistencyStatus;
  summary: ConsistencySummary;
  issues: ConsistencyIssue[];
}

export async function runConsistency(home?: string): Promise<ConsistencyReport> {
  const skills = await scanInstalledSkills(home);
  const issues = [
    ...findDuplicateAndConflictIssues(skills),
    ...findMismatchIssues(skills),
  ];

  return {
    status: issues.length > 0 ? "warn" : "ok",
    summary: summarizeIssues(issues),
    issues,
  };
}

function findDuplicateAndConflictIssues(skills: InstalledSkill[]): ConsistencyIssue[] {
  const groups = new Map<string, InstalledSkill[]>();
  for (const skill of skills) {
    groups.set(skill.name, [...(groups.get(skill.name) ?? []), skill]);
  }

  const issues: ConsistencyIssue[] = [];
  for (const [name, group] of groups) {
    if (group.length <= 1) {
      continue;
    }

    const nonEmptyHashes = group.filter((skill) => skill.contentHash);
    const sameContent =
      nonEmptyHashes.length > 0 &&
      nonEmptyHashes.every((skill) => skill.contentHash === nonEmptyHashes[0]?.contentHash);
    const kind: ConsistencyIssueKind = sameContent ? "duplicate" : "conflict";

    issues.push({
      kind,
      status: "warn",
      name,
      message: sameContent
        ? `Duplicate skill copies share the same content: ${name}`
        : `Skill copies with the same name have different content: ${name}`,
      recommendation: sameContent
        ? "Merge these copies into the Skill Zoo store when you are ready to canonicalize them."
        : "Compare the skill copies and choose or merge the canonical content before replacing any directory.",
      skills: group.map(toConsistencySkillRef),
    });
  }

  return issues;
}

function findMismatchIssues(skills: InstalledSkill[]): ConsistencyIssue[] {
  return skills
    .filter((skill) => Boolean(skill.yamlName))
    .map((skill) => ({
      kind: "mismatch" as const,
      status: "warn" as const,
      name: skill.yamlName ?? skill.name,
      message: `Skill frontmatter name does not match its directory: ${skill.directory}`,
      recommendation: "Decide whether the directory name or SKILL.md frontmatter name should be canonical.",
      skills: [toConsistencySkillRef(skill)],
    }));
}

function summarizeIssues(issues: ConsistencyIssue[]): ConsistencySummary {
  return {
    total: issues.length,
    duplicate: issues.filter((issue) => issue.kind === "duplicate").length,
    conflict: issues.filter((issue) => issue.kind === "conflict").length,
    mismatch: issues.filter((issue) => issue.kind === "mismatch").length,
  };
}

function toConsistencySkillRef(skill: InstalledSkill): ConsistencySkillRef {
  return {
    id: skill.id,
    name: skill.name,
    yamlName: skill.yamlName,
    directory: skill.directory,
    origin: skill.origin,
    homePath: skill.homePath,
    homeAgent: skill.homeAgent,
    contentHash: skill.contentHash,
  };
}

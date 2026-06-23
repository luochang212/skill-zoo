import path from "node:path";
import { AGENTS } from "./agents.js";
import { agentLinkName, getAgentSkillsDir, getPaths } from "./paths.js";
import { resolveOneSkillRef } from "./refs.js";
import { rebuildCache, scanCacheEntries, scanInstalledSkills } from "./scan.js";
import { assertWritableSchema, readArchiveManifest, readCache, readLock } from "./store.js";
import type { ArchivedSkill, InstalledSkill } from "./types.js";
import { CliError, messageFromError } from "../lib/errors.js";
import {
  createAgentLink,
  isSymlinkOrJunction,
  pathExists,
  pathStartsWith,
  pathsEqual,
} from "../lib/io.js";

export type InspectKind = "installed" | "archived";

export interface InspectSkillData {
  kind: InspectKind;
  id: string;
  archiveId?: string;
  originalSkillId?: string;
  name: string;
  yamlName?: string | null;
  description?: string | null;
  directory: string;
  origin: string;
  homePath?: string | null;
  homeAgent?: string | null;
  apps: Record<string, boolean>;
  source: {
    repoOwner?: string | null;
    repoName?: string | null;
    sourceUrl?: string | null;
  };
  contentHash?: string | null;
  installedAt: number;
  updatedAt: number;
  archivedAt?: number;
  starred: boolean;
  isMine: boolean;
}

export type DoctorStatus = "ok" | "warn" | "error";

export interface DoctorCheck {
  id: string;
  status: DoctorStatus;
  message: string;
  path?: string;
  expected?: string;
  actual?: string;
}

export interface DoctorReport {
  status: DoctorStatus;
  checks: DoctorCheck[];
}

export type DoctorFixActionStatus = "planned" | "applied" | "skipped" | "failed";

export interface DoctorFixAction {
  kind: "rebuild-cache" | "replace-link";
  status: DoctorFixActionStatus;
  message: string;
  path?: string;
  target?: string;
  error?: string;
}

export interface DoctorFixResult {
  dryRun: boolean;
  before: DoctorReport;
  actions: DoctorFixAction[];
  after: DoctorReport;
}

export async function inspectInstalledSkill(home: string | undefined, ref: string): Promise<InspectSkillData> {
  const skill = resolveOneSkillRef(await scanInstalledSkills(home), ref);
  return inspectData("installed", skill);
}

export async function inspectArchivedSkill(home: string | undefined, archiveId: string): Promise<InspectSkillData> {
  const manifest = await readArchiveManifest(home);
  const skill = manifest.skills[archiveId];
  if (!skill) {
    throw new CliError(`Archived skill not found: ${archiveId}`);
  }
  return inspectData("archived", skill);
}

export async function runDoctor(home?: string): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const paths = getPaths(home);
  const lock = await readLock(home).catch((error: unknown) => {
    checks.push({
      id: "lock-readable",
      status: "error",
      message: `Cannot read lock file: ${messageFromError(error)}`,
      path: paths.agentLockFile,
    });
    return undefined;
  });
  const manifest = await readArchiveManifest(home).catch((error: unknown) => {
    checks.push({
      id: "archive-manifest-readable",
      status: "error",
      message: `Cannot read archive manifest: ${messageFromError(error)}`,
      path: paths.archiveManifestFile,
    });
    return undefined;
  });

  if (lock && manifest) {
    try {
      assertWritableSchema(lock, manifest);
      checks.push({ id: "schema-version", status: "ok", message: "Local protocol schema is supported." });
    } catch (error) {
      checks.push({ id: "schema-version", status: "error", message: messageFromError(error) });
    }
  }

  if (manifest) {
    await checkArchiveDirs(home, manifest.skills, checks);
  }

  await checkInstalledSkills(home, checks);
  await checkCacheFreshness(home, checks);

  return {
    status: summarizeStatus(checks),
    checks,
  };
}

export async function fixDoctor(home: string | undefined, options: { dryRun?: boolean } = {}): Promise<DoctorFixResult> {
  const dryRun = Boolean(options.dryRun);
  const before = await runDoctor(home);
  const actions: DoctorFixAction[] = [];

  await planAndApplyLinkFixes(before, actions, dryRun);
  await planAndApplyCacheFix(home, before, actions, dryRun);

  return {
    dryRun,
    before,
    actions,
    after: dryRun ? before : await runDoctor(home),
  };
}

function inspectData(kind: InspectKind, skill: InstalledSkill | ArchivedSkill): InspectSkillData {
  const archived = "archiveId" in skill ? skill : undefined;
  return {
    kind,
    id: skill.id,
    archiveId: archived?.archiveId,
    originalSkillId: archived?.originalSkillId,
    name: skill.name,
    yamlName: skill.yamlName,
    description: skill.description,
    directory: skill.directory,
    origin: skill.origin,
    homePath: skill.homePath,
    homeAgent: skill.homeAgent,
    apps: skill.apps,
    source: {
      repoOwner: skill.repoOwner,
      repoName: skill.repoName,
      sourceUrl: skill.sourceUrl,
    },
    contentHash: skill.contentHash,
    installedAt: skill.installedAt,
    updatedAt: skill.updatedAt,
    archivedAt: archived?.archivedAt,
    starred: skill.starred,
    isMine: skill.isMine,
  };
}

async function checkArchiveDirs(
  home: string | undefined,
  archived: Record<string, ArchivedSkill>,
  checks: DoctorCheck[],
): Promise<void> {
  for (const archiveId of Object.keys(archived)) {
    const archiveDir = path.join(getPaths(home).archiveSkillsDir, archiveId);
    if (await pathExists(archiveDir)) {
      checks.push({
        id: "archive-directory",
        status: "ok",
        message: `Archived skill directory exists: ${archiveId}`,
        path: archiveDir,
      });
    } else {
      checks.push({
        id: "archive-directory",
        status: "error",
        message: `Archived skill directory is missing: ${archiveId}`,
        path: archiveDir,
      });
    }
  }
}

async function checkInstalledSkills(home: string | undefined, checks: DoctorCheck[]): Promise<void> {
  let skills: InstalledSkill[];
  try {
    skills = await scanInstalledSkills(home);
  } catch (error) {
    checks.push({
      id: "installed-scan",
      status: "error",
      message: `Cannot scan installed skills: ${messageFromError(error)}`,
    });
    return;
  }

  const contestedLinks = await findContestedAgentLinks(home, skills);
  for (const link of contestedLinks.values()) {
    checks.push({
      id: "contested-agent-link",
      status: "warn",
      message: `Agent link is shared by multiple different skills and cannot be safely repaired: ${link.path}`,
      path: link.path,
      actual: link.skillIds.join(", "),
    });
  }

  for (const skill of skills) {
    await checkSkillHome(skill, checks);
    await checkSkillAgentLinks(home, skill, checks, contestedLinks);
  }
}

interface ContestedAgentLink {
  path: string;
  skillIds: string[];
}

async function findContestedAgentLinks(
  home: string | undefined,
  skills: InstalledSkill[],
): Promise<Map<string, ContestedAgentLink>> {
  const candidates = new Map<string, Map<string, Set<string>>>();

  for (const skill of skills) {
    if (!skill.homePath) {
      continue;
    }

    for (const agent of AGENTS) {
      const agentDir = getAgentSkillsDir(home, agent.id);
      if (!agentDir || (await pathStartsWith(skill.homePath, agentDir))) {
        continue;
      }

      const linkPath = path.join(agentDir, agentLinkName(skill.directory));
      if (!(await pathExists(linkPath)) || !(await isSymlinkOrJunction(linkPath))) {
        continue;
      }

      const byTarget = candidates.get(linkPath) ?? new Map<string, Set<string>>();
      const skillIds = byTarget.get(skill.homePath) ?? new Set<string>();
      skillIds.add(skill.id);
      byTarget.set(skill.homePath, skillIds);
      candidates.set(linkPath, byTarget);
    }
  }

  const contested = new Map<string, ContestedAgentLink>();
  for (const [linkPath, byTarget] of candidates) {
    if (byTarget.size <= 1) {
      continue;
    }
    contested.set(linkPath, {
      path: linkPath,
      skillIds: [...byTarget.values()].flatMap((ids) => [...ids]),
    });
  }

  return contested;
}

async function checkSkillHome(skill: InstalledSkill, checks: DoctorCheck[]): Promise<void> {
  if (!skill.homePath) {
    checks.push({
      id: "skill-home-path",
      status: "error",
      message: `Skill has no home path: ${skill.id}`,
    });
    return;
  }

  if (!(await pathExists(skill.homePath))) {
    checks.push({
      id: "skill-home-path",
      status: "error",
      message: `Skill home path is missing: ${skill.id}`,
      path: skill.homePath,
    });
    return;
  }

  if (await isSymlinkOrJunction(skill.homePath)) {
    checks.push({
      id: "skill-home-path",
      status: "error",
      message: `Skill home path is a symlink, not the physical skill directory: ${skill.id}`,
      path: skill.homePath,
    });
  }
}

async function checkSkillAgentLinks(
  home: string | undefined,
  skill: InstalledSkill,
  checks: DoctorCheck[],
  contestedLinks: Map<string, ContestedAgentLink>,
): Promise<void> {
  if (!skill.homePath) {
    return;
  }

  for (const agent of AGENTS) {
    const agentDir = getAgentSkillsDir(home, agent.id);
    if (!agentDir) {
      continue;
    }

    const linkPath = path.join(agentDir, agentLinkName(skill.directory));
    if (await pathStartsWith(skill.homePath, agentDir)) {
      continue;
    }
    if (contestedLinks.has(linkPath)) {
      continue;
    }

    const exists = await pathExists(linkPath);
    if (!exists) {
      if (skill.apps[agent.id]) {
        checks.push({
          id: "agent-link",
          status: "warn",
          message: `Enabled agent link is missing: ${skill.id} -> ${agent.id}`,
          path: linkPath,
          expected: skill.homePath,
        });
      }
      continue;
    }

    if (!(await isSymlinkOrJunction(linkPath))) {
      // A real agent-native directory with the same name is a content consistency
      // issue, not a doctor repair target. Consistency reports decide whether it
      // is a duplicate or conflict without moving user files.
      continue;
    }

    if (!(await pathsEqual(linkPath, skill.homePath))) {
      checks.push({
        id: "agent-link",
        status: "error",
        message: `Agent link points at the wrong target: ${skill.id} -> ${agent.id}`,
        path: linkPath,
        expected: skill.homePath,
      });
    }
  }
}

async function checkCacheFreshness(home: string | undefined, checks: DoctorCheck[]): Promise<void> {
  try {
    const [cache, scanned] = await Promise.all([readCache(home), scanCacheEntries(home)]);
    const cached = new Set(cache.skills.map(cacheFingerprint));
    const scannedFresh = new Set(scanned.map(cacheFingerprint));
    if (setsEqual(cached, scannedFresh)) {
      checks.push({ id: "cache-freshness", status: "ok", message: "Skill cache matches filesystem scan." });
      return;
    }

    checks.push({
      id: "cache-freshness",
      status: "warn",
      message: "Skill cache differs from filesystem scan. Run `skill-zoo refresh`.",
      expected: String(scannedFresh.size),
      actual: String(cached.size),
    });
  } catch (error) {
    checks.push({
      id: "cache-freshness",
      status: "error",
      message: `Cannot compare skill cache with filesystem scan: ${messageFromError(error)}`,
      path: getPaths(home).skillsCacheFile,
    });
  }
}

function cacheFingerprint(skill: { id: string; contentHash?: string | null }): string {
  return `${skill.id}:${skill.contentHash ?? ""}`;
}

function summarizeStatus(checks: DoctorCheck[]): DoctorStatus {
  if (checks.some((check) => check.status === "error")) {
    return "error";
  }
  if (checks.some((check) => check.status === "warn")) {
    return "warn";
  }
  return "ok";
}

async function planAndApplyLinkFixes(
  report: DoctorReport,
  actions: DoctorFixAction[],
  dryRun: boolean,
): Promise<void> {
  for (const check of report.checks) {
    if (check.id !== "agent-link" || check.status !== "error" || !check.path || !check.expected) {
      continue;
    }

    const action: DoctorFixAction = {
      kind: "replace-link",
      status: dryRun ? "planned" : "applied",
      message: dryRun ? "Would replace invalid agent link." : "Replaced invalid agent link.",
      path: check.path,
      target: check.expected,
    };

    try {
      if (!(await isSymlinkOrJunction(check.path))) {
        action.status = "skipped";
        action.message = "Skipped non-symlink agent path; report it with consistency instead.";
      } else if (!(await pathExists(check.expected))) {
        action.status = "failed";
        action.message = "Cannot replace agent link because the expected target is missing.";
        action.error = `Missing target: ${check.expected}`;
      } else if (!dryRun) {
        await createAgentLink(check.path, check.expected);
      }
    } catch (error) {
      action.status = "failed";
      action.message = "Failed to replace invalid agent link.";
      action.error = messageFromError(error);
    }

    actions.push(action);
  }
}

async function planAndApplyCacheFix(
  home: string | undefined,
  report: DoctorReport,
  actions: DoctorFixAction[],
  dryRun: boolean,
): Promise<void> {
  const staleCache = report.checks.some((check) => check.id === "cache-freshness" && check.status === "warn");
  if (!staleCache) {
    return;
  }

  const action: DoctorFixAction = {
    kind: "rebuild-cache",
    status: dryRun ? "planned" : "applied",
    message: dryRun ? "Would rebuild stale skill cache." : "Rebuilt stale skill cache.",
    path: getPaths(home).skillsCacheFile,
  };

  try {
    if (!dryRun) {
      await rebuildCache(home);
    }
  } catch (error) {
    action.status = "failed";
    action.message = "Failed to rebuild stale skill cache.";
    action.error = messageFromError(error);
  }

  actions.push(action);
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

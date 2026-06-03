import path from "node:path";
import { AGENTS } from "./agents.js";
import { getAgentSkillsDir, getPaths } from "./paths.js";
import { resolveOneSkillRef } from "./refs.js";
import { scanCacheEntries, scanInstalledSkills } from "./scan.js";
import { assertWritableSchema, readArchiveManifest, readCache, readLock } from "./store.js";
import type { ArchivedSkill, InstalledSkill } from "./types.js";
import { CliError, messageFromError } from "../lib/errors.js";
import {
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

  for (const skill of skills) {
    await checkSkillHome(skill, checks);
    await checkSkillAgentLinks(home, skill, checks);
  }
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
): Promise<void> {
  if (!skill.homePath) {
    return;
  }

  for (const agent of AGENTS) {
    const agentDir = getAgentSkillsDir(home, agent.id);
    if (!agentDir) {
      continue;
    }

    const linkPath = path.join(agentDir, skill.directory);
    if (await pathStartsWith(skill.homePath, agentDir)) {
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
      checks.push({
        id: "agent-link",
        status: "error",
        message: `Agent skill path exists but is not a symlink: ${skill.id} -> ${agent.id}`,
        path: linkPath,
        expected: skill.homePath,
      });
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

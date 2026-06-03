import path from "node:path";
import crypto from "node:crypto";
import { AGENTS } from "./agents.js";
import { getAgentSkillsDir, getPaths } from "./paths.js";
import {
  assertWritableSchema,
  readArchiveManifest,
  readLock,
  readMetadata,
  writeArchiveManifest,
  writeLock,
  writeMetadata,
} from "./store.js";
import { rebuildCache, scanInstalledSkills } from "./scan.js";
import type {
  ArchivedSkill,
  BatchFailure,
  Change,
  InstalledSkill,
  SkillLockEntry,
} from "./types.js";
import { CLI_VERSION } from "../version.js";
import { CliError, messageFromError } from "../lib/errors.js";
import {
  createAgentLink,
  ensureDir,
  isSymlinkOrJunction,
  movePath,
  pathExists,
  pathsEqual,
  removeAgentLink,
  removePath,
  snapshotFile,
  restoreSnapshot,
} from "../lib/io.js";

export interface ArchiveOptions {
  dryRun?: boolean;
}

export interface ArchiveResult {
  archived: string[];
  failed: BatchFailure[];
  changes: Change[];
}

export interface RestoreResult {
  restored: string[];
  failed: BatchFailure[];
  changes: Change[];
}

type ResolvedSkillRef = { ref: string; skill: InstalledSkill } | { ref: string; error: string };

export async function listArchivedSkills(home?: string): Promise<ArchivedSkill[]> {
  const manifest = await readArchiveManifest(home);
  return Object.values(manifest.skills).sort((left, right) => {
    const timeDelta = right.archivedAt - left.archivedAt;
    return timeDelta === 0 ? left.name.localeCompare(right.name) : timeDelta;
  });
}

export async function archiveSkillRefs(
  home: string | undefined,
  refs: string[],
  options: ArchiveOptions = {},
): Promise<ArchiveResult> {
  const installed = await scanInstalledSkills(home);
  const resolved = resolveSkillRefs(installed, refs);
  const result: ArchiveResult = { archived: [], failed: [], changes: [] };
  const schemaError = await getWritableSchemaError(home);

  for (const item of resolved) {
    try {
      if (!("skill" in item)) {
        result.failed.push({ ref: item.ref, error: item.error });
        continue;
      }
      if (schemaError) {
        result.failed.push({ ref: item.ref, error: schemaError.message });
        continue;
      }

      const changes = await planArchive(home, item.skill);
      result.changes.push(...changes);
      if (!options.dryRun) {
        await archiveOne(home, item.skill);
      }
      result.archived.push(item.skill.id);
    } catch (error) {
      result.failed.push({ ref: item.ref, error: messageFromError(error) });
    }
  }

  return result;
}

export async function restoreArchiveIds(
  home: string | undefined,
  archiveIds: string[],
  options: ArchiveOptions = {},
): Promise<RestoreResult> {
  const result: RestoreResult = { restored: [], failed: [], changes: [] };
  const schemaError = await getWritableSchemaError(home);

  for (const archiveId of archiveIds) {
    try {
      validateSimpleId(archiveId, "archive id");
      if (schemaError) {
        result.failed.push({ ref: archiveId, error: schemaError.message });
        continue;
      }
      const changes = await planRestore(home, archiveId);
      result.changes.push(...changes);
      if (!options.dryRun) {
        await restoreOne(home, archiveId);
      }
      result.restored.push(archiveId);
    } catch (error) {
      result.failed.push({ ref: archiveId, error: messageFromError(error) });
    }
  }

  return result;
}

export function makeArchiveId(skillId: string, directory: string): string {
  const shortHash = crypto.createHash("sha256").update(skillId).digest("hex").slice(0, 8);
  const safeName =
    directory
      .split(/[\\/]/)
      .at(-1)
      ?.replace(/[^a-zA-Z0-9_.-]/g, "-") || "skill";
  return `${safeName}-${shortHash}`;
}

async function planArchive(home: string | undefined, skill: InstalledSkill): Promise<Change[]> {
  const homePath = skill.homePath;
  if (!homePath || !(await pathExists(homePath)) || (await isSymlinkOrJunction(homePath))) {
    throw new CliError(`Skill home path is not an archiveable directory: ${homePath ?? "(missing)"}`);
  }

  const archiveId = makeArchiveId(skill.id, skill.directory);
  validateSimpleId(archiveId, "archive id");
  const archiveDir = path.join(getPaths(home).archiveSkillsDir, archiveId);
  if (await pathExists(archiveDir)) {
    throw new CliError(`Cannot archive ${skill.name}: archive destination already exists at ${archiveDir}`);
  }

  const manifest = await readArchiveManifest(home);
  if (manifest.skills[archiveId]) {
    throw new CliError(`Skill is already archived: ${skill.name}`);
  }

  const changes: Change[] = [{ action: "move", path: homePath, target: archiveDir }];
  for (const [agent, enabled] of Object.entries(skill.apps)) {
    if (!enabled) {
      continue;
    }
    const agentDir = getAgentSkillsDir(home, agent);
    if (!agentDir) {
      continue;
    }
    const linkPath = path.join(agentDir, skill.directory);
    if (await isSymlinkOrJunction(linkPath)) {
      changes.push({ action: "remove-link", path: linkPath });
    }
  }
  changes.push({ action: "write", path: getPaths(home).archiveManifestFile });
  changes.push({ action: "write", path: getPaths(home).agentLockFile });
  changes.push({ action: "write", path: getPaths(home).metadataFile });
  changes.push({ action: "write", path: getPaths(home).skillsCacheFile });
  return changes;
}

async function archiveOne(home: string | undefined, skill: InstalledSkill): Promise<void> {
  const paths = getPaths(home);
  const homePath = skill.homePath;
  if (!homePath) {
    throw new CliError("Skill has no physical home path, cannot archive");
  }

  const lock = await readLock(home);
  const manifest = await readArchiveManifest(home);
  assertWritableSchema(lock, manifest);

  const snapshots = await Promise.all([
    snapshotFile(paths.archiveManifestFile),
    snapshotFile(paths.agentLockFile),
    snapshotFile(paths.metadataFile),
    snapshotFile(paths.skillsCacheFile),
  ]);
  const archiveId = makeArchiveId(skill.id, skill.directory);
  const archiveDir = path.join(paths.archiveSkillsDir, archiveId);
  const lockKey = lock.skills[skill.directory] ? skill.directory : lock.skills[skill.name] ? skill.name : null;
  const lockEntry = lockKey ? structuredClone(lock.skills[lockKey]) : null;
  const removedAgents: string[] = [];

  try {
    await planArchive(home, skill);

    manifest.skills[archiveId] = makeArchivedSkill(skill, archiveId, lockKey, lockEntry);
    await writeArchiveManifest(home, manifest);
    await movePath(homePath, archiveDir);

    for (const [agent, enabled] of Object.entries(skill.apps)) {
      if (!enabled) {
        continue;
      }
      const agentDir = getAgentSkillsDir(home, agent);
      if (!agentDir) {
        continue;
      }
      const linkPath = path.join(agentDir, skill.directory);
      if (await removeAgentLink(linkPath)) {
        removedAgents.push(agent);
      }
    }

    if (lockKey) {
      delete lock.skills[lockKey];
      await writeLock(home, lock);
    }

    const metadata = await readMetadata(home);
    delete metadata.entries[skill.id];
    await writeMetadata(home, metadata);
    await rebuildCache(home);
  } catch (error) {
    await rollbackArchive(home, skill, homePath, archiveDir, removedAgents, snapshots);
    throw error;
  }
}

async function planRestore(home: string | undefined, archiveId: string): Promise<Change[]> {
  const manifest = await readArchiveManifest(home);
  const archived = manifest.skills[archiveId];
  if (!archived) {
    throw new CliError(`Archived skill not found: ${archiveId}`);
  }

  const archiveDir = path.join(getPaths(home).archiveSkillsDir, archiveId);
  if (!(await pathExists(archiveDir))) {
    throw new CliError(`Archived directory is missing: ${archiveDir}`);
  }

  const restorePath = getRestorePath(home, archived);
  if (await pathExists(restorePath)) {
    throw new CliError(`Cannot restore: destination already exists at ${restorePath}`);
  }

  const changes: Change[] = [{ action: "move", path: archiveDir, target: restorePath }];
  for (const [agent, enabled] of Object.entries(archived.apps)) {
    if (!enabled) {
      continue;
    }
    const agentDir = getAgentSkillsDir(home, agent);
    if (!agentDir || !(await pathExists(agentDir))) {
      continue;
    }

    const linkPath = path.join(agentDir, archived.directory);
    if (path.resolve(linkPath) === path.resolve(restorePath)) {
      continue;
    }

    if ((await pathExists(linkPath)) && !(await isSymlinkOrJunction(linkPath))) {
      if (await pathsEqual(linkPath, restorePath)) {
        continue;
      }
      throw new CliError(
        `Restore agent link failed: destination already exists at ${linkPath} and is a real directory, not a symlink.`,
      );
    }

    changes.push({ action: "create-link", path: linkPath, target: restorePath });
  }
  changes.push({ action: "write", path: getPaths(home).archiveManifestFile });
  changes.push({ action: "write", path: getPaths(home).agentLockFile });
  changes.push({ action: "write", path: getPaths(home).metadataFile });
  changes.push({ action: "write", path: getPaths(home).skillsCacheFile });
  return changes;
}

async function restoreOne(home: string | undefined, archiveId: string): Promise<void> {
  const paths = getPaths(home);
  const lock = await readLock(home);
  const manifest = await readArchiveManifest(home);
  assertWritableSchema(lock, manifest);

  const archived = manifest.skills[archiveId];
  if (!archived) {
    throw new CliError(`Archived skill not found: ${archiveId}`);
  }

  const archiveDir = path.join(paths.archiveSkillsDir, archiveId);
  const restorePath = getRestorePath(home, archived);
  const snapshots = await Promise.all([
    snapshotFile(paths.archiveManifestFile),
    snapshotFile(paths.agentLockFile),
    snapshotFile(paths.metadataFile),
    snapshotFile(paths.skillsCacheFile),
  ]);
  const restoredAgents: string[] = [];

  try {
    await planRestore(home, archiveId);
    await ensureDir(path.dirname(restorePath));
    await movePath(archiveDir, restorePath);

    if (archived.lockEntry) {
      lock.skills[archived.lockKey ?? archived.directory] = archived.lockEntry;
      await writeLock(home, lock);
    }

    const metadata = await readMetadata(home);
    if (archived.starred || archived.isMine) {
      metadata.entries[archived.originalSkillId] = {
        starred: archived.starred,
        isMine: archived.isMine,
      };
    } else {
      delete metadata.entries[archived.originalSkillId];
    }
    await writeMetadata(home, metadata);

    for (const [agent, enabled] of Object.entries(archived.apps)) {
      if (!enabled) {
        continue;
      }
      const agentDir = getAgentSkillsDir(home, agent);
      if (!agentDir || !(await pathExists(agentDir))) {
        continue;
      }

      const linkPath = path.join(agentDir, archived.directory);
      if ((await pathExists(linkPath)) && !(await isSymlinkOrJunction(linkPath))) {
        if (await pathsEqual(linkPath, restorePath)) {
          continue;
        }
        throw new CliError(
          `Restore agent link failed: destination already exists at ${linkPath} and is a real directory, not a symlink.`,
        );
      }

      await createAgentLink(linkPath, restorePath);
      restoredAgents.push(agent);
    }

    delete manifest.skills[archiveId];
    await writeArchiveManifest(home, manifest);
    await rebuildCache(home);
  } catch (error) {
    await rollbackRestore(home, archived, archiveDir, restorePath, restoredAgents, snapshots);
    throw error;
  }
}

function makeArchivedSkill(
  skill: InstalledSkill,
  archiveId: string,
  lockKey: string | null,
  lockEntry: SkillLockEntry | null,
): ArchivedSkill {
  return {
    ...skill,
    id: archiveId,
    archiveId,
    originalSkillId: skill.id,
    archivedAt: Math.floor(Date.now() / 1000),
    lockKey,
    lockEntry,
    archivedByVersion: `skill-zoo-cli@${CLI_VERSION}`,
    reason: null,
  };
}

async function getWritableSchemaError(home: string | undefined): Promise<CliError | undefined> {
  try {
    assertWritableSchema(await readLock(home), await readArchiveManifest(home));
    return undefined;
  } catch (error) {
    if (error instanceof CliError) {
      return error;
    }
    throw error;
  }
}

function getRestorePath(home: string | undefined, archived: ArchivedSkill): string {
  if (archived.homePath) {
    return archived.homePath;
  }

  if (archived.origin === "ssot") {
    return path.join(getPaths(home).agentsSkillsDir, archived.directory);
  }

  const homeAgentDir = archived.homeAgent ? getAgentSkillsDir(home, archived.homeAgent) : undefined;
  return path.join(homeAgentDir ?? getPaths(home).agentsSkillsDir, archived.directory);
}

function resolveSkillRefs(skills: InstalledSkill[], refs: string[]): ResolvedSkillRef[] {
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

async function rollbackArchive(
  home: string | undefined,
  skill: InstalledSkill,
  homePath: string,
  archiveDir: string,
  removedAgents: string[],
  snapshots: Awaited<ReturnType<typeof snapshotFile>>[],
): Promise<void> {
  if ((await pathExists(archiveDir)) && !(await pathExists(homePath))) {
    await movePath(archiveDir, homePath).catch(() => undefined);
  }

  for (const agent of removedAgents) {
    const agentDir = getAgentSkillsDir(home, agent);
    if (agentDir) {
      await createAgentLink(path.join(agentDir, skill.directory), homePath).catch(() => undefined);
    }
  }

  await Promise.all(snapshots.map((snapshot) => restoreSnapshot(snapshot).catch(() => undefined)));
}

async function rollbackRestore(
  home: string | undefined,
  archived: ArchivedSkill,
  archiveDir: string,
  restorePath: string,
  restoredAgents: string[],
  snapshots: Awaited<ReturnType<typeof snapshotFile>>[],
): Promise<void> {
  for (const agent of restoredAgents) {
    const agentDir = getAgentSkillsDir(home, agent);
    if (agentDir) {
      await removePath(path.join(agentDir, archived.directory)).catch(() => undefined);
    }
  }

  if ((await pathExists(restorePath)) && !(await pathExists(archiveDir))) {
    await movePath(restorePath, archiveDir).catch(() => undefined);
  }

  await Promise.all(snapshots.map((snapshot) => restoreSnapshot(snapshot).catch(() => undefined)));
}

function validateSimpleId(value: string, label: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value)) {
    throw new CliError(`Invalid ${label}`);
  }
}

export function enabledAgentIds(skill: InstalledSkill | ArchivedSkill): string[] {
  return AGENTS.filter((agent) => skill.apps[agent.id]).map((agent) => agent.id);
}

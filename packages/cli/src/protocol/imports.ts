import crypto from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";
import { CliError } from "../lib/errors.js";
import {
  createAgentLink,
  isSymlinkOrJunction,
  lstatSafe,
  normalizePath,
  pathExists,
  pathsEqual,
  pathStartsWith,
  removeAgentLink,
  restoreSnapshot,
  snapshotFile,
} from "../lib/io.js";
import { AGENTS, SKIP_DIRS } from "./agents.js";
import { getAgentSkillsDir, getPaths, agentLinkName } from "./paths.js";
import { parseSkillMd, rebuildCache } from "./scan.js";
import {
  assertWritableSchema,
  readArchiveManifest,
  readExternalImports,
  readLock,
  writeExternalImports,
} from "./store.js";
import type { BatchFailure, Change, ExternalImportEntry } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ImportStatus = "valid" | "source-missing" | "skill-missing";

export interface ExternalImportInfo {
  id: string;
  sourcePath: string;
  directory: string;
  name: string;
  description: string | null;
  status: ImportStatus;
  linkedAgents: string[];
  importedAt: number;
  updatedAt: number;
}

export interface ExternalImportCandidate {
  sourcePath: string;
  directory: string;
  name: string;
  description: string | null;
  alreadyImported: boolean;
}

export interface ImportOptions {
  dryRun?: boolean;
}

export interface ImportAddResult {
  added: string[];
  failed: BatchFailure[];
  changes: Change[];
}

export interface ImportRemoveResult {
  removed: string[];
  failed: BatchFailure[];
  changes: Change[];
}

export interface ImportCleanResult {
  cleaned: string[];
  failed: BatchFailure[];
  changes: Change[];
}

// ---------------------------------------------------------------------------
// listExternalImports
// ---------------------------------------------------------------------------

export async function listExternalImports(home?: string): Promise<ExternalImportInfo[]> {
  const imports = await readExternalImports(home);

  const results: ExternalImportInfo[] = [];
  for (const entry of Object.values(imports.imports)) {
    const info = await buildImportInfo(home, entry);
    results.push(info);
  }

  results.sort(byStatusThenName);
  return results;
}

async function buildImportInfo(
  home: string | undefined,
  entry: ExternalImportEntry,
): Promise<ExternalImportInfo> {
  const sourcePath = entry.sourcePath;
  const sourceExists = await pathExists(sourcePath);
  const skillMdPath = path.join(sourcePath, "SKILL.md");
  const skillMdExists = sourceExists && (await pathExists(skillMdPath));

  let status: ImportStatus;
  let name: string;
  let description: string | null = null;

  if (!sourceExists) {
    status = "source-missing";
    name = path.basename(sourcePath);
  } else if (!skillMdExists) {
    status = "skill-missing";
    name = path.basename(sourcePath);
  } else {
    status = "valid";
    const parsed = await parseSkillMd(skillMdPath, path.basename(sourcePath));
    name = parsed.name === path.basename(sourcePath) ? path.basename(sourcePath) : parsed.name;
    description = parsed.description ?? null;
  }

  const linkedAgents = await detectLinkedAgents(home, entry.directory, sourcePath);

  return {
    id: entry.id,
    sourcePath: entry.sourcePath,
    directory: entry.directory,
    name,
    description,
    status,
    linkedAgents,
    importedAt: entry.importedAt,
    updatedAt: entry.updatedAt,
  };
}

async function detectLinkedAgents(
  home: string | undefined,
  directory: string,
  sourcePath: string,
): Promise<string[]> {
  const linked: string[] = [];
  const resolvedSource = path.resolve(sourcePath);

  for (const agent of AGENTS) {
    const agentDir = getAgentSkillsDir(home, agent.id);
    if (!agentDir) continue;

    const linkPath = path.join(agentDir, agentLinkName(directory));
    if (!(await isSymlinkOrJunction(linkPath))) continue;

    // Try pathsEqual first (works for valid symlinks)
    if (await pathsEqual(linkPath, sourcePath)) {
      linked.push(agent.id);
      continue;
    }

    // Fallback for dangling symlinks: compare readlink target
    try {
      const rawTarget = await fs.readlink(linkPath);
      const resolvedTarget = path.resolve(path.dirname(linkPath), rawTarget);
      if (resolvedTarget === resolvedSource) {
        linked.push(agent.id);
      }
    } catch {
      // Can't readlink, skip
    }
  }
  return linked;
}

function byStatusThenName(a: ExternalImportInfo, b: ExternalImportInfo): number {
  const order: Record<ImportStatus, number> = { valid: 0, "skill-missing": 1, "source-missing": 2 };
  const diff = order[a.status] - order[b.status];
  return diff !== 0 ? diff : a.name.localeCompare(b.name);
}

// ---------------------------------------------------------------------------
// scanExternalImportFolder
// ---------------------------------------------------------------------------

export async function scanExternalImportFolder(
  home: string | undefined,
  folderPath: string,
): Promise<ExternalImportCandidate[]> {
  const root = path.resolve(folderPath);
  const stat = await lstatSafe(root);
  if (!stat?.isDirectory()) {
    throw new CliError(`Path is not a directory: ${root}`);
  }

  await assertOutsideSkillRoots(home, root);

  const imports = await readExternalImports(home);
  const knownSources = new Set<string>();
  for (const entry of Object.values(imports.imports)) {
    try {
      const resolved = path.resolve(entry.sourcePath);
      knownSources.add(resolved);
    } catch {
      // If the stored path can't be resolved, skip it
    }
  }

  const candidates: ExternalImportCandidate[] = [];

  // Check if root itself has a SKILL.md (single-skill case)
  const rootSkillMd = path.join(root, "SKILL.md");
  if (await pathExists(rootSkillMd)) {
    const dirName = path.basename(root);
    const parsed = await parseSkillMd(rootSkillMd, dirName);
    candidates.push({
      sourcePath: root,
      directory: dirName,
      name: parsed.name === dirName ? dirName : parsed.name,
      description: parsed.description ?? null,
      alreadyImported: knownSources.has(path.resolve(root)),
    });
  } else {
    await collectCandidates(root, root, knownSources, candidates);
  }

  candidates.sort((a, b) => a.directory.localeCompare(b.directory));
  return candidates;
}

async function collectCandidates(
  root: string,
  currentDir: string,
  knownSources: Set<string>,
  candidates: ExternalImportCandidate[],
): Promise<void> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true }).catch(() => []);
  for (const dirent of entries) {
    const fullPath = path.join(currentDir, dirent.name);
    if (!dirent.isDirectory()) continue;
    if (SKIP_DIRS.has(dirent.name)) continue;
    if (await isSymlinkOrJunction(fullPath)) continue;

    const skillMdPath = path.join(fullPath, "SKILL.md");
    if (await pathExists(skillMdPath)) {
      const dirName = path.basename(fullPath);
      const parsed = await parseSkillMd(skillMdPath, dirName);
      const resolved = path.resolve(fullPath);
      candidates.push({
        sourcePath: fullPath,
        directory: path.relative(root, fullPath) || dirName,
        name: parsed.name === dirName ? dirName : parsed.name,
        description: parsed.description ?? null,
        alreadyImported: knownSources.has(resolved),
      });
    } else {
      await collectCandidates(root, fullPath, knownSources, candidates);
    }
  }
}

async function assertOutsideSkillRoots(home: string | undefined, target: string): Promise<void> {
  const paths = getPaths(home);
  const roots = [paths.agentsSkillsDir, ...AGENTS.map((agent) => getAgentSkillsDir(home, agent.id)).filter(Boolean) as string[]];

  for (const root of roots) {
    const resolvedRoot = path.resolve(root);
    if ((await pathStartsWith(target, resolvedRoot)) || path.resolve(target) === resolvedRoot) {
      throw new CliError(
        `Path is inside a managed skill root (${resolvedRoot}). External imports must be outside agent and SSOT skill directories.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// importExternalSkills
// ---------------------------------------------------------------------------

export async function importExternalSkills(
  home: string | undefined,
  sourcePaths: string[],
  agents: string[],
  options: ImportOptions = {},
): Promise<ImportAddResult> {
  const added: string[] = [];
  const failed: BatchFailure[] = [];
  const changes: Change[] = [];

  if (sourcePaths.length === 0) {
    throw new CliError("At least one source path is required.");
  }

  if (agents.length === 0) {
    throw new CliError("At least one agent is required.");
  }

  for (const agentId of agents) {
    if (!AGENTS.some((a) => a.id === agentId)) {
      throw new CliError(`Unknown agent: ${agentId}.`);
    }
  }

  const allAgentDirs = agents
    .map((id) => ({ id, dir: getAgentSkillsDir(home, id) }))
    .filter((a) => a.dir != null) as { id: string; dir: string }[];

  const paths = getPaths(home);
  const lock = await readLock(home);
  const manifest = await readArchiveManifest(home);
  const existingImports = await readExternalImports(home);
  assertWritableSchema(lock, manifest, existingImports);

  // Build a map of resolved source paths to existing import IDs (for reuse on re-import)
  const resolvedToId = new Map<string, string>();
  for (const entry of Object.values(existingImports.imports)) {
    try {
      resolvedToId.set(path.resolve(entry.sourcePath), entry.id);
    } catch {
      // skip unresolvable paths
    }
  }

  // If dry-run, we still want to plan but not write
  if (options.dryRun) {
    for (const sourcePath of sourcePaths) {
      const absSource = path.resolve(sourcePath);
      try {
        await validateSourceForImport(home, absSource, sourcePath);
        const importId = resolvedToId.get(absSource) ?? generateImportId(absSource);
        const directory = path.basename(absSource);

        for (const { dir: agentDir } of allAgentDirs) {
          const linkPath = path.join(agentDir, agentLinkName(directory));
          changes.push({ action: "create-link", path: linkPath, target: absSource });
        }
        changes.push({ action: "write", path: paths.externalImportsFile });
        changes.push({ action: "write", path: paths.skillsCacheFile });
        added.push(importId);
      } catch (error) {
        failed.push({ ref: sourcePath, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { added, failed, changes };
  }

  // Real execution with rollback
  const snapshots = await Promise.all([
    snapshotFile(paths.externalImportsFile),
    snapshotFile(paths.skillsCacheFile),
  ]);

  const createdLinks: string[] = [];
  const newImportIds: string[] = [];

  try {
    for (const sourcePath of sourcePaths) {
      const absSource = path.resolve(sourcePath);
      try {
        await validateSourceForImport(home, absSource, sourcePath);

        const importId = resolvedToId.get(absSource) ?? generateImportId(absSource);
        const directory = path.basename(absSource);
        const now = Math.floor(Date.now() / 1000);

        const entry: ExternalImportEntry = {
          id: importId,
          sourcePath: normalizePath(absSource),
          directory,
          importedAt: now,
          updatedAt: now,
        };

        existingImports.imports[importId] = entry;
        newImportIds.push(importId);

        for (const { dir: agentDir } of allAgentDirs) {
          const linkPath = path.join(agentDir, agentLinkName(directory));
          await createAgentLink(linkPath, absSource);
          createdLinks.push(linkPath);
        }

        added.push(importId);
      } catch (error) {
        failed.push({ ref: sourcePath, error: error instanceof Error ? error.message : String(error) });
      }
    }

    if (newImportIds.length > 0) {
      await writeExternalImports(home, existingImports);
    }
    await rebuildCache(home);
  } catch (error) {
    // Rollback: remove created links, restore snapshots
    await Promise.all(createdLinks.map((linkPath) => removeAgentLink(linkPath).catch(() => undefined)));
    await Promise.all(snapshots.map((snap) => restoreSnapshot(snap).catch(() => undefined)));
    // Also clean up the in-memory map for entries we added
    for (const id of newImportIds) {
      delete existingImports.imports[id];
    }
    throw error;
  }

  // Build changes for reporting
  for (const id of added) {
    const entry = existingImports.imports[id];
    if (!entry) continue;
    for (const { dir: agentDir } of allAgentDirs) {
      const linkPath = path.join(agentDir, agentLinkName(entry.directory));
      changes.push({ action: "create-link", path: linkPath, target: entry.sourcePath });
    }
  }
  changes.push({ action: "write", path: paths.externalImportsFile });
  changes.push({ action: "write", path: paths.skillsCacheFile });

  return { added, failed, changes };
}

async function validateSourceForImport(
  home: string | undefined,
  absSource: string,
  originalPath: string,
): Promise<void> {
  if (!(await pathExists(absSource))) {
    throw new CliError(`Source path does not exist: ${originalPath}`);
  }

  const stat = await lstatSafe(absSource);
  if (!stat?.isDirectory()) {
    throw new CliError(`Source path is not a directory: ${originalPath}`);
  }

  const skillMdPath = path.join(absSource, "SKILL.md");
  if (!(await pathExists(skillMdPath))) {
    throw new CliError(`No SKILL.md found at source path: ${originalPath}`);
  }

  await assertOutsideSkillRoots(home, absSource);
}

function generateImportId(sourcePath: string): string {
  const basename = path.basename(sourcePath);
  const slug = basename.replace(/[^a-zA-Z0-9_.-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "skill";
  const random = crypto.randomBytes(4).toString("hex");
  return `external:${slug}-${random}`;
}

// ---------------------------------------------------------------------------
// removeExternalImport
// ---------------------------------------------------------------------------

export async function removeExternalImport(
  home: string | undefined,
  importId: string,
  options: ImportOptions = {},
): Promise<ImportRemoveResult> {
  const imports = await readExternalImports(home);
  const entry = imports.imports[importId];
  if (!entry) {
    throw new CliError(`External import not found: ${importId}`);
  }

  const lock = await readLock(home);
  const manifest = await readArchiveManifest(home);
  assertWritableSchema(lock, manifest, imports);

  const changes: Change[] = [];
  const linkedAgents = await detectLinkedAgents(home, entry.directory, entry.sourcePath);

  for (const agentId of linkedAgents) {
    const agentDir = getAgentSkillsDir(home, agentId);
    if (!agentDir) continue;
    const linkPath = path.join(agentDir, agentLinkName(entry.directory));
    changes.push({ action: "remove-link", path: linkPath });
  }
  changes.push({ action: "write", path: getPaths(home).externalImportsFile });

  if (options.dryRun) {
    return {
      removed: [importId],
      failed: [],
      changes,
    };
  }

  const snapshots = await Promise.all([
    snapshotFile(getPaths(home).externalImportsFile),
    snapshotFile(getPaths(home).skillsCacheFile),
  ]);

  const removedLinks: string[] = [];
  try {
    for (const agentId of linkedAgents) {
      const agentDir = getAgentSkillsDir(home, agentId);
      if (!agentDir) continue;
      const linkPath = path.join(agentDir, agentLinkName(entry.directory));
      if (await removeAgentLink(linkPath)) {
        removedLinks.push(linkPath);
      }
    }

    delete imports.imports[importId];
    await writeExternalImports(home, imports);
    await rebuildCache(home);
  } catch (error) {
    // Rollback: restore file snapshots and re-create removed symlinks
    await Promise.all(snapshots.map((snap) => restoreSnapshot(snap).catch(() => undefined)));
    await Promise.all(
      removedLinks.map((linkPath) =>
        createAgentLink(linkPath, entry.sourcePath).catch(() => undefined),
      ),
    );
    throw error;
  }

  return {
    removed: [importId],
    failed: [],
    changes,
  };
}

// ---------------------------------------------------------------------------
// cleanExternalImportLinks
// ---------------------------------------------------------------------------

export async function cleanExternalImportLinks(
  home: string | undefined,
  importId?: string,
  options: ImportOptions = {},
): Promise<ImportCleanResult> {
  const imports = await readExternalImports(home);
  const lock = await readLock(home);
  const manifest = await readArchiveManifest(home);
  assertWritableSchema(lock, manifest, imports);

  // Determine which imports to target
  const targets: ExternalImportEntry[] = [];
  if (importId) {
    const entry = imports.imports[importId];
    if (!entry) {
      throw new CliError(`External import not found: ${importId}`);
    }
    targets.push(entry);
  } else {
    // Target all imports whose source is invalid
    for (const entry of Object.values(imports.imports)) {
      const info = await buildImportInfo(home, entry);
      if (info.status !== "valid") {
        targets.push(entry);
      }
    }
  }

  if (targets.length === 0) {
    return { cleaned: [], failed: [], changes: [] };
  }

  const changes: Change[] = [];
  const cleaned: string[] = [];
  const failed: BatchFailure[] = [];

  for (const entry of targets) {
    const linkedAgents = await detectLinkedAgents(home, entry.directory, entry.sourcePath);
    for (const agentId of linkedAgents) {
      const agentDir = getAgentSkillsDir(home, agentId);
      if (!agentDir) continue;
      const linkPath = path.join(agentDir, agentLinkName(entry.directory));
      changes.push({ action: "remove-link", path: linkPath });
    }
    cleaned.push(entry.id);
  }

  if (changes.length === 0) {
    return { cleaned: [], failed: [], changes: [] };
  }

  if (options.dryRun) {
    return { cleaned, failed, changes };
  }

  // Real execution
  for (const entry of targets) {
    try {
      const linkedAgents = await detectLinkedAgents(home, entry.directory, entry.sourcePath);
      for (const agentId of linkedAgents) {
        const agentDir = getAgentSkillsDir(home, agentId);
        if (!agentDir) continue;
        const linkPath = path.join(agentDir, agentLinkName(entry.directory));
        await removeAgentLink(linkPath);
      }
    } catch (error) {
      failed.push({
        ref: entry.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { cleaned, failed, changes };
}

// ---------------------------------------------------------------------------
// Batch helper (used by CLI layer)
// ---------------------------------------------------------------------------

export function importsBatchExitCode(succeeded: unknown[], failed: unknown[]): number {
  if (failed.length > 0 && succeeded.length > 0) return 2;
  if (failed.length > 0) return 1;
  return 0;
}

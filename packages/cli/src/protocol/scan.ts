import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import YAML from "yaml";
import { AGENTS, SKIP_DIRS } from "./agents.js";
import { getAgentSkillsDir, getPaths } from "./paths.js";
import { readLock, readMetadata, writeCache } from "./store.js";
import type {
  InstalledSkill,
  MetadataStore,
  SkillApps,
  SkillCacheEntry,
  SkillLock,
  SkillLockEntry,
  SkillOrigin,
} from "./types.js";
import {
  isSymlinkOrJunction,
  lstatSafe,
  pathExists,
  pathStartsWith,
  pathsEqual,
} from "../lib/io.js";

interface ParsedSkillMd {
  name: string;
  description?: string | null;
}

export async function scanInstalledSkills(home?: string): Promise<InstalledSkill[]> {
  const entries = await scanCacheEntries(home);
  const metadata = await readMetadata(home);
  const skills: InstalledSkill[] = [];

  for (const entry of entries) {
    const meta = getMetadata(metadata, entry.id);
    skills.push({
      ...entry,
      apps: entry.apps ?? (await detectAgents(home, entry.directory, entry.homePath ?? undefined)),
      starred: meta.starred,
      isMine: meta.isMine,
    });
  }

  return skills;
}

export async function rebuildCache(home?: string): Promise<InstalledSkill[]> {
  const entries = await scanCacheEntries(home);
  await writeCache(home, { skills: entries });
  const metadata = await readMetadata(home);

  return Promise.all(
    entries.map(async (entry) => {
      const meta = getMetadata(metadata, entry.id);
      return {
        ...entry,
        apps: entry.apps ?? (await detectAgents(home, entry.directory, entry.homePath ?? undefined)),
        starred: meta.starred,
        isMine: meta.isMine,
      };
    }),
  );
}

export async function scanCacheEntries(home?: string): Promise<SkillCacheEntry[]> {
  const paths = getPaths(home);
  const scanRoots: string[] = [];

  if (await pathExists(paths.agentsSkillsDir)) {
    scanRoots.push(paths.agentsSkillsDir);
  }

  for (const agent of AGENTS) {
    const agentDir = getAgentSkillsDir(home, agent.id);
    if (agentDir && (await pathExists(agentDir))) {
      scanRoots.push(agentDir);
    }
  }

  const lock = await readLock(home).catch(() => undefined);
  const seenIds = new Set<string>();
  const entries: SkillCacheEntry[] = [];

  for (const scanRoot of scanRoots) {
    await scanDirRecursive(home, scanRoot, scanRoot, lock, seenIds, entries);
  }

  return entries;
}

async function scanDirRecursive(
  home: string | undefined,
  dir: string,
  scanRoot: string,
  lock: SkillLock | undefined,
  seenIds: Set<string>,
  entries: SkillCacheEntry[],
): Promise<void> {
  let dirEntries: string[];
  try {
    dirEntries = await fs.readdir(dir);
  } catch {
    return;
  }

  for (const entryName of dirEntries) {
    const entryPath = path.join(dir, entryName);
    if (await isSymlinkOrJunction(entryPath)) {
      continue;
    }

    const stat = await lstatSafe(entryPath);
    if (!stat?.isDirectory()) {
      continue;
    }

    if (SKIP_DIRS.has(entryName)) {
      continue;
    }

    const skillMd = path.join(entryPath, "SKILL.md");
    if (await pathExists(skillMd)) {
      const relativeDir = path.relative(scanRoot, entryPath) || entryName;
      const lockEntry = lock?.skills[relativeDir] ?? lock?.skills[entryName];
      const { repoOwner, repoName, sourceUrl } = repoInfoFromLock(lockEntry);
      const parsed = await parseSkillMd(skillMd, entryName);
      const yamlName = parsed.name === entryName ? null : parsed.name;
      const isSsot = await pathsEqual(getPaths(home).agentsSkillsDir, scanRoot);
      const origin: SkillOrigin = isSsot ? "ssot" : "agent";
      const agentId = isSsot ? undefined : detectAgentForPath(home, scanRoot);
      const id = makeSkillId(origin, relativeDir, repoOwner, repoName, agentId);

      if (seenIds.has(id)) {
        continue;
      }
      seenIds.add(id);

      const homePath = isSsot ? path.join(getPaths(home).agentsSkillsDir, relativeDir) : entryPath;
      const now = Math.floor(Date.now() / 1000);
      const [installedAt, updatedAt] = await resolveTimestamps(lockEntry, homePath, now);
      const apps = await detectAgents(home, relativeDir, homePath);

      entries.push({
        id,
        name: entryName,
        yamlName,
        description: parsed.description ?? null,
        directory: relativeDir,
        repoOwner,
        repoName,
        sourceUrl,
        origin,
        homePath,
        contentHash: await computeContentHash(homePath),
        homeAgent: await detectHomeAgent(home, homePath, origin),
        apps,
        installedAt,
        updatedAt,
      });
    } else {
      await scanDirRecursive(home, entryPath, scanRoot, lock, seenIds, entries);
    }
  }
}

export function makeSkillId(
  origin: SkillOrigin,
  directory: string,
  repoOwner?: string | null,
  repoName?: string | null,
  agentId?: string,
): string {
  if (origin === "ssot") {
    if (repoOwner && repoName) {
      return `repo:${repoOwner}/${repoName}:${directory}`;
    }
    return `ssot:${directory}`;
  }

  if (!agentId) {
    throw new Error("non-ssot skill must have an agent id");
  }
  return `agent:${agentId}:${directory}`;
}

export async function computeContentHash(root: string): Promise<string | null> {
  const stat = await lstatSafe(root);
  if (!stat?.isDirectory()) {
    return null;
  }

  const files: string[] = [];
  await collectFiles(root, root, files);
  if (files.length === 0) {
    return null;
  }

  files.sort();
  const hasher = crypto.createHash("sha256");
  for (const relativePath of files) {
    hasher.update(relativePath);
    hasher.update("\0");
    try {
      hasher.update(await fs.readFile(path.join(root, relativePath)));
    } catch {
      continue;
    }
    hasher.update("\0");
  }

  return hasher.digest("hex");
}

async function collectFiles(dir: string, root: string, files: string[]): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(dir, entry);
    const stat = await lstatSafe(entryPath);
    if (!stat) {
      continue;
    }

    if (stat.isSymbolicLink()) {
      const targetStat = await fs.stat(entryPath).catch(() => undefined);
      if (targetStat?.isFile()) {
        files.push(path.relative(root, entryPath));
      }
      continue;
    }

    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(entry)) {
        continue;
      }
      await collectFiles(entryPath, root, files);
    } else if (stat.isFile()) {
      files.push(path.relative(root, entryPath));
    }
  }
}

export async function parseSkillMd(skillMdPath: string, fallbackName: string): Promise<ParsedSkillMd> {
  const content = await fs.readFile(skillMdPath, "utf8");
  let name = fallbackName;
  let description: string | null = null;
  const frontmatter = extractFrontmatter(content);

  if (frontmatter) {
    try {
      const meta = YAML.parse(frontmatter) as Record<string, unknown> | null;
      if (meta && Object.hasOwn(meta, "name")) {
        name = stripAnsi(yamlValueToString(meta.name));
      }
      if (meta && Object.hasOwn(meta, "description")) {
        description = yamlValueToString(meta.description);
      }
    } catch {
      // Match the desktop app's permissive parsing: bad YAML falls back to the directory name.
    }
  }

  return { name, description };
}

function extractFrontmatter(content: string): string | undefined {
  const trimmed = content.trim();
  if (!trimmed.startsWith("---")) {
    return undefined;
  }

  const end = trimmed.indexOf("---", 3);
  if (end === -1) {
    return undefined;
  }

  return trimmed.slice(3, end).trim();
}

function yamlValueToString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function stripAnsi(value: string): string {
  return value.replace(
    // eslint-disable-next-line no-control-regex
    /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,
    "",
  );
}

function repoInfoFromLock(lockEntry?: SkillLockEntry): {
  repoOwner: string | null;
  repoName: string | null;
  sourceUrl: string | null;
} {
  if (!lockEntry?.source) {
    return { repoOwner: null, repoName: null, sourceUrl: null };
  }

  const [repoOwner, repoName] = lockEntry.source.split("/");
  const sourceUrl =
    lockEntry.sourceUrl ??
    (repoOwner && repoName && (lockEntry.sourceType ?? "github") === "github"
      ? `https://github.com/${repoOwner}/${repoName}`
      : null);

  return {
    repoOwner: repoOwner ?? null,
    repoName: repoName ?? null,
    sourceUrl,
  };
}

async function resolveTimestamps(
  lockEntry: SkillLockEntry | undefined,
  homePath: string,
  now: number,
): Promise<[number, number]> {
  if (lockEntry) {
    return [
      parseRfc3339(lockEntry.installedAt) ?? now,
      parseRfc3339(lockEntry.updatedAt) ?? now,
    ];
  }

  const stat = await lstatSafe(homePath);
  return [
    stat ? Math.floor(stat.birthtimeMs / 1000) : now,
    stat ? Math.floor(stat.mtimeMs / 1000) : now,
  ];
}

function parseRfc3339(value?: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : Math.floor(timestamp / 1000);
}

function getMetadata(metadata: MetadataStore, skillId: string) {
  return metadata.entries[skillId] ?? { starred: false, isMine: false };
}

async function detectAgents(
  home: string | undefined,
  directory: string,
  homePath: string | undefined,
): Promise<SkillApps> {
  const apps: SkillApps = {};

  for (const agent of AGENTS) {
    const agentDir = getAgentSkillsDir(home, agent.id);
    if (!agentDir) {
      continue;
    }

    if (homePath && (await pathStartsWith(homePath, agentDir))) {
      apps[agent.id] = true;
      continue;
    }

    const linkPath = path.join(agentDir, directory);
    if (homePath && (await isSymlinkOrJunction(linkPath))) {
      apps[agent.id] = await pathsEqual(linkPath, homePath);
    } else {
      apps[agent.id] = false;
    }
  }

  return apps;
}

function detectAgentForPath(home: string | undefined, scanRoot: string): string | undefined {
  for (const agent of AGENTS) {
    const agentDir = getAgentSkillsDir(home, agent.id);
    if (agentDir && path.resolve(agentDir) === path.resolve(scanRoot)) {
      return agent.id;
    }
  }
  return undefined;
}

async function detectHomeAgent(
  home: string | undefined,
  homePath: string,
  origin: SkillOrigin,
): Promise<string | null> {
  if (origin === "ssot") {
    return null;
  }

  for (const agent of AGENTS) {
    const agentDir = getAgentSkillsDir(home, agent.id);
    if (agentDir && (await pathStartsWith(homePath, agentDir))) {
      return agent.id;
    }
  }

  return null;
}

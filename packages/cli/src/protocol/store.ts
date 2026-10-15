import { promises as fs } from "node:fs";
import path from "node:path";
import { acquireAgentLease, hasAgentLease } from "./agent-transaction.js";
import { getPaths } from "./paths.js";
import {
  DEFAULT_ARCHIVE_MANIFEST,
  DEFAULT_CACHE,
  DEFAULT_EXTERNAL_IMPORTS,
  DEFAULT_LOCK,
  DEFAULT_METADATA,
  type ArchiveManifest,
  type ExternalImports,
  type MetadataStore,
  type SkillCache,
  type SkillLock,
} from "./types.js";
import { readJson, writeJsonAtomic } from "../lib/io.js";
import { CliError } from "../lib/errors.js";

const SUPPORTED_LOCK_VERSION = 3;
const SUPPORTED_ARCHIVE_VERSION = 1;
const SUPPORTED_EXTERNAL_IMPORTS_VERSION = 1;

export async function readLock(home?: string): Promise<SkillLock> {
  const lock = await readJson<SkillLock>(getPaths(home).agentLockFile, DEFAULT_LOCK);
  return {
    ...DEFAULT_LOCK,
    ...lock,
    skills: lock.skills ?? {},
    version: lock.version ?? DEFAULT_LOCK.version,
  };
}

export async function writeLock(home: string | undefined, lock: SkillLock): Promise<void> {
  await writeJsonAtomic(getPaths(home).agentLockFile, lock);
}

export async function readArchiveManifest(home?: string): Promise<ArchiveManifest> {
  const manifest = await readJson<ArchiveManifest>(
    getPaths(home).archiveManifestFile,
    DEFAULT_ARCHIVE_MANIFEST,
  );
  return {
    ...DEFAULT_ARCHIVE_MANIFEST,
    ...manifest,
    skills: manifest.skills ?? {},
    version: manifest.version ?? DEFAULT_ARCHIVE_MANIFEST.version,
  };
}

export async function writeArchiveManifest(
  home: string | undefined,
  manifest: ArchiveManifest,
): Promise<void> {
  await writeJsonAtomic(getPaths(home).archiveManifestFile, manifest);
}

export async function readExternalImports(home?: string): Promise<ExternalImports> {
  const imports = await readJson<ExternalImports>(
    getPaths(home).externalImportsFile,
    DEFAULT_EXTERNAL_IMPORTS,
  );
  return {
    ...DEFAULT_EXTERNAL_IMPORTS,
    ...imports,
    imports: imports.imports ?? {},
    version: imports.version ?? DEFAULT_EXTERNAL_IMPORTS.version,
  };
}

export async function writeExternalImports(
  home: string | undefined,
  imports: ExternalImports,
): Promise<void> {
  await writeJsonAtomic(getPaths(home).externalImportsFile, imports);
}

export function metadataKey(skill: { origin: string; directory: string; id: string }): string {
  if (skill.origin !== "ssot") return skill.id;
  const directory = skill.directory;
  if (
    !directory ||
    /[\\:]/.test(directory) ||
    directory.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new CliError(`Invalid SSOT metadata directory: ${directory}`);
  }
  return `ssot:${directory}`;
}

function validateMetadata(metadata: MetadataStore): void {
  if (
    (metadata.version !== undefined &&
      (typeof metadata.version !== "number" ||
        !Number.isInteger(metadata.version) ||
        metadata.version < 0 ||
        metadata.version > 4294967295)) ||
    !metadata.entries ||
    typeof metadata.entries !== "object" ||
    Array.isArray(metadata.entries)
  )
    throw new CliError("Invalid metadata.json");
  for (const value of Object.values(metadata.entries)) {
    if (
      !value ||
      typeof value.starred !== "boolean" ||
      typeof value.isMine !== "boolean" ||
      Object.keys(value).some((key) => key !== "starred" && key !== "isMine")
    )
      throw new CliError("Invalid or unsupported metadata entry");
  }
}

export function assertWritableMetadata(metadata: MetadataStore): void {
  validateMetadata(metadata);
  if ((metadata.version ?? 0) > 1)
    throw new CliError(
      `Metadata version ${metadata.version} is newer than supported. Upgrade Skill Zoo before writing.`,
    );
}

export async function migrateMetadata(
  metadata: MetadataStore,
  root: string,
  protectedIds: Set<string>,
): Promise<string[]> {
  validateMetadata(metadata);
  if ((metadata.version ?? 0) !== 0) return unboundMetadata(metadata, protectedIds);
  const groups = new Map<string, string[]>();
  for (const id of Object.keys(metadata.entries)) {
    if (protectedIds.has(id)) continue;
    const match = /^repo:([^/:]+\/[^/:]+):(.+)$/.exec(id);
    if (!match) continue;
    const directory = match[2]!;
    let key: string;
    try {
      key = metadataKey({ origin: "ssot", directory, id });
    } catch {
      continue;
    }
    try {
      if (!(await fs.stat(path.join(root, directory, "SKILL.md"))).isFile()) continue;
      const relative = path.relative(
        await fs.realpath(root),
        await fs.realpath(path.join(root, directory)),
      );
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
        continue;
    } catch (error) {
      if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) continue;
      throw error;
    }
    if (protectedIds.has(key)) continue;
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  for (const [target, ids] of groups) {
    const value = metadata.entries[ids[0]!]!;
    const same = (other: typeof value) =>
      other.starred === value.starred && other.isMine === value.isMine;
    if (
      ids.some((id) => !same(metadata.entries[id]!)) ||
      (metadata.entries[target] && !same(metadata.entries[target]!))
    )
      continue;
    metadata.entries[target] = value;
    for (const id of ids) delete metadata.entries[id];
  }
  metadata.version = 1;
  return unboundMetadata(metadata, protectedIds);
}

export function protectedMetadataIds(imports: ExternalImports): Set<string> {
  return new Set(Object.entries(imports.imports).flatMap(([key, entry]) => [key, entry.id]));
}

export function unboundMetadata(metadata: MetadataStore, protectedIds: Set<string>): string[] {
  return Object.keys(metadata.entries)
    .filter((id) => {
      if (protectedIds.has(id) || id.startsWith("agent:") || id.startsWith("external:"))
        return false;
      if (id.startsWith("ssot:")) {
        try {
          metadataKey({ origin: "ssot", directory: id.slice(5), id });
          return false;
        } catch {
          return true;
        }
      }
      return true;
    })
    .sort();
}

async function readMetadataFile(home?: string): Promise<MetadataStore> {
  let content: string;
  try {
    content = await fs.readFile(getPaths(home).metadataFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return structuredClone(DEFAULT_METADATA);
    throw error;
  }
  return content.trim()
    ? (JSON.parse(content) as MetadataStore)
    : structuredClone(DEFAULT_METADATA);
}

const metadataMigrations = new Map<string, Promise<MetadataStore>>();

export async function readMetadata(home?: string): Promise<MetadataStore> {
  const metadata = await readMetadataFile(home);
  validateMetadata(metadata);
  if ((metadata.version ?? 0) !== 0) return metadata;
  const key = getPaths(home).appConfigDir;
  let migration = metadataMigrations.get(key);
  if (!migration) {
    migration = migrateMetadataFile(home);
    metadataMigrations.set(key, migration);
  }
  try {
    return structuredClone(await migration);
  } finally {
    if (metadataMigrations.get(key) === migration) metadataMigrations.delete(key);
  }
}

async function migrateMetadataFile(home?: string): Promise<MetadataStore> {
  const release = hasAgentLease(home) ? undefined : await acquireAgentLease(home);
  try {
    const metadata = await readMetadataFile(home);
    if ((metadata.version ?? 0) === 0) {
      const imports = await readExternalImports(home);
      const pending = await migrateMetadata(
        metadata,
        getPaths(home).agentsSkillsDir,
        protectedMetadataIds(imports),
      );
      await writeMetadata(home, metadata);
      for (const id of pending)
        process.stderr.write(
          `Unbound user metadata: ${id}; see docs/local-protocol.md for manual resolution\n`,
        );
    }
    return metadata;
  } finally {
    await release?.();
  }
}

export async function writeMetadata(
  home: string | undefined,
  metadata: MetadataStore,
): Promise<void> {
  assertWritableMetadata(metadata);
  if (metadata.version !== 1) throw new CliError("Migrate legacy metadata before writing");
  const current = await readMetadataFile(home);
  assertWritableMetadata(current);
  await writeJsonAtomic(getPaths(home).metadataFile, { ...metadata, version: 1 });
}

export async function readCache(home?: string): Promise<SkillCache> {
  const cache = await readJson<SkillCache>(getPaths(home).skillsCacheFile, DEFAULT_CACHE);
  return {
    ...DEFAULT_CACHE,
    ...cache,
    skills: cache.skills ?? [],
  };
}

export async function writeCache(home: string | undefined, cache: SkillCache): Promise<void> {
  await writeJsonAtomic(getPaths(home).skillsCacheFile, cache);
}

export function assertWritableSchema(
  lock: SkillLock,
  manifest: ArchiveManifest,
  imports: ExternalImports = DEFAULT_EXTERNAL_IMPORTS,
): void {
  if (lock.version > SUPPORTED_LOCK_VERSION) {
    throw new CliError(
      `Lock file version ${lock.version} is newer than this CLI supports. Upgrade skill-zoo CLI before writing.`,
    );
  }

  if (manifest.version > SUPPORTED_ARCHIVE_VERSION) {
    throw new CliError(
      `Archive manifest version ${manifest.version} is newer than this CLI supports. Upgrade skill-zoo CLI before writing.`,
    );
  }

  if (imports.version > SUPPORTED_EXTERNAL_IMPORTS_VERSION) {
    throw new CliError(
      `External imports version ${imports.version} is newer than this CLI supports. Upgrade skill-zoo CLI before writing.`,
    );
  }
}

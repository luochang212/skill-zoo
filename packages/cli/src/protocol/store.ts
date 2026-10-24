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

/** Read a desktop-owned state file and reject non-object documents (for
 *  example a literal `null`) with a clean error instead of a TypeError,
 *  matching the desktop's report-don't-swallow rule for malformed files. */
async function readStateFile<T extends object>(filePath: string, fallback: T): Promise<T> {
  const value = await readJson<T>(filePath, fallback);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CliError(`The state file at ${filePath} is not a valid document.`);
  }
  return value;
}

export async function readLock(home?: string): Promise<SkillLock> {
  const lock = await readStateFile<SkillLock>(getPaths(home).agentLockFile, DEFAULT_LOCK);
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
  const manifest = await readStateFile<ArchiveManifest>(
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
  const imports = await readStateFile<ExternalImports>(
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

export async function readMetadata(home?: string): Promise<MetadataStore> {
  const metadata = await readStateFile<MetadataStore>(getPaths(home).metadataFile, DEFAULT_METADATA);
  const store: MetadataStore = {
    ...DEFAULT_METADATA,
    ...metadata,
    entries: metadata.entries ?? {},
  };
  // Rekey legacy provenance-derived IDs to the canonical installation
  // directory identity (mirrors the desktop's MetadataStore migration).
  const legacyKeys = Object.keys(store.entries).filter(
    (key) => canonicalizeLegacySkillId(key) !== null,
  );
  if (legacyKeys.length === 0) {
    return store;
  }
  for (const legacyKey of legacyKeys) {
    const entry = store.entries[legacyKey];
    if (!entry) {
      continue;
    }
    const canonical = canonicalizeLegacySkillId(legacyKey) as string;
    delete store.entries[legacyKey];
    const existing = store.entries[canonical];
    store.entries[canonical] = existing
      ? {
          starred: existing.starred || entry.starred,
          isMine: existing.isMine || entry.isMine,
        }
      : entry;
  }
  try {
    await writeMetadata(home, store);
  } catch (error) {
    console.error(`metadata.json: legacy key migration save failed: ${error}`);
  }
  return store;
}

/**
 * Map a legacy provenance-derived skill ID to the canonical installation
 * directory identity. `repo:{owner}/{repo}:{dir}` → `ssot:{dir}`; owner/repo
 * cannot contain `:`, so the first `:` after the prefix preserves the full directory.
 * Any other ID form is already canonical and returns null.
 */
export function canonicalizeLegacySkillId(skillId: string): string | null {
  if (!skillId.startsWith("repo:")) {
    return null;
  }
  const rest = skillId.slice("repo:".length);
  const splitAt = rest.indexOf(":");
  if (splitAt < 0) {
    return null;
  }
  return `ssot:${rest.slice(splitAt + 1)}`;
}

export async function writeMetadata(home: string | undefined, metadata: MetadataStore): Promise<void> {
  await writeJsonAtomic(getPaths(home).metadataFile, metadata);
}

export async function readCache(home?: string): Promise<SkillCache> {
  const cache = await readStateFile<SkillCache>(getPaths(home).skillsCacheFile, DEFAULT_CACHE);
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

import { getPaths } from "./paths.js";
import {
  DEFAULT_ARCHIVE_MANIFEST,
  DEFAULT_CACHE,
  DEFAULT_LOCK,
  DEFAULT_METADATA,
  type ArchiveManifest,
  type MetadataStore,
  type SkillCache,
  type SkillLock,
} from "./types.js";
import { readJson, writeJsonAtomic } from "../lib/io.js";
import { CliError } from "../lib/errors.js";

const SUPPORTED_LOCK_VERSION = 3;
const SUPPORTED_ARCHIVE_VERSION = 1;

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

export async function readMetadata(home?: string): Promise<MetadataStore> {
  const metadata = await readJson<MetadataStore>(getPaths(home).metadataFile, DEFAULT_METADATA);
  return {
    ...DEFAULT_METADATA,
    ...metadata,
    entries: metadata.entries ?? {},
  };
}

export async function writeMetadata(home: string | undefined, metadata: MetadataStore): Promise<void> {
  await writeJsonAtomic(getPaths(home).metadataFile, metadata);
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

export function assertWritableSchema(lock: SkillLock, manifest: ArchiveManifest): void {
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
}

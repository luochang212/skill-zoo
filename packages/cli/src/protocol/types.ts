export interface SkillApps {
  [agentId: string]: boolean;
}

export type SkillOrigin = "ssot" | "agent";

export interface SkillLockEntry {
  source?: string | null;
  sourceType?: string | null;
  sourceUrl?: string | null;
  ref?: string | null;
  skillPath?: string | null;
  skillFolderHash?: string | null;
  installedAt?: string | null;
  updatedAt?: string | null;
  commitSha?: string | null;
}

export interface SkillLock {
  version: number;
  skills: Record<string, SkillLockEntry>;
  dismissed: unknown;
}

export interface SkillCacheEntry {
  id: string;
  name: string;
  yamlName?: string | null;
  description?: string | null;
  directory: string;
  repoOwner?: string | null;
  repoName?: string | null;
  sourceUrl?: string | null;
  origin: SkillOrigin;
  homePath?: string | null;
  contentHash?: string | null;
  homeAgent?: string | null;
  apps?: SkillApps;
  installedAt: number;
  updatedAt: number;
}

export interface SkillCache {
  skills: SkillCacheEntry[];
}

export interface SkillMetadata {
  starred: boolean;
  isMine: boolean;
}

export interface MetadataStore {
  entries: Record<string, SkillMetadata>;
}

export interface InstalledSkill extends SkillCacheEntry {
  apps: SkillApps;
  starred: boolean;
  isMine: boolean;
}

export interface ArchivedSkill extends InstalledSkill {
  archiveId: string;
  originalSkillId: string;
  archivedAt: number;
  lockKey?: string | null;
  lockEntry?: SkillLockEntry | null;
  archivedByVersion?: string | null;
  reason?: string | null;
}

export interface ArchiveManifest {
  version: number;
  skills: Record<string, ArchivedSkill>;
}

export interface Change {
  action: string;
  path: string;
  target?: string;
}

export interface BatchFailure {
  ref: string;
  error: string;
}

export const DEFAULT_LOCK: SkillLock = {
  version: 3,
  skills: {},
  dismissed: {},
};

export const DEFAULT_ARCHIVE_MANIFEST: ArchiveManifest = {
  version: 1,
  skills: {},
};

export const DEFAULT_METADATA: MetadataStore = {
  entries: {},
};

export const DEFAULT_CACHE: SkillCache = {
  skills: [],
};

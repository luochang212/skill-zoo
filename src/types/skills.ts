export interface SkillApps {
  [agentId: string]: boolean;
}

export type SkillOrigin = "ssot" | "agent" | "external";

export interface InstalledSkill {
  id: string;
  name: string;
  yamlName?: string;
  description?: string;
  directory: string;
  repoOwner?: string;
  repoName?: string;
  sourceUrl?: string;
  apps: SkillApps;
  origin: SkillOrigin;
  homePath?: string;
  contentHash?: string;
  homeAgent?: string;
  starred?: boolean;
  isMine?: boolean;
  installedAt: number;
  updatedAt: number;
}

export interface ArchivedSkill extends InstalledSkill {
  archiveId: string;
  originalSkillId: string;
  archivedAt: number;
}

export interface DiscoverableSkill {
  key: string;
  name: string;
  description?: string;
  directory: string;
  repoOwner: string;
  repoName: string;
  installStatus: "available" | "installed" | "conflict";
  installedSkillId?: string;
  installs?: number;
}

export interface RepoSkillsResult {
  skills: DiscoverableSkill[];
  total: number;
}

export interface SymlinkStatus {
  skillId: string;
  skillName: string;
  agent: string;
  symlinkPath: string;
  targetPath: string;
  exists: boolean;
  isValid: boolean;
}

export interface ExternalImportCandidate {
  sourcePath: string;
  directory: string;
  name: string;
  description?: string;
  alreadyImported: boolean;
}

export type ExternalImportStatus = "valid" | "sourceMissing" | "skillMissing";

export interface ExternalImportInfo {
  id: string;
  sourcePath: string;
  directory: string;
  name: string;
  description?: string;
  status: ExternalImportStatus;
  linkedAgents: string[];
  importedAt: number;
  updatedAt: number;
}

export interface ExternalImportSelection {
  sourcePath: string;
  directory: string;
}

export type View = "discover" | "local" | "settings";

export interface AgentPathInfo {
  agent: string;
  label: string;
  path: string;
  exists: boolean;
}

export interface AgentConfig {
  id: string;
  label: string;
  skillsSubdir: string;
}

export interface VisibleAgents {
  [agentId: string]: boolean;
}

export interface AgentPreferences {
  visibleAgents: VisibleAgents;
  agentOrder: string[];
}

export interface SkillCompanionItem {
  id: string;
  content: string;
}

export interface SkillUsageRank {
  name: string;
  count: number;
  lastUsedAt: number;
}

export interface DailyCount {
  label: string;
  date: string;
  count: number;
}

export interface SkillUsagePeriod {
  totalCalls: number;
  skills: SkillUsageRank[];
  dailyBreakdown: DailyCount[];
}

export interface RecentSkillUsage {
  name: string;
  command: string;
  lastUsedAt: number;
}

export interface SkillUsage {
  installedSkillCount: number;
  totalCalls: number;
  week: SkillUsagePeriod;
  month: SkillUsagePeriod;
  recent: RecentSkillUsage[];
}

export interface DiscoverRepo {
  owner: string;
  name: string;
  branch?: string;
  defaultBranch?: string;
  description?: string;
  stars?: number;
  forks?: number;
  language?: string;
  license?: string;
  openIssues?: number;
  pushedAt?: string;
  topics?: string[];
  htmlUrl?: string;
}

export interface SkillAudit {
  provider: string;
  slug: string;
  status: "pass" | "warn" | "fail";
  summary: string;
  riskLevel?: string;
  auditedAt?: string;
  categories?: string[];
}

export interface SkillFileNode {
  name: string;
  path: string;
  isDir: boolean;
  isSkillMd: boolean;
  children?: SkillFileNode[];
}

export interface Banner {
  image: string;
  title: string;
  subtitle: string;
  owner?: string;
  name?: string;
  branch?: string;
  hideText?: boolean;
}

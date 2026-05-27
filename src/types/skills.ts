export interface SkillApps {
  [agentId: string]: boolean;
}

export type SkillOrigin = "ssot" | "agent";

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

export interface DiscoverableSkill {
  key: string;
  name: string;
  description?: string;
  directory: string;
  repoOwner: string;
  repoName: string;
  installed: boolean;
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

export interface DiscoverRepo {
  owner: string;
  name: string;
  branch: string;
  description?: string;
  stars?: number;
  forks?: number;
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

export interface SkillsChangedPayload {
  updated: string[];
  removed: string[];
  fullRebuild: boolean;
}

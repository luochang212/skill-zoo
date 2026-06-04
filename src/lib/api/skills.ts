import { invoke } from "@tauri-apps/api/core";
import type {
  AgentPathInfo,
  AgentConfig,
  ArchivedSkill,
  Banner,
  DiscoverRepo,
  DiscoverableSkill,
  InstalledSkill,
  RepoSkillsResult,
  SkillAudit,
  SkillFileNode,
  SymlinkStatus,
} from "@/types/skills";

export const skillsApi = {
  installSkills: (repoUrl: string, skillNames: string[], agents: string[]) =>
    invoke<InstalledSkill[]>("install_skills", { repoUrl, skillNames, agents }),

  getInstalledSkills: (force?: boolean) =>
    invoke<InstalledSkill[]>("get_installed_skills", { force }),

  updateSkill: (skillId: string) => invoke<InstalledSkill>("update_skill", { skillId }),

  updateAllSkills: () => invoke<UpdateAllResult>("update_all_skills"),

  removeSkill: (skillId: string) => invoke<void>("remove_skill", { skillId }),

  removeSkills: (skillIds: string[]) => invoke<RemoveSkillsResult>("remove_skills", { skillIds }),

  archiveSkill: (skillId: string) => invoke<void>("archive_skill", { skillId }),

  archiveSkills: (skillIds: string[]) =>
    invoke<ArchiveSkillsResult>("archive_skills", { skillIds }),

  restoreArchivedSkill: (archiveId: string) =>
    invoke<InstalledSkill>("restore_archived_skill", { archiveId }),

  restoreArchivedSkills: (archiveIds: string[]) =>
    invoke<RestoreArchivedSkillsResult>("restore_archived_skills", { archiveIds }),

  getArchivedSkills: () => invoke<ArchivedSkill[]>("get_archived_skills"),

  readArchivedSkillMd: (archiveId: string) =>
    invoke<string>("read_archived_skill_md", { archiveId }),

  readSkillMd: (directory: string) => invoke<string>("read_skill_md", { directory }),

  writeSkillMd: (directory: string, content: string) =>
    invoke<void>("write_skill_md", { directory, content }),

  listSkillFiles: (directory: string) => invoke<SkillFileNode[]>("list_skill_files", { directory }),

  readSkillFilePath: (path: string) => invoke<string>("read_skill_file_path", { path }),

  writeSkillFilePath: (path: string, content: string) =>
    invoke<void>("write_skill_file_path", { path, content }),

  getSymlinkStatus: () => invoke<SymlinkStatus[]>("get_symlink_status"),

  toggleSymlink: (skillId: string, agent: string, enabled: boolean) =>
    invoke<void>("toggle_symlink", { skillId, agent, enabled }),

  openSkillsDir: (agent: string) => invoke<void>("open_skills_dir", { agent }),

  openSkillDir: (directory: string) => invoke<void>("open_skill_dir", { directory }),

  openSkillPath: (path: string) => invoke<void>("open_skill_path", { path }),

  getAgentPaths: () => invoke<AgentPathInfo[]>("get_agent_paths"),

  getAgentConfigs: () => invoke<AgentConfig[]>("get_agent_configs"),

  // ── Discover (repo-driven) ──

  getBanners: () => invoke<Banner[]>("get_banners"),

  getRecommendedRepos: () => invoke<DiscoverRepo[]>("get_recommended_repos"),

  searchRepo: (query: string) => invoke<DiscoverRepo>("search_repo", { query }),

  getRepoSkills: (owner: string, name: string, branch?: string, force?: boolean) =>
    invoke<RepoSkillsResult>("get_repo_skills", { owner, name, branch, force }),

  previewSkillMd: (owner: string, name: string, branch: string | undefined, skillDir: string) =>
    invoke<string>("preview_skill_md", { owner, name, branch, skillDir }),

  getRepoMetadata: (owner: string, name: string, force?: boolean) =>
    invoke<DiscoverRepo>("get_repo_metadata", { owner, name, force }),

  getRepoReadme: (owner: string, name: string, branch?: string, force?: boolean) =>
    invoke<string>("get_repo_readme", { owner, name, branch, force }),

  // ── Discover (skills.sh) ──

  searchSkillsSh: (query: string, limit?: number) =>
    invoke<DiscoverableSkill[]>("search_skills_sh", { query, limit }),

  // ── Security Audit (skills.sh) ──

  getSkillAudit: (owner: string, repo: string, slug: string) =>
    invoke<SkillAudit[]>("get_skill_audit", { owner, repo, slug }),

  // ── Star / Create ──

  starSkill: (skillId: string) => invoke<void>("star_skill", { skillId }),

  unstarSkill: (skillId: string) => invoke<void>("unstar_skill", { skillId }),

  setSkillIsMine: (skillId: string, isMine: boolean) =>
    invoke<void>("set_skill_is_mine", { skillId, isMine }),

  createSkill: (name: string, content: string, agents: string[]) =>
    invoke<InstalledSkill>("create_skill", { name, content, agents }),

  // ── Duplicates ──

  mergeDuplicatesToSsot: (skillName: string) =>
    invoke<void>("merge_duplicates_to_ssot", { skillName }),

  // ── Cache ──

  clearDownloadCache: () => invoke<number>("clear_download_cache"),

  getCacheSize: () => invoke<number>("get_cache_size"),

  openCacheDir: () => invoke<void>("open_cache_dir"),

  checkSkillUpdates: () => invoke<CheckUpdatesResult>("check_skill_updates"),
};

export interface UpdateAllResult {
  skills: InstalledSkill[];
  successCount: number;
  failCount: number;
  errors: string[];
}

export interface SkillUpdateStatus {
  skillName: string;
  hasUpdate: boolean;
  currentSha: string | null;
  latestSha: string | null;
  repo: string;
}

export interface RemoveSkillsResult {
  removed: string[];
  failed: RemoveSkillFailure[];
}

export interface RemoveSkillFailure {
  skillId: string;
  error: string;
}

export interface ArchiveSkillsResult {
  archived: string[];
  failed: ArchiveSkillFailure[];
}

export interface ArchiveSkillFailure {
  skillId: string;
  error: string;
}

export interface RestoreArchivedSkillsResult {
  restored: string[];
  failed: RestoreArchivedSkillFailure[];
}

export interface RestoreArchivedSkillFailure {
  archiveId: string;
  error: string;
}

export interface CheckUpdatesResult {
  skills: SkillUpdateStatus[];
  totalRepos: number;
  checkedRepos: number;
  rateLimited: boolean;
}

import { invoke } from "@tauri-apps/api/core";
import type {
  AgentPathInfo,
  AgentConfig,
  Banner,
  DiscoverRepo,
  DiscoverableSkill,
  InstalledSkill,
  SkillFileNode,
  SymlinkStatus,
} from "@/types/skills";

export const skillsApi = {
  installSkills: (repoUrl: string, skillNames: string[], agents: string[]) =>
    invoke<InstalledSkill[]>("install_skills", { repoUrl, skillNames, agents }),

  getInstalledSkills: (force?: boolean) =>
    invoke<InstalledSkill[]>("get_installed_skills", { force }),

  updateSkill: (skillId: string) => invoke<InstalledSkill>("update_skill", { skillId }),

  updateAllSkills: () => invoke<InstalledSkill[]>("update_all_skills"),

  removeSkill: (skillId: string) => invoke<void>("remove_skill", { skillId }),

  readSkillMd: (directory: string) => invoke<string>("read_skill_md", { directory }),

  writeSkillMd: (directory: string, content: string) =>
    invoke<void>("write_skill_md", { directory, content }),

  listSkillFiles: (directory: string) => invoke<SkillFileNode[]>("list_skill_files", { directory }),

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
    invoke<DiscoverableSkill[]>("get_repo_skills", { owner, name, branch, force }),

  previewSkillMd: (owner: string, name: string, branch: string | undefined, skillDir: string) =>
    invoke<string>("preview_skill_md", { owner, name, branch, skillDir }),

  getRepoMetadata: (owner: string, name: string) =>
    invoke<DiscoverRepo>("get_repo_metadata", { owner, name }),

  // ── Discover (skills.sh) ──

  searchSkillsSh: (query: string, limit?: number) =>
    invoke<DiscoverableSkill[]>("search_skills_sh", { query, limit }),

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
};

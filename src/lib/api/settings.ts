import { invoke } from "@tauri-apps/api/core";
import type {
  AgentPreferences,
  AgentPreview,
  AgentChangeResult,
  SkillCompanionItem,
  SkillUsage,
  VisibleAgents,
} from "@/types/skills";

export interface GitHubTokenVerification {
  authenticated: boolean;
  limit: number;
  /** RFC 3339 expiry reported by GitHub, absent for tokens without one. */
  expiresAt?: string | null;
}

/** Saved-state view of the credential. It never carries the token itself. */
export interface GitHubCredentialStatus {
  hasToken: boolean;
  expiresAt: string | null;
}

export const settingsApi = {
  previewCustomAgent: (name: string, skillsDir: string, agentId?: string) =>
    invoke<AgentPreview>("preview_custom_agent", { name, skillsDir, agentId }),

  previewAgentRemoval: (agentId: string) =>
    invoke<AgentPreview>("preview_agent_removal", { agentId }),

  pickAgentDirectory: () => invoke<string | null>("pick_agent_directory"),

  saveCustomAgent: (name: string, skillsDir: string, createDirectory: boolean, agentId?: string) =>
    invoke<AgentChangeResult>("save_custom_agent", { name, skillsDir, createDirectory, agentId }),

  removeCustomAgent: (agentId: string) =>
    invoke<AgentChangeResult>("remove_custom_agent", { agentId }),
  getSettings: () => invoke<Record<string, string>>("get_settings"),

  getGitHubCredentialStatus: () => invoke<GitHubCredentialStatus>("get_github_credential_status"),

  updateSetting: (key: string, value: string) => invoke<void>("update_setting", { key, value }),

  saveGitHubCredentials: (token: string, expiresAt: string | null) =>
    invoke<void>("save_github_credentials", { token, expiresAt }),

  verifyGitHubToken: (token: string) =>
    invoke<GitHubTokenVerification>("verify_github_token", { token }),

  /** Live check of the saved token. The credential itself stays server-side. */
  verifySavedGitHubToken: () => invoke<GitHubTokenVerification>("verify_saved_github_token"),

  getSkillCompanionItems: () => invoke<SkillCompanionItem[]>("get_skill_companion_items"),

  saveSkillCompanionItems: (items: SkillCompanionItem[]) =>
    invoke<SkillCompanionItem[]>("save_skill_companion_items", { items }),

  setTrayLanguage: (language: string) => invoke<void>("set_tray_language", { language }),

  getSkillUsage: (agent: string) => invoke<SkillUsage>("get_skill_usage", { agentId: agent }),

  saveSkillUsageScreenshot: (dataUrl: string) =>
    invoke<string>("save_skill_usage_screenshot", { dataUrl }),

  getVisibleAgents: () => invoke<VisibleAgents>("get_visible_agents"),

  updateAgentPreferences: (preferences: AgentPreferences) =>
    invoke<AgentPreferences>("update_agent_preferences", {
      visibleAgents: preferences.visibleAgents,
      agentOrder: preferences.agentOrder,
    }),
};

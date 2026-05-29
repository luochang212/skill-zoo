import { invoke } from "@tauri-apps/api/core";
import type { AgentConfig, VisibleAgents } from "@/types/skills";

export const settingsApi = {
  getSettings: () => invoke<Record<string, string>>("get_settings"),

  updateSetting: (key: string, value: string) => invoke<void>("update_setting", { key, value }),

  getVisibleAgents: () => invoke<VisibleAgents>("get_visible_agents"),

  updateVisibleAgents: (visibleAgents: VisibleAgents) =>
    invoke<void>("update_visible_agents", { visibleAgents }),

  addCustomAgent: (name: string, skillsDir: string) =>
    invoke<AgentConfig>("add_custom_agent", { name, skillsDir }),

  updateCustomAgent: (agentId: string, name: string, skillsDir: string) =>
    invoke<AgentConfig>("update_custom_agent", { agentId, name, skillsDir }),

  removeCustomAgent: (agentId: string) =>
    invoke<void>("remove_custom_agent", { agentId }),

  checkDirExists: (path: string) => invoke<boolean>("check_dir_exists", { path }),
};

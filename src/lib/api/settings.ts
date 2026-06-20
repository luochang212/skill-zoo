import { invoke } from "@tauri-apps/api/core";
import type { AgentPreferences, VisibleAgents } from "@/types/skills";

export const settingsApi = {
  getSettings: () => invoke<Record<string, string>>("get_settings"),

  updateSetting: (key: string, value: string) => invoke<void>("update_setting", { key, value }),

  getVisibleAgents: () => invoke<VisibleAgents>("get_visible_agents"),

  updateAgentPreferences: (preferences: AgentPreferences) =>
    invoke<AgentPreferences>("update_agent_preferences", {
      visibleAgents: preferences.visibleAgents,
      agentOrder: preferences.agentOrder,
    }),
};

import { invoke } from "@tauri-apps/api/core";
import type { AgentPreferences, SkillCompanionItem, VisibleAgents } from "@/types/skills";

export const settingsApi = {
  getSettings: () => invoke<Record<string, string>>("get_settings"),

  updateSetting: (key: string, value: string) => invoke<void>("update_setting", { key, value }),

  getSkillCompanionItems: () => invoke<SkillCompanionItem[]>("get_skill_companion_items"),

  saveSkillCompanionItems: (items: SkillCompanionItem[]) =>
    invoke<SkillCompanionItem[]>("save_skill_companion_items", { items }),

  setTrayLanguage: (language: string) => invoke<void>("set_tray_language", { language }),

  getVisibleAgents: () => invoke<VisibleAgents>("get_visible_agents"),

  updateAgentPreferences: (preferences: AgentPreferences) =>
    invoke<AgentPreferences>("update_agent_preferences", {
      visibleAgents: preferences.visibleAgents,
      agentOrder: preferences.agentOrder,
    }),
};

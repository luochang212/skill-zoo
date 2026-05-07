import { invoke } from "@tauri-apps/api/core";
import type { VisibleAgents } from "@/types/skills";

export const settingsApi = {
  getSettings: () => invoke<Record<string, string>>("get_settings"),

  updateSetting: (key: string, value: string) => invoke<void>("update_setting", { key, value }),

  getVisibleAgents: () => invoke<VisibleAgents>("get_visible_agents"),

  updateVisibleAgents: (visibleAgents: VisibleAgents) =>
    invoke<void>("update_visible_agents", { visibleAgents }),
};

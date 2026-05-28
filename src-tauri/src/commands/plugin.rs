use crate::services::plugin::{self, PluginInfo};
use crate::services::skill::SkillService;
use crate::store::AppState;
use std::collections::HashMap;
use tauri::State;

#[tauri::command]
pub fn get_installed_plugins(
    state: State<'_, AppState>,
    force: Option<bool>,
) -> Result<Vec<PluginInfo>, String> {
    let force = force.unwrap_or(false);

    if !force {
        if let Ok(cache) = state.plugin_cache.read() {
            if let Some(ref cached) = *cache {
                return Ok(cached.clone());
            }
        }
    }

    let settings = state.settings.lock().map_err(|e| e.to_string())?;
    let visible: HashMap<String, bool> = SkillService::get_visible_agents(&settings);
    let visible_ids: Vec<String> = visible
        .into_iter()
        .filter(|(_, v)| *v)
        .map(|(k, _)| k)
        .collect();

    let plugins = plugin::scan_all_plugins(&visible_ids);

    if let Ok(mut cache) = state.plugin_cache.write() {
        *cache = Some(plugins.clone());
    }

    Ok(plugins)
}

#[tauri::command]
pub fn invalidate_plugin_cache(state: State<'_, AppState>) {
    if let Ok(mut cache) = state.plugin_cache.write() {
        *cache = None;
    }
}

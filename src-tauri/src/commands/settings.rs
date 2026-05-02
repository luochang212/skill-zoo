use crate::store::AppState;
use std::collections::HashMap;
use tauri::State;

#[tauri::command]
pub fn set_window_theme(window: tauri::Window, theme: String) -> Result<(), String> {
    let tauri_theme = match theme.as_str() {
        "dark" => Some(tauri::Theme::Dark),
        "light" => Some(tauri::Theme::Light),
        _ => None,
    };
    window.set_theme(tauri_theme).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_settings(
    state: State<'_, AppState>,
) -> Result<HashMap<String, String>, String> {
    let settings = state.settings.lock().map_err(|e| e.to_string())?;
    Ok(settings.values.clone())
}

#[tauri::command]
pub fn update_setting(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    let mut settings = state.settings.lock().map_err(|e| e.to_string())?;
    settings.set(key, value);
    settings.save().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_visible_agents(
    state: State<'_, AppState>,
) -> Result<HashMap<String, bool>, String> {
    let settings = state.settings.lock().map_err(|e| e.to_string())?;
    Ok(crate::services::skill::SkillService::get_visible_agents(&settings))
}

#[tauri::command]
pub fn update_visible_agents(
    state: State<'_, AppState>,
    visible_agents: HashMap<String, bool>,
) -> Result<(), String> {
    if !visible_agents.values().any(|v| *v) {
        return Err("At least one agent must remain visible".to_string());
    }

    // Read old visibility before saving
    let old_visible = {
        let settings = state.settings.lock().map_err(|e| e.to_string())?;
        crate::services::skill::SkillService::get_visible_agents(&settings)
    };

    // Save new value
    {
        let mut settings = state.settings.lock().map_err(|e| e.to_string())?;
        let json = serde_json::to_string(&visible_agents).map_err(|e| e.to_string())?;
        settings.set("visible_agents".to_string(), json);
        settings.save().map_err(|e| e.to_string())?;
    }

    // Clean up symlinks for newly hidden agents
    for agent in crate::config::AGENTS {
        let was_visible = old_visible.get(agent.id).copied().unwrap_or(crate::config::default_visibility(agent.id));
        let now_visible = visible_agents.get(agent.id).copied().unwrap_or(crate::config::default_visibility(agent.id));
        if was_visible && !now_visible {
            let _ = crate::services::skill::SkillService::remove_agent_symlinks(agent.id);
        }
    }

    Ok(())
}

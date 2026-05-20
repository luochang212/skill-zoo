use crate::services::cli::CliService;
use crate::services::lock::SkillLock;
use crate::store::AppState;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use tauri::State;

#[tauri::command]
pub fn clear_download_cache() -> Result<u64, String> {
    let cache_dir = crate::config::get_repo_zip_cache_dir();
    if !cache_dir.exists() {
        return Ok(0);
    }
    let mut freed: u64 = 0;
    let entries = std::fs::read_dir(&cache_dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        if let Ok(meta) = entry.metadata() {
            if meta.is_file() {
                freed += meta.len();
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    Ok(freed)
}

#[tauri::command]
pub fn get_cache_size() -> Result<u64, String> {
    let cache_dir = crate::config::get_repo_zip_cache_dir();
    if !cache_dir.exists() {
        return Ok(0);
    }
    let mut total: u64 = 0;
    let entries = std::fs::read_dir(&cache_dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        if let Ok(meta) = entry.metadata() {
            if meta.is_file() {
                total += meta.len();
            }
        }
    }
    Ok(total)
}

#[tauri::command]
pub fn open_cache_dir() -> Result<(), String> {
    let cache_dir = crate::config::get_repo_zip_cache_dir();
    std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&cache_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&cache_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&cache_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

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
pub fn get_settings(state: State<'_, AppState>) -> Result<HashMap<String, String>, String> {
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
pub fn get_visible_agents(state: State<'_, AppState>) -> Result<HashMap<String, bool>, String> {
    let settings = state.settings.lock().map_err(|e| e.to_string())?;
    Ok(crate::services::skill::SkillService::get_visible_agents(
        &settings,
    ))
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
        let was_visible = old_visible
            .get(agent.id)
            .copied()
            .unwrap_or(crate::config::default_visibility(agent.id));
        let now_visible = visible_agents
            .get(agent.id)
            .copied()
            .unwrap_or(crate::config::default_visibility(agent.id));
        if was_visible && !now_visible {
            let _ = crate::services::skill::SkillService::remove_agent_symlinks(agent.id);
        }
    }

    Ok(())
}

// ────────────── Check skill updates ──────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillUpdateStatus {
    pub skill_name: String,
    pub has_update: bool,
    pub current_sha: Option<String>,
    pub latest_sha: Option<String>,
    pub repo: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckUpdatesResult {
    pub skills: Vec<SkillUpdateStatus>,
    pub total_repos: usize,
    pub checked_repos: usize,
    pub rate_limited: bool,
}

#[tauri::command]
pub async fn check_skill_updates() -> Result<CheckUpdatesResult, String> {
    let lock = SkillLock::read().map_err(|e| e.to_string())?;

    // Collect unique (owner, repo, branch) tuples
    let mut repos: Vec<(String, String, String)> = Vec::new();
    let mut seen: HashSet<(String, String, String)> = HashSet::new();

    for entry in lock.skills.values() {
        let (owner, name) = entry.parse_source_owner_name();
        let (Some(owner), Some(name)) = (owner, name) else {
            continue;
        };
        let branch = entry.branch.clone().unwrap_or_else(|| "main".to_string());
        let key = (owner.clone(), name.clone(), branch.clone());
        if seen.insert(key.clone()) {
            repos.push(key);
        }
    }

    let total_repos = repos.len();
    let mut checked_repos: usize = 0;
    let mut rate_limited = false;
    // Map: (owner, name) -> latest_sha (None = rate-limited for this repo)
    let mut latest_shas: HashMap<(String, String), Option<String>> = HashMap::new();

    for (owner, name, branch) in &repos {
        if rate_limited {
            break;
        }
        match CliService::fetch_latest_commit_sha(owner, name, branch).await {
            Ok(Some(sha)) => {
                latest_shas.insert((owner.clone(), name.clone()), Some(sha));
                checked_repos += 1;
            }
            Ok(None) => {
                // rate limited — stop checking, mark this repo as unknown
                rate_limited = true;
                latest_shas.insert((owner.clone(), name.clone()), None);
            }
            Err(_) => continue, // network error — skip this repo
        }
    }

    // Build per-skill status
    let mut skills: Vec<SkillUpdateStatus> = Vec::new();
    for (skill_name, entry) in &lock.skills {
        let (Some(owner), Some(name)) = entry.parse_source_owner_name() else {
            continue;
        };
        let repo_key = (owner.clone(), name.clone());
        let latest_sha = latest_shas.get(&repo_key).cloned().flatten();
        let current_sha = entry.commit_sha.clone();

        let has_update = match (&latest_sha, &current_sha) {
            (Some(latest), Some(current)) => latest != current,
            _ => false,
        };

        skills.push(SkillUpdateStatus {
            skill_name: skill_name.clone(),
            has_update,
            current_sha,
            latest_sha,
            repo: format!("{owner}/{name}"),
        });
    }

    // For skills whose latest SHA we fetched but had no stored SHA,
    // save the latest SHA now (they were up-to-date at install time).
    for (skill_name, entry) in &lock.skills {
        let (Some(owner), Some(name)) = entry.parse_source_owner_name() else {
            continue;
        };
        let repo_key = (owner, name);
        if let Some(Some(latest)) = latest_shas.get(&repo_key) {
            if entry.commit_sha.is_none() {
                let _ = SkillLock::update_commit_sha(skill_name, latest);
            }
        }
    }

    Ok(CheckUpdatesResult {
        skills,
        total_repos,
        checked_repos,
        rate_limited,
    })
}

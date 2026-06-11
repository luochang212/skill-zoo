use crate::services::cli::CliService;
use crate::services::lock::{SkillLock, SkillLockEntry};
use crate::store::AppState;
use serde::Serialize;
use std::collections::HashMap;
use tauri::State;
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub fn is_portable_build() -> bool {
    cfg!(feature = "portable")
}

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
                if std::fs::remove_file(entry.path()).is_ok() {
                    freed += meta.len();
                }
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
pub fn open_cache_dir(app_handle: tauri::AppHandle) -> Result<(), String> {
    let cache_dir = crate::config::get_repo_zip_cache_dir();
    std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    app_handle
        .opener()
        .open_path(cache_dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
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
    use rand::seq::SliceRandom;

    let lock = SkillLock::read().map_err(|e| e.to_string())?;

    // Group skills by (owner, repo, branch) to minimize API calls
    let mut skills_by_repo: HashMap<(String, String, String), Vec<(String, SkillLockEntry)>> =
        HashMap::new();

    for (skill_name, entry) in &lock.skills {
        let (owner, name) = entry.parse_source_owner_name();
        let (Some(owner), Some(name)) = (owner, name) else {
            continue;
        };
        let branch = entry.branch.clone().unwrap_or_else(|| "main".to_string());
        let key = (owner.clone(), name.clone(), branch.clone());
        skills_by_repo
            .entry(key)
            .or_default()
            .push((skill_name.clone(), entry.clone()));
    }

    let total_repos = skills_by_repo.len();
    let mut checked_repos: usize = 0;
    let mut rate_limited = false;

    // Map: skill_name -> (latest_folder_sha, repo_name)
    let mut skill_shas: HashMap<String, (Option<String>, String)> = HashMap::new();

    // Randomize repo order for fairness when rate-limited
    let mut repos: Vec<(String, String, String)> = skills_by_repo.keys().cloned().collect();
    repos.shuffle(&mut rand::thread_rng());

    for (owner, repo, branch) in repos {
        if rate_limited {
            break;
        }

        let repo_key = (owner.clone(), repo.clone(), branch.clone());
        let Some(skills_in_repo) = skills_by_repo.get(&repo_key) else {
            continue;
        };

        match CliService::fetch_repo_tree(&owner, &repo, &branch).await {
            Ok(Some(tree)) => {
                checked_repos += 1;

                // One API call → all skills in this repo get their folder SHA
                for (skill_name, entry) in skills_in_repo {
                    let skill_path = entry.skill_path.as_deref().unwrap_or("");
                    let folder_sha = CliService::get_folder_sha_from_tree(&tree, skill_path);
                    skill_shas.insert(skill_name.clone(), (folder_sha, repo.clone()));
                }
            }
            Ok(None) => {
                // Repo not found or branch doesn't exist — skip, continue
                for (skill_name, _) in skills_in_repo {
                    skill_shas.insert(skill_name.clone(), (None, repo.clone()));
                }
            }
            Err(crate::error::AppError::RateLimited(_)) => {
                // Actually rate limited — stop further requests
                rate_limited = true;
                for (skill_name, _) in skills_in_repo {
                    skill_shas.insert(skill_name.clone(), (None, repo.clone()));
                }
            }
            Err(_) => {
                // Network error — skip this repo, don't stop
                for (skill_name, _) in skills_in_repo {
                    skill_shas.insert(skill_name.clone(), (None, repo.clone()));
                }
            }
        }
    }

    // Build per-skill status
    let mut skills: Vec<SkillUpdateStatus> = Vec::new();
    for (skill_name, entry) in &lock.skills {
        let (Some(owner), Some(name)) = entry.parse_source_owner_name() else {
            continue;
        };

        let fallback = (None, format!("{owner}/{name}"));
        let (latest_sha_opt, repo_name) = skill_shas.get(skill_name).unwrap_or(&fallback);
        let current_sha = entry.commit_sha.clone();

        let has_update = match (latest_sha_opt, &current_sha) {
            (Some(latest), Some(current)) => latest != current,
            _ => false,
        };

        skills.push(SkillUpdateStatus {
            skill_name: skill_name.clone(),
            has_update,
            current_sha,
            latest_sha: latest_sha_opt.clone(),
            repo: repo_name.clone(),
        });
    }

    // For skills whose latest SHA we fetched but had no stored SHA,
    // save the latest SHA now (they were up-to-date at install time).
    for (skill_name, entry) in &lock.skills {
        if let (Some((Some(latest), _)), None) =
            (skill_shas.get(skill_name), entry.commit_sha.as_ref())
        {
            let _ = SkillLock::update_commit_sha(skill_name, latest);
        }
    }

    Ok(CheckUpdatesResult {
        skills,
        total_repos,
        checked_repos,
        rate_limited,
    })
}

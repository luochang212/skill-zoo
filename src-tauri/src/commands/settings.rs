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
            if meta.is_file() && std::fs::remove_file(entry.path()).is_ok() {
                freed += meta.len();
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPreferences {
    visible_agents: HashMap<String, bool>,
    agent_order: Vec<String>,
}

fn normalize_agent_order(
    visible_agents: &HashMap<String, bool>,
    agent_order: &[String],
) -> Vec<String> {
    let mut ordered = Vec::with_capacity(crate::config::AGENTS.len());

    for agent_id in agent_order {
        if crate::config::AGENTS
            .iter()
            .any(|agent| agent.id == agent_id)
            && !ordered.contains(agent_id)
        {
            ordered.push(agent_id.clone());
        }
    }

    for agent in crate::config::AGENTS {
        if !ordered.iter().any(|agent_id| agent_id == agent.id) {
            ordered.push(agent.id.to_string());
        }
    }

    let is_visible = |agent_id: &str| {
        visible_agents
            .get(agent_id)
            .copied()
            .unwrap_or_else(|| crate::config::default_visibility(agent_id))
    };
    let (visible, hidden): (Vec<_>, Vec<_>) = ordered
        .into_iter()
        .partition(|agent_id| is_visible(agent_id));
    visible.into_iter().chain(hidden).collect()
}

fn has_visible_agent(visible_agents: &HashMap<String, bool>) -> bool {
    crate::config::AGENTS.iter().any(|agent| {
        visible_agents
            .get(agent.id)
            .copied()
            .unwrap_or_else(|| crate::config::default_visibility(agent.id))
    })
}

fn set_agent_preference_values(
    settings: &mut crate::persistence::Settings,
    visible_agents: &HashMap<String, bool>,
    agent_order: &[String],
) -> Result<(), String> {
    let visible_json = serde_json::to_string(visible_agents).map_err(|e| e.to_string())?;
    let order_json = serde_json::to_string(agent_order).map_err(|e| e.to_string())?;
    settings.set("visible_agents".to_string(), visible_json);
    settings.set("agent_order".to_string(), order_json);
    Ok(())
}

const MAX_VISIBLE_AGENTS: usize = 7;

#[tauri::command]
pub fn update_agent_preferences(
    state: State<'_, AppState>,
    visible_agents: HashMap<String, bool>,
    agent_order: Vec<String>,
) -> Result<AgentPreferences, String> {
    if !has_visible_agent(&visible_agents) {
        return Err("At least one agent must remain visible".to_string());
    }

    let visible_count = visible_agents.values().filter(|v| **v).count();
    if visible_count > MAX_VISIBLE_AGENTS {
        return Err(format!(
            "At most {} agents can be visible ({} visible now)",
            MAX_VISIBLE_AGENTS, visible_count,
        ));
    }

    let normalized_order = normalize_agent_order(&visible_agents, &agent_order);
    let old_visible;

    {
        let mut settings = state.settings.lock().map_err(|e| e.to_string())?;
        old_visible = crate::services::skill::SkillService::get_visible_agents(&settings);
        let previous = settings.clone();
        set_agent_preference_values(&mut settings, &visible_agents, &normalized_order)?;
        if let Err(error) = settings.save() {
            *settings = previous;
            return Err(error.to_string());
        }
    }

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

    Ok(AgentPreferences {
        visible_agents,
        agent_order: normalized_order,
    })
}

#[cfg(test)]
mod agent_preferences_tests {
    use super::{has_visible_agent, normalize_agent_order, set_agent_preference_values};
    use std::collections::HashMap;

    #[test]
    fn normalizes_known_agents_with_visible_agents_first() {
        let visible = HashMap::from([
            ("claude-code".to_string(), true),
            ("codex".to_string(), false),
            ("cursor".to_string(), true),
        ]);
        let order = vec![
            "codex".to_string(),
            "unknown".to_string(),
            "cursor".to_string(),
            "cursor".to_string(),
            "claude-code".to_string(),
        ];

        let normalized = normalize_agent_order(&visible, &order);

        assert_eq!(&normalized[..2], ["cursor", "claude-code"]);
        assert!(normalized.iter().position(|id| id == "codex").unwrap() >= 2);
        assert!(!normalized.iter().any(|id| id == "unknown"));
        assert_eq!(normalized.len(), crate::config::AGENTS.len());
    }

    #[test]
    fn rejects_preferences_without_a_visible_agent() {
        let hidden = crate::config::AGENTS
            .iter()
            .map(|agent| (agent.id.to_string(), false))
            .collect();

        assert!(!has_visible_agent(&hidden));
    }

    #[test]
    fn updates_visibility_and_order_together() {
        let visible = HashMap::from([
            ("claude-code".to_string(), true),
            ("codex".to_string(), false),
        ]);
        let order = vec!["claude-code".to_string(), "codex".to_string()];
        let mut settings = crate::persistence::Settings {
            values: HashMap::new(),
        };

        set_agent_preference_values(&mut settings, &visible, &order).unwrap();

        assert_eq!(
            serde_json::from_str::<HashMap<String, bool>>(settings.get("visible_agents").unwrap())
                .unwrap(),
            visible
        );
        assert_eq!(
            serde_json::from_str::<Vec<String>>(settings.get("agent_order").unwrap()).unwrap(),
            order
        );
    }
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
    pub check_error_code: Option<String>,
    pub check_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckUpdatesResult {
    pub skills: Vec<SkillUpdateStatus>,
    pub total_repos: usize,
    pub checked_repos: usize,
    pub rate_limited: bool,
}

#[derive(Debug, Clone)]
struct CheckedRemoteSkill {
    latest_sha: Option<String>,
    repo: String,
    check_error_code: Option<String>,
    check_error: Option<String>,
}

impl CheckedRemoteSkill {
    fn ok(latest_sha: Option<String>, repo: String) -> Self {
        Self {
            latest_sha,
            repo,
            check_error_code: None,
            check_error: None,
        }
    }

    fn error(repo: String, code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            latest_sha: None,
            repo,
            check_error_code: Some(code.into()),
            check_error: Some(message.into()),
        }
    }
}

fn repo_branch_ref(owner: &str, repo: &str, branch: &str) -> String {
    format!("{owner}/{repo}@{branch}")
}

fn missing_remote_path_error(owner: &str, repo: &str, branch: &str, skill_path: &str) -> String {
    let remote_ref = repo_branch_ref(owner, repo, branch);
    if skill_path.is_empty() {
        format!("Skill root no longer exists in {remote_ref}")
    } else {
        format!("Skill path no longer exists in {remote_ref}: {skill_path}")
    }
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

    let mut checked_skills: HashMap<String, CheckedRemoteSkill> = HashMap::new();

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
                    let checked = match folder_sha {
                        Some(sha) => CheckedRemoteSkill::ok(Some(sha), repo.clone()),
                        None => CheckedRemoteSkill::error(
                            repo.clone(),
                            "missingRemotePath",
                            missing_remote_path_error(&owner, &repo, &branch, skill_path),
                        ),
                    };
                    checked_skills.insert(skill_name.clone(), checked);
                }
            }
            Ok(None) => {
                // Repo not found or branch doesn't exist — skip, continue
                checked_repos += 1;

                for (skill_name, _) in skills_in_repo {
                    checked_skills.insert(
                        skill_name.clone(),
                        CheckedRemoteSkill::error(
                            repo.clone(),
                            "repoUnavailable",
                            format!(
                                "Repository or branch could not be found: {}",
                                repo_branch_ref(&owner, &repo, &branch)
                            ),
                        ),
                    );
                }
            }
            Err(crate::error::AppError::RateLimited(_)) => {
                // Actually rate limited — stop further requests
                rate_limited = true;
                for (skill_name, _) in skills_in_repo {
                    checked_skills.insert(
                        skill_name.clone(),
                        CheckedRemoteSkill::error(
                            repo.clone(),
                            "rateLimited",
                            format!(
                                "GitHub rate limit stopped update checks for {}",
                                repo_branch_ref(&owner, &repo, &branch)
                            ),
                        ),
                    );
                }
            }
            Err(error) => {
                // Network error — skip this repo, don't stop
                for (skill_name, _) in skills_in_repo {
                    checked_skills.insert(
                        skill_name.clone(),
                        CheckedRemoteSkill::error(
                            repo.clone(),
                            "checkFailed",
                            format!(
                                "Could not check updates for {}: {}",
                                repo_branch_ref(&owner, &repo, &branch),
                                error
                            ),
                        ),
                    );
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

        let checked = checked_skills.get(skill_name).cloned().unwrap_or_else(|| {
            if rate_limited {
                CheckedRemoteSkill::error(
                    format!("{owner}/{name}"),
                    "rateLimited",
                    "Skipped because GitHub rate limit stopped update checks.",
                )
            } else {
                CheckedRemoteSkill::ok(None, format!("{owner}/{name}"))
            }
        });
        let current_sha = entry.commit_sha.clone();

        let has_update = match (&checked.latest_sha, &current_sha) {
            (Some(latest), Some(current)) => latest != current,
            _ => false,
        };

        skills.push(SkillUpdateStatus {
            skill_name: skill_name.clone(),
            has_update,
            current_sha,
            latest_sha: checked.latest_sha,
            repo: checked.repo,
            check_error_code: checked.check_error_code,
            check_error: checked.check_error,
        });
    }

    // For skills whose latest SHA we fetched but had no stored SHA,
    // save the latest SHA now (they were up-to-date at install time).
    for (skill_name, entry) in &lock.skills {
        if let (
            Some(CheckedRemoteSkill {
                latest_sha: Some(latest),
                ..
            }),
            None,
        ) = (checked_skills.get(skill_name), entry.commit_sha.as_ref())
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

#[cfg(test)]
mod skill_update_check_tests {
    use super::missing_remote_path_error;

    #[test]
    fn missing_remote_path_error_names_repo_branch_and_path() {
        assert_eq!(
            missing_remote_path_error("owner", "repo", "main", "skills/demo"),
            "Skill path no longer exists in owner/repo@main: skills/demo"
        );
    }
}

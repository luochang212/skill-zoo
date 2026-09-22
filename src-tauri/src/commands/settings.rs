use crate::services::cli::CliService;
use crate::services::lock::{SkillLock, SkillLockEntry};
use crate::services::skill_usage::SkillUsage;
use crate::services::tray::{
    validate_skill_companion_items, SkillCompanionItem, SKILL_COMPANION_ITEMS_SETTING,
};
use crate::store::AppState;
use base64::Engine;
use serde::Serialize;
use std::collections::HashMap;
use tauri::State;
use tauri_plugin_opener::OpenerExt;

type UpdateRepoKey = (String, String, Option<String>);
type UpdateRepoEntries = Vec<(String, SkillLockEntry)>;

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

fn decode_png_data_url(data_url: &str) -> Result<Vec<u8>, String> {
    const PREFIX: &str = "data:image/png;base64,";
    let encoded = data_url
        .strip_prefix(PREFIX)
        .ok_or_else(|| "expected a data:image/png;base64,... URL".to_string())?;
    base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| format!("PNG data URL decode failed: {e}"))
}

#[tauri::command]
pub fn save_skill_usage_screenshot(data_url: String) -> Result<String, String> {
    let bytes = decode_png_data_url(&data_url)?;
    let desktop_dir =
        dirs::desktop_dir().ok_or_else(|| "Desktop directory not found".to_string())?;
    let filename = chrono::Local::now()
        .format("Skill Zoo Skill Preferences %Y-%m-%d at %H.%M.%S.png")
        .to_string();
    let path = desktop_dir.join(filename);
    std::fs::write(&path, bytes).map_err(|e| format!("Screenshot save failed: {e}"))?;
    Ok(path.to_string_lossy().to_string())
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
pub fn get_skill_companion_items(
    state: State<'_, AppState>,
) -> Result<Vec<SkillCompanionItem>, String> {
    let settings = state.settings.lock().map_err(|e| e.to_string())?;
    Ok(crate::services::tray::parse_skill_companion_items(
        &settings,
    ))
}

#[tauri::command]
pub fn save_skill_companion_items(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    items: Vec<SkillCompanionItem>,
) -> Result<Vec<SkillCompanionItem>, String> {
    validate_skill_companion_items(&items)?;
    let json = serde_json::to_string(&items).map_err(|e| e.to_string())?;
    {
        let mut settings = state.settings.lock().map_err(|e| e.to_string())?;
        let previous = settings.clone();
        settings.set(SKILL_COMPANION_ITEMS_SETTING.to_string(), json);
        if let Err(error) = settings.save() {
            *settings = previous;
            return Err(error.to_string());
        }
    }
    if let Err(error) = crate::services::tray::refresh_skill_companion_menu(&app_handle) {
        eprintln!("Failed to refresh skill companion tray menu after saving settings: {error}");
    }
    Ok(items)
}

#[tauri::command]
pub fn set_tray_language(app_handle: tauri::AppHandle, language: String) -> Result<(), String> {
    crate::services::tray::set_tray_language(&app_handle, &language)
}

#[tauri::command]
pub async fn get_skill_usage(
    state: State<'_, AppState>,
    agent_id: String,
) -> Result<SkillUsage, String> {
    let (whitelist, installed_skill_count) = {
        let cache = state.skill_cache.read().map_err(|e| e.to_string())?;
        crate::services::skill_usage::skill_whitelist(&cache, &agent_id)
    };
    tokio::task::spawn_blocking(move || {
        crate::services::skill_usage::discover_skill_usage(
            &agent_id,
            whitelist,
            installed_skill_count,
        )
    })
    .await
    .map_err(|e| format!("Skill usage scan failed: {e}"))
}

#[tauri::command]
pub fn get_visible_agents(state: State<'_, AppState>) -> Result<HashMap<String, bool>, String> {
    let settings = state.settings.lock().map_err(|e| e.to_string())?;
    Ok(crate::services::skill::SkillService::get_visible_agents(
        &settings,
    ))
}

#[cfg(test)]
mod tests {
    use super::decode_png_data_url;
    use base64::Engine;

    #[test]
    fn decodes_png_data_url() {
        let encoded = base64::engine::general_purpose::STANDARD.encode([1_u8, 2, 3]);
        let data_url = format!("data:image/png;base64,{encoded}");
        assert_eq!(decode_png_data_url(&data_url).unwrap(), vec![1, 2, 3]);
    }

    #[test]
    fn rejects_non_png_data_url() {
        let encoded = base64::engine::general_purpose::STANDARD.encode([1_u8, 2, 3]);
        let data_url = format!("data:image/jpeg;base64,{encoded}");
        assert!(decode_png_data_url(&data_url).is_err());
    }

    #[test]
    fn rejects_invalid_base64_png_data_url() {
        assert!(decode_png_data_url("data:image/png;base64,not valid base64").is_err());
    }
}

fn refresh_cached_agent_apps(state: &AppState) -> Result<(), String> {
    let mut cache = state.skill_cache.write().map_err(|e| e.to_string())?;
    let mut entries = cache.skills().to_vec();
    for entry in &mut entries {
        entry.apps =
            crate::services::skill::SkillService::detect_agents(&entry.directory, &entry.home_path);
    }
    cache.replace_all(entries);
    cache.save().map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPreferences {
    visible_agents: HashMap<String, bool>,
    agent_order: Vec<String>,
    link_cleanup_failed: bool,
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

fn persist_agent_preferences(
    settings: &mut crate::persistence::Settings,
    visible_agents: &HashMap<String, bool>,
    agent_order: &[String],
    persist: impl FnOnce(&crate::persistence::Settings) -> Result<(), String>,
) -> Result<(), String> {
    let previous = settings.clone();
    if let Err(error) = set_agent_preference_values(settings, visible_agents, agent_order) {
        *settings = previous;
        return Err(error);
    }
    if let Err(error) = persist(settings) {
        *settings = previous;
        return Err(error);
    }
    Ok(())
}

/// Best-effort removal of app-owned skill links from the directories of agents
/// that just became hidden. Never fails: returns whether cleanup could not
/// complete, so the caller can surface a concise notice instead of blocking
/// the visibility change. Details go to stderr for diagnosis.
fn cleanup_hidden_agent_links(
    hidden_agents: &[&str],
    agent_dirs: &[std::path::PathBuf],
    known_home_paths: &[std::path::PathBuf],
) -> bool {
    match crate::services::skill::SkillService::stage_agent_symlink_removal_in_dirs(
        agent_dirs,
        known_home_paths,
    ) {
        Ok(staged) => {
            let skipped = staged.skipped_unowned_links;
            if skipped > 0 {
                eprintln!(
                    "Skipped {skipped} foreign or unrecognized skill link(s) while hiding {} (links left in place)",
                    hidden_agents.join(", ")
                );
            }
            staged.commit();
            false
        }
        Err(error) => {
            eprintln!(
                "Skill link cleanup failed while hiding {} (links left in place): {error}",
                hidden_agents.join(", ")
            );
            true
        }
    }
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

    // The visibility preference is the contract: persist it first and let it
    // be the only hard failure. Link cleanup below is best-effort hygiene.
    let old_visible = {
        let mut settings = state.settings.lock().map_err(|e| e.to_string())?;
        let old_visible = crate::services::skill::SkillService::get_visible_agents(&settings);
        persist_agent_preferences(
            &mut settings,
            &visible_agents,
            &normalized_order,
            |settings| settings.save().map_err(|e| e.to_string()),
        )?;
        old_visible
    };

    let mut hidden_agents = Vec::new();
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
            hidden_agents.push(agent.id);
        }
    }

    let mut link_cleanup_failed = false;
    if !hidden_agents.is_empty() {
        let agent_dirs = hidden_agents
            .iter()
            .filter_map(|agent| crate::config::get_agent_skills_dir(agent))
            .collect::<Vec<_>>();
        let known_home_paths = state
            .skill_cache
            .read()
            .map(|cache| {
                cache
                    .skills()
                    .iter()
                    .filter_map(|entry| entry.home_path.as_ref().map(std::path::PathBuf::from))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        link_cleanup_failed =
            cleanup_hidden_agent_links(&hidden_agents, &agent_dirs, &known_home_paths);
        if let Err(error) = refresh_cached_agent_apps(&state) {
            eprintln!("Failed to refresh cached agent links after hiding agents: {error}");
        }
    }

    Ok(AgentPreferences {
        visible_agents,
        agent_order: normalized_order,
        link_cleanup_failed,
    })
}

#[cfg(test)]
mod agent_preferences_tests {
    use super::{
        cleanup_hidden_agent_links, has_visible_agent, normalize_agent_order,
        persist_agent_preferences, set_agent_preference_values,
    };
    use crate::services::skill::{symlink_target_matches, SkillService};
    use std::collections::HashMap;
    use std::path::PathBuf;

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

    #[test]
    fn persist_failure_restores_settings_and_reports_error() {
        let mut settings = crate::persistence::Settings {
            values: HashMap::from([("theme".to_string(), "dark".to_string())]),
        };
        let previous = settings.clone();
        let visible = HashMap::from([
            ("claude-code".to_string(), true),
            ("codex".to_string(), false),
        ]);
        let order = vec!["claude-code".to_string(), "codex".to_string()];

        let error = persist_agent_preferences(&mut settings, &visible, &order, |_| {
            Err("settings save failed".to_string())
        })
        .unwrap_err();

        assert_eq!(error, "settings save failed");
        assert_eq!(settings.values, previous.values);
    }

    fn hidden_agent_fixture(root: &std::path::Path) -> (PathBuf, PathBuf) {
        let agent_dir = root.join("openclaw/skills");
        let home = root.join("agents-store/mine");
        std::fs::create_dir_all(&agent_dir).unwrap();
        std::fs::create_dir_all(&home).unwrap();
        SkillService::create_link_to_target_for_test(&home, &agent_dir.join("mine")).unwrap();
        (agent_dir, home)
    }

    #[test]
    fn cleanup_success_returns_false_and_removes_owned_links() {
        let root = tempfile::tempdir().expect("tempdir");
        let (agent_dir, home) = hidden_agent_fixture(root.path());

        let failed =
            cleanup_hidden_agent_links(&["openclaw"], &[agent_dir.clone()], &[home.clone()]);

        assert!(!failed);
        assert!(std::fs::symlink_metadata(agent_dir.join("mine")).is_err());
        assert!(home.is_dir());
    }

    #[test]
    #[cfg(unix)]
    fn cleanup_failure_on_readonly_skills_dir_degrades_instead_of_failing() {
        let root = tempfile::tempdir().expect("tempdir");
        let (agent_dir, home) = hidden_agent_fixture(root.path());
        use std::os::unix::fs::PermissionsExt;
        let original = std::fs::metadata(&agent_dir).unwrap().permissions();
        let mut perms = original.clone();
        perms.set_mode(0o500);
        std::fs::set_permissions(&agent_dir, perms).unwrap();

        let failed =
            cleanup_hidden_agent_links(&["openclaw"], &[agent_dir.clone()], &[home.clone()]);

        assert!(failed);
        assert!(symlink_target_matches(&agent_dir.join("mine"), &home));

        std::fs::set_permissions(&agent_dir, original).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn cleanup_failure_on_readonly_agent_home_degrades_instead_of_failing() {
        let root = tempfile::tempdir().expect("tempdir");
        let (agent_dir, home) = hidden_agent_fixture(root.path());
        use std::os::unix::fs::PermissionsExt;
        let agent_home = agent_dir.parent().unwrap();
        let original = std::fs::metadata(agent_home).unwrap().permissions();
        let mut perms = original.clone();
        perms.set_mode(0o555);
        std::fs::set_permissions(agent_home, perms).unwrap();

        let failed =
            cleanup_hidden_agent_links(&["openclaw"], &[agent_dir.clone()], &[home.clone()]);

        assert!(failed);
        assert!(symlink_target_matches(&agent_dir.join("mine"), &home));

        std::fs::set_permissions(agent_home, original).unwrap();
    }

    #[test]
    fn cleanup_skips_foreign_links_without_failing() {
        let root = tempfile::tempdir().expect("tempdir");
        let (agent_dir, home) = hidden_agent_fixture(root.path());
        let foreign = root.path().join("foreign/thing");
        std::fs::create_dir_all(&foreign).unwrap();
        SkillService::create_link_to_target_for_test(&foreign, &agent_dir.join("theirs")).unwrap();

        let failed =
            cleanup_hidden_agent_links(&["openclaw"], &[agent_dir.clone()], &[home.clone()]);

        assert!(!failed);
        assert!(std::fs::symlink_metadata(agent_dir.join("theirs")).is_ok());
        assert!(std::fs::symlink_metadata(agent_dir.join("mine")).is_err());
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

fn repo_branch_ref(owner: &str, repo: &str, branch: Option<&str>) -> String {
    match branch {
        Some(branch) => format!("{owner}/{repo}@{branch}"),
        None => format!("{owner}/{repo}@default"),
    }
}

fn missing_remote_path_error(
    owner: &str,
    repo: &str,
    branch: Option<&str>,
    skill_path: &str,
) -> String {
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
    let mut skills_by_repo: HashMap<UpdateRepoKey, UpdateRepoEntries> = HashMap::new();

    for (skill_name, entry) in &lock.skills {
        let (owner, name) = entry.parse_source_owner_name();
        let (Some(owner), Some(name)) = (owner, name) else {
            continue;
        };
        let branch = entry.branch.clone();
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
    let mut repos: Vec<(String, String, Option<String>)> = skills_by_repo.keys().cloned().collect();
    repos.shuffle(&mut rand::rng());

    for (owner, repo, branch) in repos {
        if rate_limited {
            break;
        }

        let repo_key = (owner.clone(), repo.clone(), branch.clone());
        let Some(skills_in_repo) = skills_by_repo.get(&repo_key) else {
            continue;
        };

        match CliService::fetch_repo_tree(&owner, &repo, branch.as_deref()).await {
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
                            missing_remote_path_error(&owner, &repo, branch.as_deref(), skill_path),
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
                                repo_branch_ref(&owner, &repo, branch.as_deref())
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
                                repo_branch_ref(&owner, &repo, branch.as_deref())
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
                                repo_branch_ref(&owner, &repo, branch.as_deref()),
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
            missing_remote_path_error("owner", "repo", Some("main"), "skills/demo"),
            "Skill path no longer exists in owner/repo@main: skills/demo"
        );
    }
}

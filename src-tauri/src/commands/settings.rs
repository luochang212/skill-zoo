use crate::config;
use crate::services::cli::CliService;
use crate::services::lock::{BaselineConflictResolution, SkillLock, SkillLockEntry};
use crate::services::opener::open_directory;
use crate::services::skill_usage::SkillUsage;
use crate::services::tray::{
    validate_skill_companion_items, SkillCompanionItem, SKILL_COMPANION_ITEMS_SETTING,
};
use crate::store::AppState;
use base64::Engine;
use serde::Serialize;
use std::collections::HashMap;
use tauri::State;

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
    open_directory(&app_handle, &cache_dir)
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

/// The GitHub credential keys: hidden from the generic read (the UI asks
/// `get_github_credential_status` instead) and writable only through
/// `save_github_credentials`, which keeps the runtime slot in sync. One list
/// backs both the read filter and the write guard.
const CREDENTIAL_KEYS: &[&str] = &["github_token", "github_token_expires_at"];

fn visible_settings(values: &HashMap<String, String>) -> HashMap<String, String> {
    values
        .iter()
        .filter(|(key, _)| !CREDENTIAL_KEYS.contains(&key.as_str()))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect()
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<HashMap<String, String>, String> {
    let settings = state.settings.lock().map_err(|e| e.to_string())?;
    Ok(visible_settings(&settings.values))
}

/// Saved-state view of the credential: existence and recorded expiry, never
/// the token itself (the write-only contract).
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubCredentialStatus {
    pub has_token: bool,
    pub expires_at: Option<String>,
}

fn credential_status(values: &HashMap<String, String>) -> GitHubCredentialStatus {
    GitHubCredentialStatus {
        has_token: values
            .get("github_token")
            .is_some_and(|token| !token.trim().is_empty()),
        expires_at: values
            .get("github_token_expires_at")
            .filter(|value| !value.trim().is_empty())
            .cloned(),
    }
}

#[tauri::command]
pub fn get_github_credential_status(
    state: State<'_, AppState>,
) -> Result<GitHubCredentialStatus, String> {
    let settings = state.settings.lock().map_err(|e| e.to_string())?;
    Ok(credential_status(&settings.values))
}

#[tauri::command]
pub fn update_setting(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    if let Some(error) = credential_key_violation(&key) {
        return Err(error);
    }
    let _agent_lease = crate::persistence::agent_transaction::AgentLease::acquire(
        &crate::config::get_app_config_dir(),
    )
    .map_err(|e| e.to_string())?;
    let mut settings = state.settings.lock().map_err(|e| e.to_string())?;
    settings.set(key, value);
    settings.save().map_err(|e| e.to_string())
}

/// The credential keys are owned by the credential save command: a generic
/// write would persist without refreshing the runtime slot, pairing a new
/// token with a stale expiry. Fail loudly instead of silently bypassing it.
fn credential_key_violation(key: &str) -> Option<String> {
    CREDENTIAL_KEYS.contains(&key).then(|| {
        "GitHub credentials must be changed through the save_github_credentials command".to_string()
    })
}

/// Owns the GitHub credential keys: token and expiry persist in one settings
/// write, so runtime authentication can never pair a new token with a stale
/// expiry, and the runtime slot refreshes only after the save succeeds.
#[tauri::command]
pub fn save_github_credentials(
    state: State<'_, AppState>,
    token: String,
    expires_at: Option<String>,
) -> Result<(), String> {
    let _agent_lease = crate::persistence::agent_transaction::AgentLease::acquire(
        &crate::config::get_app_config_dir(),
    )
    .map_err(|e| e.to_string())?;
    let mut settings = state.settings.lock().map_err(|e| e.to_string())?;
    persist_github_credentials(&mut settings, &token, expires_at.as_deref().unwrap_or(""))
}

fn persist_github_credentials(
    settings: &mut crate::persistence::Settings,
    token: &str,
    expires_at: &str,
) -> Result<(), String> {
    let token = token.trim();
    let expires_at = expires_at.trim();
    let previous = settings.clone();
    if token.is_empty() {
        settings.values.remove("github_token");
        settings.values.remove("github_token_expires_at");
    } else {
        settings.set("github_token".to_string(), token.to_string());
        if expires_at.is_empty() {
            settings.values.remove("github_token_expires_at");
        } else {
            settings.set(
                "github_token_expires_at".to_string(),
                expires_at.to_string(),
            );
        }
    }
    if let Err(error) = settings.save() {
        *settings = previous;
        return Err(error.to_string());
    }
    crate::config::set_github_credentials(Some(token), Some(expires_at));
    Ok(())
}

#[tauri::command]
pub async fn verify_github_token(
    token: String,
) -> Result<crate::services::github::GitHubTokenVerification, String> {
    crate::services::github::verify_github_token(&token).await
}

/// Live verification of the *saved* token for the credential dialog. The
/// token is read here, server-side, and never crosses the bridge — only the
/// verification result does.
/// The saved token for live verification, present only when a non-blank token
/// exists — the same "configured" view `credential_status` reports, so a
/// whitespace-only legacy value is never sent to GitHub.
fn verifiable_saved_token(values: &HashMap<String, String>) -> Option<String> {
    values
        .get("github_token")
        .filter(|token| !token.trim().is_empty())
        .cloned()
}

#[tauri::command]
pub async fn verify_saved_github_token(
    state: State<'_, AppState>,
) -> Result<crate::services::github::GitHubTokenVerification, String> {
    let token = {
        let settings = state.settings.lock().map_err(|e| e.to_string())?;
        verifiable_saved_token(&settings.values)
            .ok_or_else(|| "No saved GitHub token to verify".to_string())?
    };
    crate::services::github::verify_github_token(&token).await
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
    let _agent_lease = crate::persistence::agent_transaction::AgentLease::acquire(
        &crate::config::get_app_config_dir(),
    )
    .map_err(|e| e.to_string())?;
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
    use std::collections::HashMap;

    #[test]
    fn update_setting_rejects_credential_keys() {
        for key in ["github_token", "github_token_expires_at"] {
            let violation = super::credential_key_violation(key);
            assert!(
                violation.is_some_and(|e| e.contains("save_github_credentials")),
                "expected {key} to be rejected naming the save command"
            );
        }
        for key in ["theme", "hide_non_ssot", "github_token_expiry"] {
            assert!(super::credential_key_violation(key).is_none());
        }
    }

    #[test]
    fn visible_settings_omits_credential_keys_only() {
        let mut values = HashMap::new();
        values.insert("github_token".to_string(), "secret".to_string());
        values.insert(
            "github_token_expires_at".to_string(),
            "2026-11-13T00:00:00Z".to_string(),
        );
        values.insert("theme".to_string(), "dark".to_string());
        let visible = super::visible_settings(&values);
        assert!(visible.get("github_token").is_none());
        assert!(visible.get("github_token_expires_at").is_none());
        assert_eq!(visible.get("theme").map(String::as_str), Some("dark"));
    }

    #[test]
    fn credential_status_reports_existence_and_expiry_without_token() {
        let mut values = HashMap::new();
        assert!(!super::credential_status(&values).has_token);
        assert!(super::credential_status(&values).expires_at.is_none());

        values.insert("github_token".to_string(), "  ".to_string());
        assert!(
            !super::credential_status(&values).has_token,
            "blank token is no token"
        );

        values.insert("github_token".to_string(), "secret".to_string());
        let status = super::credential_status(&values);
        assert!(status.has_token);
        assert!(status.expires_at.is_none());
        // The serialized status carries no token material.
        let json = serde_json::to_string(&status).unwrap();
        assert!(!json.contains("secret"));

        values.insert(
            "github_token_expires_at".to_string(),
            "2026-11-13T16:14:49+00:00".to_string(),
        );
        assert_eq!(
            super::credential_status(&values).expires_at.as_deref(),
            Some("2026-11-13T16:14:49+00:00")
        );
    }

    #[test]
    fn verifiable_saved_token_matches_the_status_view_of_configured() {
        let mut values = HashMap::new();
        assert!(super::verifiable_saved_token(&values).is_none());
        values.insert("github_token".to_string(), "  ".to_string());
        assert!(
            super::verifiable_saved_token(&values).is_none(),
            "blank token is no token, same as credential_status"
        );
        values.insert("github_token".to_string(), "secret".to_string());
        assert_eq!(
            super::verifiable_saved_token(&values).as_deref(),
            Some("secret")
        );
    }

    #[test]
    fn github_credentials_save_persists_expiry_atomically_and_refreshes_runtime() {
        let home = tempfile::tempdir().unwrap();
        crate::config::with_test_home(home.path(), || {
            crate::config::with_test_github_credentials(None, None, || {
                let mut settings = crate::persistence::Settings::load().unwrap();
                settings.set("other".into(), "value".into());
                let future = (chrono::Utc::now() + chrono::Duration::days(30)).to_rfc3339();
                super::persist_github_credentials(&mut settings, "  test-token \n", &future)
                    .unwrap();
                assert_eq!(crate::config::github_token().as_deref(), Some("test-token"));
                let persisted = crate::persistence::Settings::load().unwrap();
                assert_eq!(
                    persisted.get("github_token").map(String::as_str),
                    Some("test-token")
                );
                assert_eq!(
                    persisted.get("github_token_expires_at").map(String::as_str),
                    Some(future.as_str())
                );
                assert_eq!(persisted.get("other").map(String::as_str), Some("value"));

                // A passed expiry stays persisted and stops authenticating.
                let past = (chrono::Utc::now() - chrono::Duration::days(1)).to_rfc3339();
                super::persist_github_credentials(&mut settings, "test-token", &past).unwrap();
                assert!(crate::config::github_token().is_none());
                assert_eq!(
                    crate::persistence::Settings::load()
                        .unwrap()
                        .get("github_token_expires_at")
                        .map(String::as_str),
                    Some(past.as_str())
                );

                // Blank input removes both keys and runtime credentials.
                super::persist_github_credentials(&mut settings, " \n", "").unwrap();
                assert!(crate::config::github_token().is_none());
                let persisted = crate::persistence::Settings::load().unwrap();
                assert!(persisted.get("github_token").is_none());
                assert!(persisted.get("github_token_expires_at").is_none());
            });
        });
    }

    #[test]
    fn failed_github_credentials_save_preserves_settings_and_runtime_credentials() {
        let home = tempfile::tempdir().unwrap();
        crate::config::with_test_home(home.path(), || {
            let future = (chrono::Utc::now() + chrono::Duration::days(30)).to_rfc3339();
            crate::config::with_test_github_credentials(
                Some("previous-token"),
                Some(&future),
                || {
                    let mut settings = crate::persistence::Settings {
                        values: std::collections::HashMap::from([
                            ("github_token".into(), "previous-token".into()),
                            ("github_token_expires_at".into(), future.clone()),
                        ]),
                    };
                    // An existing directory at the file path makes atomic replacement fail.
                    std::fs::create_dir_all(
                        crate::config::get_app_config_dir().join("settings.json"),
                    )
                    .unwrap();
                    let expired = (chrono::Utc::now() - chrono::Duration::days(1)).to_rfc3339();
                    for (token, expires_at) in [("new-token", expired.as_str()), ("", "")] {
                        assert!(super::persist_github_credentials(
                            &mut settings,
                            token,
                            expires_at
                        )
                        .is_err());
                        assert_eq!(
                            settings.get("github_token").map(String::as_str),
                            Some("previous-token")
                        );
                        assert_eq!(
                            settings.get("github_token_expires_at").map(String::as_str),
                            Some(future.as_str())
                        );
                        assert_eq!(
                            crate::config::github_token().as_deref(),
                            Some("previous-token")
                        );
                    }
                },
            );
        });
    }

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
    let mut ordered = Vec::with_capacity(crate::config::agents().len());

    for agent_id in agent_order {
        if crate::config::agents()
            .iter()
            .any(|agent| agent.id == *agent_id)
            && !ordered.contains(agent_id)
        {
            ordered.push(agent_id.clone());
        }
    }

    for agent in crate::config::agents().iter() {
        if !ordered.contains(&agent.id) {
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
    crate::config::agents().iter().any(|agent| {
        visible_agents
            .get(&agent.id)
            .copied()
            .unwrap_or_else(|| crate::config::default_visibility(&agent.id))
    })
}

/// The visible-agent cap only guards growth. A preference saved before the
/// limit existed can already exceed it; rejecting those updates as well would
/// leave the owner unable to toggle anything off (each toggle shrinks by one,
/// never enough), so only updates that grow past the cap are refused.
fn exceeds_visible_agent_cap(old_count: usize, new_count: usize) -> bool {
    new_count > MAX_VISIBLE_AGENTS && new_count > old_count
}

fn set_agent_preference_values(
    settings: &mut crate::persistence::Settings,
    visible_agents: &HashMap<String, bool>,
    agent_order: &[String],
) -> Result<(), String> {
    let mut persisted_visible = visible_agents.clone();
    let mut persisted_order = agent_order.to_vec();
    let previous_visible: HashMap<String, bool> = settings
        .get("visible_agents")
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    let previous_order: Vec<String> = settings
        .get("agent_order")
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    let snapshot = crate::config::agents();
    for builtin in crate::config::AGENTS
        .iter()
        .filter(|a| !snapshot.iter().any(|e| e.id == a.id))
    {
        if let Some(value) = previous_visible.get(&builtin.id) {
            persisted_visible.insert(builtin.id.clone(), *value);
        }
        if previous_order.contains(&builtin.id) {
            persisted_order.push(builtin.id.clone());
        }
    }
    let visible_json = serde_json::to_string(&persisted_visible).map_err(|e| e.to_string())?;
    let order_json = serde_json::to_string(&persisted_order).map_err(|e| e.to_string())?;
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

use crate::config::MAX_VISIBLE_AGENTS;

fn merge_registered_visibility(
    requested: &HashMap<String, bool>,
    current: &HashMap<String, bool>,
) -> HashMap<String, bool> {
    crate::config::agents()
        .iter()
        .map(|agent| {
            let visible = requested
                .get(&agent.id)
                .or_else(|| current.get(&agent.id))
                .copied()
                .unwrap_or_else(|| crate::config::default_visibility(&agent.id));
            (agent.id.clone(), visible)
        })
        .collect()
}

#[tauri::command]
pub fn update_agent_preferences(
    state: State<'_, AppState>,
    visible_agents: HashMap<String, bool>,
    agent_order: Vec<String>,
) -> Result<AgentPreferences, String> {
    let _agent_lease = crate::persistence::agent_transaction::AgentLease::acquire(
        &crate::config::get_app_config_dir(),
    )
    .map_err(|e| e.to_string())?;
    let old_visible = {
        let settings = state.settings.lock().map_err(|e| e.to_string())?;
        crate::services::skill::SkillService::get_visible_agents(&settings)
    };
    // A dialog opened before registration may omit the new ID. Preserve its
    // committed preference rather than resetting it to a visible default.
    let visible_agents = merge_registered_visibility(&visible_agents, &old_visible);
    if !has_visible_agent(&visible_agents) {
        return Err("At least one agent must remain visible".to_string());
    }
    let visible_count = visible_agents.values().filter(|v| **v).count();
    if exceeds_visible_agent_cap(old_visible.values().filter(|v| **v).count(), visible_count) {
        return Err(format!(
            "At most {} agents can be visible ({} visible now)",
            MAX_VISIBLE_AGENTS, visible_count,
        ));
    }

    let normalized_order = normalize_agent_order(&visible_agents, &agent_order);

    // The visibility preference is the contract: persist it first and let it
    // be the only hard failure. Link cleanup below is best-effort hygiene.
    {
        let mut settings = state.settings.lock().map_err(|e| e.to_string())?;
        persist_agent_preferences(
            &mut settings,
            &visible_agents,
            &normalized_order,
            |settings| settings.save().map_err(|e| e.to_string()),
        )?;
    }

    let mut hidden_agents = Vec::new();
    for agent in crate::config::agents().iter() {
        let was_visible = old_visible
            .get(&agent.id)
            .copied()
            .unwrap_or(crate::config::default_visibility(&agent.id));
        let now_visible = visible_agents
            .get(&agent.id)
            .copied()
            .unwrap_or(crate::config::default_visibility(&agent.id));
        if was_visible && !now_visible {
            hidden_agents.push(agent.id.clone());
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
        link_cleanup_failed = cleanup_hidden_agent_links(
            &hidden_agents.iter().map(String::as_str).collect::<Vec<_>>(),
            &agent_dirs,
            &known_home_paths,
        );
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
    #[test]
    fn stale_preferences_keep_new_hidden_agents_hidden_and_discard_removed_ids() {
        crate::config::with_test_home(tempfile::tempdir().unwrap().path(), || {
            let id = "custom-00000000-0000-4000-a000-000000000000";
            crate::config::publish_agents(crate::persistence::agents::AgentRegistry {
                version: 1,
                agents: vec![crate::persistence::agents::CustomAgent {
                    id: id.into(),
                    label: "Tool".into(),
                    skills_dir: std::path::PathBuf::from("/custom/skills"),
                }],
            });
            let requested = std::collections::HashMap::from([
                ("codex".into(), true),
                ("removed-id".into(), true),
            ]);
            let current = std::collections::HashMap::from([(id.into(), false)]);
            let merged = super::merge_registered_visibility(&requested, &current);
            assert_eq!(merged.get(id), Some(&false));
            assert!(!merged.contains_key("removed-id"));
        });
    }
    use super::{
        cleanup_hidden_agent_links, exceeds_visible_agent_cap, has_visible_agent,
        normalize_agent_order, persist_agent_preferences, set_agent_preference_values,
        MAX_VISIBLE_AGENTS,
    };
    use crate::services::skill::{symlink_target_matches, SkillService};
    use std::collections::HashMap;
    use std::path::PathBuf;

    #[test]
    fn preference_save_preserves_suppressed_builtin_preferences_without_activating_them() {
        let tmp = tempfile::tempdir().unwrap();
        crate::config::with_test_home(tmp.path(), || {
            crate::config::publish_agents(crate::persistence::agents::AgentRegistry {
                version: 1,
                agents: vec![crate::persistence::agents::CustomAgent {
                    id: "custom-11111111-1111-4111-a111-111111111111".into(),
                    label: "Codex".into(),
                    skills_dir: tmp.path().join(".codex/skills"),
                }],
            });
            let mut settings = crate::persistence::Settings {
                values: HashMap::from([
                    (
                        "visible_agents".into(),
                        r#"{"codex":false,"claude-code":true}"#.into(),
                    ),
                    ("agent_order".into(), r#"["codex","claude-code"]"#.into()),
                ]),
            };
            set_agent_preference_values(
                &mut settings,
                &HashMap::from([("claude-code".into(), true)]),
                &["claude-code".into()],
            )
            .unwrap();
            let saved: HashMap<String, bool> =
                serde_json::from_str(settings.get("visible_agents").unwrap()).unwrap();
            assert_eq!(saved.get("codex"), Some(&false));
            let order: Vec<String> =
                serde_json::from_str(settings.get("agent_order").unwrap()).unwrap();
            assert!(order.contains(&"codex".into()));
            assert!(!SkillService::get_visible_agents(&settings).contains_key("codex"));
        });
    }

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
        assert_eq!(normalized.len(), crate::config::agents().len());
    }

    #[test]
    fn rejects_preferences_without_a_visible_agent() {
        let hidden = crate::config::agents()
            .iter()
            .map(|agent| (agent.id.to_string(), false))
            .collect();

        assert!(!has_visible_agent(&hidden));
    }

    #[test]
    fn visible_agent_cap_only_blocks_growth() {
        let max = MAX_VISIBLE_AGENTS;
        // A pre-cap state toggling one agent off still exceeds the cap but
        // shrinks, so it must be accepted (issue #10 deadlock).
        assert!(!exceeds_visible_agent_cap(max + 2, max + 1));
        // Growing past the cap is rejected.
        assert!(exceeds_visible_agent_cap(max, max + 1));
        // Same-size updates (reorder) and in-cap growth pass.
        assert!(!exceeds_visible_agent_cap(max + 2, max + 2));
        assert!(!exceeds_visible_agent_cap(max - 1, max));
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
    /// Recorded-baseline health: "ok", "conflict" (carriers disagree) or
    /// "missing" (no baseline recorded at check time).
    pub baseline_state: String,
    /// Entry carries an external pin marker and was skipped.
    pub pinned: bool,
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

    let inventory =
        crate::services::skill::SkillService::collect_installations().map_err(|e| e.to_string())?;
    let mut targets: Vec<_> = inventory
        .iter()
        .filter(|i| i.origin == "ssot")
        .map(|i| {
            let resolution = crate::services::lock::resolve_installation_lock(i, &inventory, &lock);
            let guard =
                crate::services::skill_provenance::prepare_update(&i.install_directory).err();
            let diagnostic_entry = match &resolution {
                crate::services::lock::LockResolution::Resolved { entry, .. } => {
                    Some(entry.as_ref().clone())
                }
                crate::services::lock::LockResolution::Ambiguous { candidates, .. }
                    if candidates.len() == 1 =>
                {
                    lock.skills.get(&candidates[0].lock_key).cloned()
                }
                _ => None,
            };
            CheckTarget {
                install_directory: i.install_directory.clone(),
                resolution,
                guard,
                diagnostic_entry,
            }
        })
        .collect();
    let mut checked_skills: HashMap<String, CheckedRemoteSkill> = HashMap::new();

    // Verified conflict resolution (docs/local-protocol.md): conflicted entries
    // whose installed content's tree SHA equals exactly one recorded carrier are
    // aligned before any network work and checked like unconflicted skills;
    // unverifiable conflicts keep the explicit conflict state.
    align_verified_conflicts_in_targets(&mut targets);

    // Group skills by (owner, repo, branch) to minimize API calls
    let mut skills_by_repo: HashMap<UpdateRepoKey, UpdateRepoEntries> = HashMap::new();

    for target in &targets {
        let crate::services::lock::LockResolution::Resolved {
            lock_key: skill_name,
            entry,
        } = &target.resolution
        else {
            continue;
        };
        if let Some(issue) = &target.guard {
            checked_skills.insert(
                skill_name.clone(),
                CheckedRemoteSkill::error(
                    entry.source.clone().unwrap_or_default(),
                    issue.code,
                    issue.message.clone(),
                ),
            );
            continue;
        }
        // Externally pinned and conflicting entries are not fetched: pinned
        // skills are skipped by design and a conflicting baseline must be
        // resolved by the user before any update decision.
        if entry.is_externally_pinned() || entry.baseline_conflict().is_some() {
            continue;
        }
        let (owner, name) = entry.parse_source_owner_name();
        let (Some(owner), Some(name)) = (owner, name) else {
            continue;
        };
        let branch = entry.branch.clone();
        let key = (owner.clone(), name.clone(), branch.clone());
        skills_by_repo
            .entry(key)
            .or_default()
            .push((skill_name.clone(), entry.as_ref().clone()));
    }

    let total_repos = skills_by_repo.len();
    let mut checked_repos: usize = 0;
    let mut rate_limited = false;

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

    // Build per-skill status; the pure decision core lives in
    // `build_check_outcome`. The check's only lock write is the verified
    // conflict alignment above. It never writes a network-time snapshot: that
    // cannot prove the installed content still matches the remote tip, and
    // writing it here would silently rebase an entry another writer changed
    // during the check.
    let skills = build_check_outcome(&targets, &checked_skills, rate_limited);

    Ok(CheckUpdatesResult {
        skills,
        total_repos,
        checked_repos,
        rate_limited,
    })
}

struct CheckTarget {
    install_directory: String,
    resolution: crate::services::lock::LockResolution,
    guard: Option<crate::services::skill_provenance::GuardIssue>,
    // A sole candidate can retain truthful pin/baseline diagnostics even when
    // provenance contradicts it. This never authorizes an update or attribution.
    diagnostic_entry: Option<SkillLockEntry>,
}

/// Verified conflict resolution over check targets (docs/local-protocol.md):
/// aligns conflicted entries whose installed content matches exactly one
/// recorded carrier — in the lock in one write, then in memory for this check.
/// This is the check flow's only lock write and the only permitted baseline
/// write during a check (a value already recorded in the entry, verified
/// against local content). An entry is treated as unconflicted only after the
/// write succeeds; failures leave the conflict state and never fail the check:
/// the next check re-verifies and retries.
fn align_verified_conflicts_in_targets(targets: &mut [CheckTarget]) {
    let mut alignments: Vec<(usize, String, String)> = Vec::new();
    let skills_dir = config::get_agents_skills_dir();
    for (index, target) in targets.iter().enumerate() {
        let crate::services::lock::LockResolution::Resolved { lock_key, entry } =
            &target.resolution
        else {
            continue;
        };
        let dir = skills_dir.join(&target.install_directory);
        if let BaselineConflictResolution::Verified(sha) = entry.baseline_conflict_resolution(&dir)
        {
            alignments.push((index, lock_key.clone(), sha));
        }
    }
    if alignments.is_empty() {
        return;
    }
    let lease =
        crate::persistence::agent_transaction::AgentLease::acquire(&config::get_app_config_dir());
    let Ok(_lease) = lease else {
        eprintln!("Baseline conflict alignment skipped: agent lease unavailable");
        return;
    };
    let writes: Vec<(String, String)> = alignments
        .iter()
        .map(|(_, lock_key, sha)| (lock_key.clone(), sha.clone()))
        .collect();
    if let Err(error) = SkillLock::apply_verified_alignments(&writes) {
        eprintln!("Baseline conflict alignment write failed: {error}");
        return;
    }
    for (index, _, sha) in alignments {
        let crate::services::lock::LockResolution::Resolved { entry, .. } =
            &mut targets[index].resolution
        else {
            continue;
        };
        entry.skill_folder_hash = Some(sha.clone());
        entry.commit_sha = Some(sha);
    }
}

/// Pure physical-target projection: dangling lock entries never become targets.
fn build_check_outcome(
    targets: &[CheckTarget],
    checked: &HashMap<String, CheckedRemoteSkill>,
    rate_limited: bool,
) -> Vec<SkillUpdateStatus> {
    use crate::services::lock::LockResolution;
    targets
        .iter()
        .map(|target| {
            let directory = &target.install_directory;
            let (entry, remote) = if let Some(issue) = &target.guard {
                (
                    target.diagnostic_entry.clone().unwrap_or_default(),
                    Some(CheckedRemoteSkill::error(
                        "unknown".into(),
                        issue.code,
                        issue.message.clone(),
                    )),
                )
            } else {
                match &target.resolution {
                    LockResolution::Resolved { lock_key, entry } => {
                        (entry.as_ref().clone(), checked.get(lock_key).cloned())
                    }
                    LockResolution::Missing { reason } => (
                        SkillLockEntry::default(),
                        Some(CheckedRemoteSkill::error(
                            "unknown".into(),
                            "lockMissing",
                            format!("{directory}: {reason}"),
                        )),
                    ),
                    LockResolution::Ambiguous { reason, candidates } => (
                        SkillLockEntry::default(),
                        Some(CheckedRemoteSkill::error(
                            "unknown".into(),
                            "lockAmbiguous",
                            format!(
                                "{directory}: {reason}: {}",
                                candidates
                                    .iter()
                                    .map(ToString::to_string)
                                    .collect::<Vec<_>>()
                                    .join(", ")
                            ),
                        )),
                    ),
                }
            };
            build_entry_check_outcome(directory, &entry, remote.as_ref(), rate_limited)
        })
        .collect()
}

/// Pure decision core of `check_skill_updates`: builds per-skill status from
/// already-fetched remote results. Never touches the network or the lock file.
fn build_entry_check_outcome(
    skill_name: &str,
    entry: &SkillLockEntry,
    remote: Option<&CheckedRemoteSkill>,
    rate_limited: bool,
) -> SkillUpdateStatus {
    let (owner, name) = entry.parse_source_owner_name();
    let repo_label = match (&owner, &name) {
        (Some(owner), Some(name)) => format!("{owner}/{name}"),
        _ => entry
            .source
            .clone()
            .unwrap_or_else(|| "unknown".to_string()),
    };
    let current_sha = entry.recorded_baseline().map(str::to_string);
    let baseline_state = if entry.baseline_conflict().is_some() {
        "conflict"
    } else if current_sha.is_none() {
        "missing"
    } else {
        "ok"
    };
    let pinned = entry.is_externally_pinned();

    // Entries excluded from the fetch (pinned, conflicting, unparseable
    // source) get an explicit skip state instead of a silent pass.
    let local_issue = remote.filter(|checked| {
        matches!(
            checked.check_error_code.as_deref(),
            Some(
                "ghProvenanceProtected"
                    | "skillProvenanceUnreadable"
                    | "updateStateChanged"
                    | "lockMissing"
                    | "lockAmbiguous"
            )
        )
    });
    let checked = if let Some(issue) = local_issue {
        issue.clone()
    } else if owner.is_none() || name.is_none() {
        CheckedRemoteSkill::error(
            repo_label.clone(),
            "invalidSource",
            "Lock entry source could not be parsed. Reinstall the skill to restore update checks.",
        )
    } else if pinned {
        CheckedRemoteSkill::error(
            repo_label.clone(),
            "externallyPinned",
            "Updates are skipped for externally pinned skills.",
        )
    } else if let Some((carrier, mirror)) = entry.baseline_conflict() {
        CheckedRemoteSkill::error(
                repo_label.clone(),
                "baselineConflict",
                format!(
                    "Baseline records disagree (skillFolderHash {carrier}, commitSha {mirror}). Reinstall the skill to resolve."
                ),
            )
    } else {
        remote.cloned().unwrap_or_else(|| {
            if rate_limited {
                CheckedRemoteSkill::error(
                    repo_label.clone(),
                    "rateLimited",
                    "Skipped because GitHub rate limit stopped update checks.",
                )
            } else {
                CheckedRemoteSkill::ok(None, repo_label.clone())
            }
        })
    };

    // Surface a missing baseline as its own needs-attention state when the
    // remote check itself did not already fail with a more specific error.
    let checked = if baseline_state == "missing" && checked.check_error_code.is_none() {
        CheckedRemoteSkill::error(
                checked.repo,
                "baselineMissing",
                "Installed version could not be verified: no update baseline is recorded. Reinstall the skill, or restore its baseline as described in the release notes, to restore update checks.",
            )
    } else {
        checked
    };

    let has_update = checked.check_error_code.is_none()
        && match (&checked.latest_sha, &current_sha) {
            (Some(latest), Some(current)) => latest != current,
            _ => false,
        };

    SkillUpdateStatus {
        skill_name: skill_name.to_string(),
        has_update,
        current_sha,
        latest_sha: checked.latest_sha,
        repo: checked.repo,
        check_error_code: checked.check_error_code,
        check_error: checked.check_error,
        baseline_state: baseline_state.to_string(),
        pinned,
    }
}

#[cfg(test)]
mod skill_update_check_tests {
    fn check_lock(
        lock: &SkillLock,
        checked: &HashMap<String, CheckedRemoteSkill>,
        rate_limited: bool,
    ) -> Vec<SkillUpdateStatus> {
        let targets: Vec<_> = lock
            .skills
            .iter()
            .map(|(key, entry)| CheckTarget {
                install_directory: key.clone(),
                resolution: crate::services::lock::LockResolution::Resolved {
                    lock_key: key.clone(),
                    entry: Box::new(entry.clone()),
                },
                diagnostic_entry: Some(entry.clone()),
                guard: None,
            })
            .collect();
        build_check_outcome(&targets, checked, rate_limited)
    }

    use super::*;

    fn lock_with(entries: &[(&str, SkillLockEntry)]) -> SkillLock {
        let mut lock = SkillLock::default();
        for (name, entry) in entries {
            lock.skills.insert(name.to_string(), entry.clone());
        }
        lock
    }

    fn entry_json(json: &str) -> SkillLockEntry {
        serde_json::from_str(json).unwrap()
    }

    fn status_for<'a>(result: &'a [SkillUpdateStatus], name: &str) -> &'a SkillUpdateStatus {
        result
            .iter()
            .find(|status| status.skill_name == name)
            .unwrap_or_else(|| panic!("no status for {name}"))
    }

    #[test]
    fn missing_remote_path_error_names_repo_branch_and_path() {
        assert_eq!(
            missing_remote_path_error("owner", "repo", Some("main"), "skills/demo"),
            "Skill path no longer exists in owner/repo@main: skills/demo"
        );
    }

    #[test]
    fn carrier_only_entry_compares_against_remote_without_rebasing() {
        let lock = lock_with(&[(
            "demo",
            entry_json(r#"{"source": "owner/repo", "skillFolderHash": "old-sha"}"#),
        )]);
        let mut checked = HashMap::new();
        checked.insert(
            "demo".to_string(),
            CheckedRemoteSkill::ok(Some("new-sha".to_string()), "owner/repo".to_string()),
        );

        let skills = check_lock(&lock, &checked, false);

        let status = status_for(&skills, "demo");
        assert!(status.has_update);
        assert_eq!(status.current_sha.as_deref(), Some("old-sha"));
        assert_eq!(status.baseline_state, "ok");
    }

    #[test]
    fn missing_baseline_is_surfaced_and_repeated_checks_do_not_rebase() {
        let lock = lock_with(&[("demo", entry_json(r#"{"source": "owner/repo"}"#))]);
        let mut checked = HashMap::new();
        checked.insert(
            "demo".to_string(),
            CheckedRemoteSkill::ok(Some("latest-sha".to_string()), "owner/repo".to_string()),
        );

        // A check never invents a baseline: the entry is surfaced and the lock
        // is untouched no matter how many times it is checked.
        for _ in 0..3 {
            let skills = check_lock(&lock, &checked, false);
            let status = status_for(&skills, "demo");
            assert!(!status.has_update);
            assert_eq!(status.baseline_state, "missing");
            assert_eq!(status.check_error_code.as_deref(), Some("baselineMissing"));
        }

        // A baseline recorded by install/update compares normally.
        let updated_lock = lock_with(&[(
            "demo",
            entry_json(
                r#"{"source": "owner/repo", "skillFolderHash": "latest-sha", "commitSha": "latest-sha"}"#,
            ),
        )]);
        let skills = check_lock(&updated_lock, &checked, false);
        let status = status_for(&skills, "demo");
        assert!(!status.has_update);
        assert_eq!(status.baseline_state, "ok");
        assert_eq!(status.check_error_code, None);
    }

    #[test]
    fn entries_without_baseline_keep_needs_reconfirmation_state() {
        // Historical damage from an external writer, or any entry whose tree
        // query failed at install time: the pending update must stay visible
        // for explicit repair, never silently rebased away by a check.
        let lock = lock_with(&[("demo", entry_json(r#"{"source": "owner/repo"}"#))]);
        let mut checked = HashMap::new();
        checked.insert(
            "demo".to_string(),
            CheckedRemoteSkill::ok(Some("latest-sha".to_string()), "owner/repo".to_string()),
        );

        let skills = check_lock(&lock, &checked, false);

        let status = status_for(&skills, "demo");
        assert_eq!(status.baseline_state, "missing");
        assert_eq!(status.check_error_code.as_deref(), Some("baselineMissing"));
    }

    #[test]
    fn pinned_and_conflicting_entries_are_skipped_without_fetch() {
        let lock = lock_with(&[
            (
                "pinned",
                entry_json(r#"{"source": "owner/repo", "pinnedRef": "v1"}"#),
            ),
            (
                "conflicted",
                entry_json(r#"{"source": "owner/repo", "skillFolderHash": "a", "commitSha": "b"}"#),
            ),
        ]);
        // Even if a stale remote result exists, it must not leak into status.
        let mut checked = HashMap::new();
        checked.insert(
            "pinned".to_string(),
            CheckedRemoteSkill::ok(Some("new-sha".to_string()), "owner/repo".to_string()),
        );

        let skills = check_lock(&lock, &checked, false);

        let pinned = status_for(&skills, "pinned");
        assert!(pinned.pinned);
        assert!(!pinned.has_update);
        assert_eq!(pinned.check_error_code.as_deref(), Some("externallyPinned"));
        assert_eq!(pinned.latest_sha, None);

        let conflicted = status_for(&skills, "conflicted");
        assert_eq!(conflicted.baseline_state, "conflict");
        assert_eq!(
            conflicted.check_error_code.as_deref(),
            Some("baselineConflict")
        );
    }

    #[test]
    fn incomplete_source_stays_visible_with_explicit_state() {
        let lock = lock_with(&[("broken", entry_json(r#"{"source": "owner"}"#))]);

        // The fetch grouping skips unparseable sources, so nothing is checked.
        let skills = check_lock(&lock, &HashMap::new(), false);

        let status = status_for(&skills, "broken");
        assert_eq!(status.check_error_code.as_deref(), Some("invalidSource"));
        assert_eq!(status.repo, "owner");
    }

    #[test]
    fn failed_remote_check_takes_precedence_over_missing_baseline() {
        let lock = lock_with(&[("demo", entry_json(r#"{"source": "owner/repo"}"#))]);
        let mut checked = HashMap::new();
        checked.insert(
            "demo".to_string(),
            CheckedRemoteSkill::error(
                "owner/repo".to_string(),
                "repoUnavailable",
                "Repository could not be found.",
            ),
        );

        let skills = check_lock(&lock, &checked, false);

        let status = status_for(&skills, "demo");
        assert_eq!(status.baseline_state, "missing");
        // The remote failure explains why nothing could be established.
        assert_eq!(status.check_error_code.as_deref(), Some("repoUnavailable"));
    }

    #[test]
    fn rate_limited_unchecked_entries_report_rate_limit() {
        let lock = lock_with(&[("demo", entry_json(r#"{"source": "owner/repo"}"#))]);

        let skills = check_lock(&lock, &HashMap::new(), true);

        let status = status_for(&skills, "demo");
        assert_eq!(status.check_error_code.as_deref(), Some("rateLimited"));
    }
}

use crate::config;
use crate::config::{AgentConfig, AgentPathInfo};
use crate::error::{classify_download_error, AppError, CommandError};
use crate::persistence::archive::SUPPORTED_ARCHIVE_VERSION;
use crate::persistence::{
    atomic_write, ArchiveManifest, ArchivedSkill, SkillCache, SkillCacheEntry, SkillUpdateHistory,
    SkillUpdateHistoryRecord,
};
use crate::services::cli::{CliService, KnownSkillUpdate};
use crate::services::github;
use crate::services::lock::{SkillLock, SUPPORTED_LOCK_VERSION};
use crate::services::skill::{
    is_symlink_or_junction, DiscoverableSkill, InstalledSkill, RepoSkillsResult, SkillFileNode,
    SkillService, SymlinkStatus,
};
use crate::store::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use tauri_plugin_opener::OpenerExt;

use regex::Regex;
use tauri::{Manager, State};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAllResult {
    pub skills: Vec<InstalledSkill>,
    pub success_count: usize,
    pub fail_count: usize,
    pub errors: Vec<String>,
    pub updated: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckedSkillUpdate {
    pub skill_name: String,
    pub current_sha: String,
    pub latest_sha: String,
}

const MAX_IMAGE_PREVIEW_BYTES: u64 = 25 * 1024 * 1024;

/// Validate that a skill directory name does not contain path traversal or
/// other dangerous components.
pub(crate) fn validate_skill_directory(directory: &str) -> Result<(), String> {
    if directory.is_empty() {
        return Err("Skill directory cannot be empty".into());
    }
    if directory.contains('\0') {
        return Err("Invalid characters in directory name".into());
    }
    if std::path::Path::new(directory).is_absolute() {
        return Err("Absolute paths are not allowed".into());
    }
    for component in std::path::Path::new(directory).components() {
        match component {
            std::path::Component::ParentDir => {
                return Err("Path traversal (..) is not allowed".into())
            }
            std::path::Component::RootDir => return Err("Root directory is not allowed".into()),
            _ => {}
        }
    }
    Ok(())
}

static SKILL_NAME_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-zA-Z0-9][a-zA-Z0-9_.-]*$").unwrap());

fn validate_skill_name(name: &str) -> Result<(), String> {
    let re = &SKILL_NAME_RE;
    if !re.is_match(name) {
        return Err(
            "Invalid skill name: must start with a letter or digit and contain only letters, digits, hyphens, underscores, and dots".into()
        );
    }
    Ok(())
}

static ARCHIVE_ID_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-zA-Z0-9][a-zA-Z0-9_.-]*$").unwrap());

fn validate_archive_id(archive_id: &str) -> Result<(), String> {
    if !ARCHIVE_ID_RE.is_match(archive_id) {
        return Err("Invalid archive id".into());
    }
    Ok(())
}

fn format_archive_io_error(action: &str, path: &std::path::Path, error: &std::io::Error) -> String {
    let detail = match error.kind() {
        std::io::ErrorKind::PermissionDenied => {
            "Permission denied. On Windows this often means the skill folder or one of its files is open in another app, terminal, antivirus scan, or file indexer."
        }
        std::io::ErrorKind::AlreadyExists => {
            "The destination already exists. Resolve the conflicting folder before trying again."
        }
        std::io::ErrorKind::NotFound => {
            "The source folder is missing. Refresh the local skills list and try again."
        }
        _ => {
            let msg = error.to_string().to_lowercase();
            if msg.contains("cross-device")
                || msg.contains("different device")
                || msg.contains("not same device")
                || msg.contains("not on the same device")
                || msg.contains("os error 17")
            {
                "The source and destination appear to be on different drives or volumes. Skill Zoo cannot move archived skills across filesystems safely yet."
            } else if msg.contains("access is denied") || msg.contains("being used by another process") {
                "Access was denied. On Windows this often means the skill folder or one of its files is open in another app, terminal, antivirus scan, or file indexer."
            } else {
                "Filesystem operation failed."
            }
        }
    };
    format!("{action} failed for {}: {detail} ({error})", path.display())
}

fn format_archive_app_error(action: &str, error: impl std::fmt::Display) -> String {
    let message = error.to_string();
    let lower = message.to_lowercase();
    let detail = if lower.contains("access is denied")
        || lower.contains("permission denied")
        || lower.contains("being used by another process")
    {
        "Permission denied. On Windows this often means a file or folder is open in another app, terminal, antivirus scan, or file indexer."
    } else if lower.contains("cross-device")
        || lower.contains("different device")
        || lower.contains("not same device")
        || lower.contains("not on the same device")
        || lower.contains("os error 17")
    {
        "The source and destination appear to be on different drives or volumes. Skill Zoo cannot move archived skills across filesystems safely yet."
    } else {
        return format!("{action} failed: {message}");
    };
    format!("{action} failed: {detail} ({message})")
}

fn log_archive_rollback_error(action: &str, error: impl std::fmt::Display) {
    eprintln!("Archive rollback failed during {action}: {error}");
}

fn known_skill_roots() -> Vec<PathBuf> {
    std::iter::once(config::get_agents_skills_dir())
        .chain(
            config::AGENTS
                .iter()
                .filter_map(|agent| config::get_agent_skills_dir(agent.id)),
        )
        .collect()
}

fn canonical_path_for_boundary(path: &Path, must_exist: bool) -> Option<PathBuf> {
    if must_exist || std::fs::symlink_metadata(path).is_ok() {
        return path.canonicalize().ok();
    }

    let parent = path.parent()?;
    let file_name = path.file_name()?;
    Some(parent.canonicalize().ok()?.join(file_name))
}

fn is_path_under_roots(path: &Path, roots: &[PathBuf], must_exist: bool) -> bool {
    if !path.is_absolute() {
        return false;
    }

    let Some(real_path) = canonical_path_for_boundary(path, must_exist) else {
        return false;
    };

    roots
        .iter()
        .filter_map(|root| root.canonicalize().ok())
        .any(|root| real_path == root || real_path.starts_with(root))
}

fn is_existing_path_under_skill_dir(path: &Path) -> bool {
    is_path_under_roots(path, &known_skill_roots(), true)
}

fn is_writable_path_under_skill_dir(path: &Path) -> bool {
    is_path_under_roots(path, &known_skill_roots(), false)
}

#[cfg(feature = "test-helpers")]
pub fn is_path_under_skill_roots_for_test(
    path: &Path,
    roots: &[PathBuf],
    must_exist: bool,
) -> bool {
    is_path_under_roots(path, roots, must_exist)
}

#[tauri::command]
pub fn get_agent_paths() -> Vec<AgentPathInfo> {
    crate::config::get_all_agent_paths()
}

#[tauri::command]
pub fn get_agent_configs() -> Vec<AgentConfig> {
    crate::config::AGENTS.to_vec()
}

#[tauri::command]
pub async fn install_skills(
    state: State<'_, AppState>,
    repo_url: String,
    skill_names: Vec<String>,
    agents: Vec<String>,
) -> Result<Vec<InstalledSkill>, CommandError> {
    let installed_dirs = CliService::add_skills(
        &repo_url,
        &skill_names,
        &agents.first().cloned().unwrap_or_default(),
    )
    .await
    .map_err(CommandError::from)?;

    // Create symlinks first
    for skill_dir in &installed_dirs {
        let home_path = config::get_agents_skills_dir().join(skill_dir);
        for agent in &agents {
            let _ =
                SkillService::toggle_symlink(skill_dir, &home_path.to_string_lossy(), agent, true);
        }
    }

    // Batch-scan and upsert all installed skills
    let (entries, _failed) = SkillService::scan_skills_batch(&installed_dirs);
    for entry in entries {
        let _ = SkillService::upsert_cache_entry(&state.skill_cache, entry);
    }

    SkillService::read_all_skills(&state.skill_cache, &state.metadata).map_err(CommandError::from)
}

#[tauri::command]
pub async fn get_installed_skills(
    state: State<'_, AppState>,
    force: Option<bool>,
) -> Result<Vec<InstalledSkill>, String> {
    if !force.unwrap_or(false) {
        let is_empty = state
            .skill_cache
            .read()
            .map_err(|e| e.to_string())?
            .is_empty();
        if !is_empty {
            return SkillService::read_all_skills(&state.skill_cache, &state.metadata)
                .map_err(|e| e.to_string());
        }
    }
    // Cache is empty (app just started) or force=true: rebuild from filesystem
    SkillService::rebuild_cache(&state.skill_cache, &state.metadata, &state.sync_in_progress)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_skill(
    state: State<'_, AppState>,
    skill_id: String,
) -> Result<InstalledSkill, String> {
    let skill = SkillService::find_in_cache(&state.skill_cache, &skill_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Skill not found: {skill_id}"))?;

    if skill.origin != "ssot" {
        return Err(
            "Only Skill Zoo-managed skills in the SSOT store can be updated from Git.".to_string(),
        );
    }

    let started_at = chrono::Utc::now().to_rfc3339();
    let requested_skills = vec![skill.directory.clone()];
    let result = match CliService::update_skills(Some(&skill.directory)).await {
        Ok(result) => result,
        Err(e) => {
            let message = e.to_string();
            let result = crate::services::cli::UpdateResult {
                success_count: 0,
                fail_count: 1,
                errors: vec![format!("{}: {message}", skill.directory)],
                updated: vec![],
            };
            record_update_history_with_started_at(started_at, "single", requested_skills, &result);
            return Err(message);
        }
    };

    if result.fail_count > 0 {
        record_update_history_with_started_at(started_at, "single", requested_skills, &result);
        return Err(result.errors.join("; "));
    }

    let entry = match SkillService::scan_single_skill(&skill.directory) {
        Ok(entry) => entry,
        Err(e) => {
            let message = e.to_string();
            let result =
                update_result_with_added_error(result, format!("{}: {message}", skill.directory));
            record_update_history_with_started_at(started_at, "single", requested_skills, &result);
            return Err(message);
        }
    };
    if let Err(e) = SkillService::upsert_cache_entry(&state.skill_cache, entry) {
        let message = e.to_string();
        let result =
            update_result_with_added_error(result, format!("{}: {message}", skill.directory));
        record_update_history_with_started_at(started_at, "single", requested_skills, &result);
        return Err(message);
    }

    let skills = match SkillService::read_all_skills(&state.skill_cache, &state.metadata) {
        Ok(skills) => skills,
        Err(e) => {
            let message = e.to_string();
            let result =
                update_result_with_added_error(result, format!("{}: {message}", skill.directory));
            record_update_history_with_started_at(started_at, "single", requested_skills, &result);
            return Err(message);
        }
    };
    match skills.into_iter().find(|s| s.id == skill_id) {
        Some(skill) => {
            record_update_history_with_started_at(started_at, "single", requested_skills, &result);
            Ok(skill)
        }
        None => {
            let message = "Skill disappeared after update".to_string();
            let result =
                update_result_with_added_error(result, format!("{}: {message}", skill.directory));
            record_update_history_with_started_at(started_at, "single", requested_skills, &result);
            Err(message)
        }
    }
}

#[tauri::command]
pub async fn update_all_skills(
    state: State<'_, AppState>,
    checked_updates: Option<Vec<CheckedSkillUpdate>>,
) -> Result<UpdateAllResult, String> {
    let started_at = chrono::Utc::now().to_rfc3339();
    let (mode, requested_skills, update_result) = if let Some(checked_updates) = checked_updates {
        let requested_skills: Vec<String> = checked_updates
            .iter()
            .map(|checked| checked.skill_name.clone())
            .collect();
        let (known_updates, validation_errors) = {
            let cache = state.skill_cache.read().map_err(|e| e.to_string())?;
            let lock = SkillLock::read().map_err(|e| e.to_string())?;
            checked_update_entries_from_lock(&cache, &lock, &checked_updates)
        };
        let mut result = if known_updates.is_empty() {
            crate::services::cli::UpdateResult {
                success_count: 0,
                fail_count: 0,
                errors: vec![],
                updated: vec![],
            }
        } else {
            CliService::update_known_skill_entries(known_updates)
                .await
                .unwrap_or_else(|e| {
                    eprintln!("Update checked skills error: {e}");
                    crate::services::cli::UpdateResult {
                        success_count: 0,
                        fail_count: 0,
                        errors: vec![e.to_string()],
                        updated: vec![],
                    }
                })
        };
        result.errors.extend(validation_errors);
        ("selected", requested_skills, result)
    } else {
        let update_dirs = {
            let cache = state.skill_cache.read().map_err(|e| e.to_string())?;
            update_all_candidate_dirs(&cache)
        };
        let requested_skills = update_dirs.clone();

        let result = CliService::update_skill_names(&update_dirs)
            .await
            .unwrap_or_else(|e| {
                eprintln!("Update all skills error: {e}");
                crate::services::cli::UpdateResult {
                    success_count: 0,
                    fail_count: 0,
                    errors: vec![e.to_string()],
                    updated: vec![],
                }
            });
        ("all", requested_skills, result)
    };
    let update_result = update_result_with_error_count(update_result);

    let dirs: Vec<String> = {
        let cache = state.skill_cache.read().map_err(|e| e.to_string())?;
        cache.iter().map(|s| s.directory.clone()).collect()
    };
    let (entries, _failed) = SkillService::scan_skills_batch(&dirs);
    for entry in entries {
        let _ = SkillService::upsert_cache_entry(&state.skill_cache, entry);
    }

    let skills = match SkillService::read_all_skills(&state.skill_cache, &state.metadata) {
        Ok(skills) => skills,
        Err(e) => {
            let message = e.to_string();
            let update_result = update_result_with_added_error(update_result, message.clone());
            record_update_history_with_started_at(
                started_at,
                mode,
                requested_skills,
                &update_result,
            );
            return Err(message);
        }
    };

    record_update_history_with_started_at(started_at, mode, requested_skills, &update_result);

    Ok(UpdateAllResult {
        skills,
        success_count: update_result.success_count,
        fail_count: update_result.fail_count,
        errors: update_result.errors,
        updated: update_result.updated,
    })
}

#[tauri::command]
pub fn get_skill_update_history() -> Result<Vec<SkillUpdateHistoryRecord>, String> {
    SkillUpdateHistory::load()
        .map(|history| history.sorted_records())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_skill_update_history_record(id: String) -> Result<(), String> {
    let mut history = SkillUpdateHistory::load().map_err(|e| e.to_string())?;
    history.remove(&id);
    history.save().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_skill_update_history() -> Result<(), String> {
    let mut history = SkillUpdateHistory::load().map_err(|e| e.to_string())?;
    history.clear();
    history.save().map_err(|e| e.to_string())
}

fn update_all_candidate_dirs(cache: &crate::persistence::SkillCache) -> Vec<String> {
    cache
        .iter()
        .filter(|skill| skill.origin == "ssot")
        .map(|skill| skill.directory.clone())
        .collect()
}

fn record_update_history_with_started_at(
    started_at: String,
    mode: &str,
    requested_skills: Vec<String>,
    result: &crate::services::cli::UpdateResult,
) {
    if let Err(e) = append_update_history_record(started_at, mode, requested_skills, result) {
        eprintln!("Failed to record skill update history: {e}");
    }
}

fn append_update_history_record(
    started_at: String,
    mode: &str,
    requested_skills: Vec<String>,
    result: &crate::services::cli::UpdateResult,
) -> Result<(), AppError> {
    let finished_at = chrono::Utc::now().to_rfc3339();
    let id = format!(
        "update-{}",
        chrono::Utc::now()
            .timestamp_nanos_opt()
            .unwrap_or_else(|| chrono::Utc::now().timestamp_micros())
    );
    let mut history = SkillUpdateHistory::load()?;
    history.insert(SkillUpdateHistoryRecord {
        id,
        started_at,
        finished_at,
        mode: mode.to_string(),
        requested_skills,
        updated_skills: result.updated.clone(),
        failed_skills: failed_skill_names(&result.errors),
        errors: result.errors.clone(),
        status: update_history_status(result.success_count, result.fail_count),
    });
    history.save()
}

fn update_history_status(success_count: usize, fail_count: usize) -> String {
    match (success_count, fail_count) {
        (0, 0) => "noop",
        (_, 0) => "success",
        (0, _) => "failed",
        _ => "partial",
    }
    .to_string()
}

fn failed_skill_names(errors: &[String]) -> Vec<String> {
    let mut failed = Vec::new();
    for error in errors {
        let Some(name) = error
            .split_once(':')
            .map(|(name, _)| name.trim())
            .filter(|name| !name.is_empty())
        else {
            continue;
        };
        let name = name.to_string();
        if !failed.contains(&name) {
            failed.push(name);
        }
    }
    failed
}

fn checked_update_entries_from_lock(
    cache: &crate::persistence::SkillCache,
    lock: &SkillLock,
    checked_updates: &[CheckedSkillUpdate],
) -> (Vec<KnownSkillUpdate>, Vec<String>) {
    let allowed: HashSet<String> = update_all_candidate_dirs(cache).into_iter().collect();
    let mut updates = Vec::new();
    let mut errors = Vec::new();

    for checked in checked_updates {
        if !allowed.contains(&checked.skill_name) {
            errors.push(format!(
                "{}: Only Skill Zoo-managed skills in the SSOT store can be updated from Git.",
                checked.skill_name
            ));
            continue;
        }
        let Some(entry) = lock.skills.get(&checked.skill_name).cloned() else {
            errors.push(format!(
                "{}: Skill no longer exists in the lock file. Check updates again.",
                checked.skill_name
            ));
            continue;
        };
        if entry.commit_sha.as_deref() != Some(checked.current_sha.as_str()) {
            errors.push(format!(
                "{}: Update state changed. Check updates again.",
                checked.skill_name
            ));
            continue;
        }
        if checked.latest_sha.is_empty() {
            errors.push(format!(
                "{}: Latest update SHA is missing. Check updates again.",
                checked.skill_name
            ));
            continue;
        }
        updates.push(KnownSkillUpdate {
            name: checked.skill_name.clone(),
            entry,
            latest_sha: checked.latest_sha.clone(),
        });
    }

    (updates, errors)
}

fn update_result_with_error_count(
    mut result: crate::services::cli::UpdateResult,
) -> crate::services::cli::UpdateResult {
    result.fail_count = result.errors.len();
    result
}

fn update_result_with_added_error(
    mut result: crate::services::cli::UpdateResult,
    error: String,
) -> crate::services::cli::UpdateResult {
    result.errors.push(error);
    update_result_with_error_count(result)
}

fn resolve_skill_home_dir_from_cache(
    cache: &SkillCache,
    skill_id: Option<&str>,
    directory: &str,
) -> Result<PathBuf, String> {
    validate_skill_directory(directory)?;

    if let Some(skill_id) = skill_id {
        let skill = cache
            .find_by_id(skill_id)
            .ok_or_else(|| format!("Skill not found: {skill_id}"))?;
        if skill.directory != directory {
            return Err(format!(
                "Skill id does not match requested directory: {skill_id}"
            ));
        }
        let home_path = skill
            .home_path
            .as_ref()
            .ok_or_else(|| "Skill has no physical home path".to_string())?;
        let home = PathBuf::from(home_path);
        if !home.is_dir() {
            return Err(format!(
                "Skill home path does not exist: {}",
                home.display()
            ));
        }
        return Ok(home);
    }

    resolve_skill_home_dir_by_directory(directory)
}

fn resolve_skill_home_dir_by_directory(directory: &str) -> Result<PathBuf, String> {
    validate_skill_directory(directory)?;

    known_skill_roots()
        .into_iter()
        .map(|root| root.join(directory))
        .find(|skill_dir| skill_dir.is_dir())
        .ok_or_else(|| format!("Skill directory not found for: {directory}"))
}

fn remove_lock_entry_for_skill(skill: &SkillCacheEntry) {
    if skill.origin != "ssot" {
        return;
    }
    let Ok(mut lock) = SkillLock::read() else {
        return;
    };
    if lock.skills.remove(&skill.directory).is_some() {
        if let Err(e) = lock.write() {
            eprintln!(
                "Failed to write lock after removing {}: {e}",
                skill.directory
            );
        }
    }
}

fn remove_cached_skill_from_disk(skill: &SkillCacheEntry) -> Result<(), String> {
    let home_path = skill
        .home_path
        .as_ref()
        .ok_or_else(|| "Skill has no physical home path, cannot remove".to_string())?;
    SkillService::remove_skill_dir(&skill.directory, home_path).map_err(|e| e.to_string())?;
    remove_lock_entry_for_skill(skill);
    Ok(())
}

fn scan_cached_skill_home(
    skill: &SkillCacheEntry,
    skill_dir: &Path,
) -> Result<SkillCacheEntry, String> {
    let (scan_root, agent_id) = if skill.origin == "ssot" {
        (config::get_agents_skills_dir(), None)
    } else {
        let agent_id = skill
            .home_agent
            .as_deref()
            .ok_or_else(|| "Agent skill has no home agent".to_string())?;
        let scan_root = config::get_agent_skills_dir(agent_id)
            .ok_or_else(|| format!("Unknown agent: {agent_id}"))?;
        (scan_root, Some(agent_id))
    };

    SkillService::scan_skill_root(skill_dir, &scan_root, agent_id).map_err(|e| e.to_string())
}

fn find_cached_skill_for_path(cache: &SkillCache, path: &Path) -> Option<SkillCacheEntry> {
    let real_path = path.canonicalize().ok()?;
    cache
        .iter()
        .filter_map(|skill| {
            let home_path = PathBuf::from(skill.home_path.as_ref()?);
            let real_home = home_path.canonicalize().ok()?;
            if real_path == real_home || real_path.starts_with(&real_home) {
                Some((real_home.components().count(), skill.clone()))
            } else {
                None
            }
        })
        .max_by_key(|(depth, _)| *depth)
        .map(|(_, skill)| skill)
}

fn scan_skill_home_for_cache(
    state: &AppState,
    skill_dir: &Path,
    directory: &str,
) -> Result<SkillCacheEntry, String> {
    let cached = {
        let cache = state.skill_cache.read().map_err(|e| e.to_string())?;
        find_cached_skill_for_path(&cache, skill_dir)
    };
    if let Some(skill) = cached {
        return scan_cached_skill_home(&skill, skill_dir);
    }

    if skill_dir.starts_with(config::get_agents_skills_dir()) {
        return SkillService::scan_skill_root(skill_dir, &config::get_agents_skills_dir(), None)
            .map_err(|e| e.to_string());
    }

    for agent in config::AGENTS {
        if let Some(agent_dir) = config::get_agent_skills_dir(agent.id) {
            if skill_dir.starts_with(&agent_dir) {
                return SkillService::scan_skill_root(skill_dir, &agent_dir, Some(agent.id))
                    .map_err(|e| e.to_string());
            }
        }
    }

    SkillService::scan_single_skill(directory).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_skill(state: State<'_, AppState>, skill_id: String) -> Result<(), String> {
    let skill = SkillService::find_in_cache(&state.skill_cache, &skill_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Skill not found: {skill_id}"))?;

    remove_cached_skill_from_disk(&skill)?;

    SkillService::remove_cache_entry(&state.skill_cache, &skill_id).map_err(|e| e.to_string())?;

    // Clean up metadata for removed skill
    {
        let mut metadata = state.metadata.write().map_err(|e| e.to_string())?;
        metadata.remove(&skill_id);
        metadata.save().map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveSkillsResult {
    pub removed: Vec<String>,
    pub failed: Vec<RemoveSkillFailure>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveSkillFailure {
    pub skill_id: String,
    pub error: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveSkillsResult {
    pub archived: Vec<String>,
    pub failed: Vec<ArchiveSkillFailure>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveSkillFailure {
    pub skill_id: String,
    pub error: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreArchivedSkillsResult {
    pub restored: Vec<String>,
    pub failed: Vec<RestoreArchivedSkillFailure>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreArchivedSkillFailure {
    pub archive_id: String,
    pub error: String,
}

#[tauri::command]
pub async fn remove_skills(
    state: State<'_, AppState>,
    skill_ids: Vec<String>,
) -> Result<RemoveSkillsResult, String> {
    let mut removed: Vec<String> = Vec::new();
    let mut failed: Vec<RemoveSkillFailure> = Vec::new();

    for skill_id in &skill_ids {
        let skill = match SkillService::find_in_cache(&state.skill_cache, skill_id) {
            Ok(Some(s)) => s,
            Ok(None) => {
                failed.push(RemoveSkillFailure {
                    skill_id: skill_id.clone(),
                    error: format!("Skill not found: {skill_id}"),
                });
                continue;
            }
            Err(e) => {
                failed.push(RemoveSkillFailure {
                    skill_id: skill_id.clone(),
                    error: e.to_string(),
                });
                continue;
            }
        };

        if let Err(e) = remove_cached_skill_from_disk(&skill) {
            failed.push(RemoveSkillFailure {
                skill_id: skill_id.clone(),
                error: e,
            });
            continue;
        }

        if let Err(e) = SkillService::remove_cache_entry(&state.skill_cache, skill_id) {
            failed.push(RemoveSkillFailure {
                skill_id: skill_id.clone(),
                error: e.to_string(),
            });
            continue;
        }

        {
            let mut metadata = match state.metadata.write() {
                Ok(m) => m,
                Err(e) => {
                    failed.push(RemoveSkillFailure {
                        skill_id: skill_id.clone(),
                        error: e.to_string(),
                    });
                    continue;
                }
            };
            metadata.remove(skill_id);
        }

        removed.push(skill_id.clone());
    }

    {
        let metadata = state.metadata.write().map_err(|e| e.to_string())?;
        metadata.save().map_err(|e| e.to_string())?;
    }

    Ok(RemoveSkillsResult { removed, failed })
}

#[tauri::command]
pub fn get_archived_skills() -> Result<Vec<ArchivedSkill>, String> {
    let manifest = ArchiveManifest::load().map_err(|e| e.to_string())?;
    let mut skills: Vec<ArchivedSkill> = manifest.skills.values().cloned().collect();
    skills.sort_by(|a, b| {
        b.archived_at
            .cmp(&a.archived_at)
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(skills)
}

#[tauri::command]
pub fn read_archived_skill_md(archive_id: String) -> Result<String, String> {
    validate_archive_id(&archive_id)?;
    let manifest = ArchiveManifest::load().map_err(|e| e.to_string())?;
    if !manifest.skills.contains_key(&archive_id) {
        return Err(format!("Archived skill not found: {archive_id}"));
    }
    let skill_md = ArchiveManifest::archive_skill_dir(&archive_id).join("SKILL.md");
    if !skill_md.exists() {
        return Err(format!(
            "Archived SKILL.md is missing for {archive_id}: {}. The archive entry exists, but its files may have been moved or deleted outside Skill Zoo.",
            skill_md.display()
        ));
    }
    std::fs::read_to_string(&skill_md)
        .map_err(|e| format_archive_io_error("Read archived SKILL.md", &skill_md, &e))
}

fn archive_skill_inner(state: &AppState, skill_id: String) -> Result<(), String> {
    let skills = SkillService::read_all_skills(&state.skill_cache, &state.metadata)
        .map_err(|e| e.to_string())?;
    let skill = skills
        .into_iter()
        .find(|s| s.id == skill_id)
        .ok_or_else(|| format!("Skill not found: {skill_id}"))?;

    let home_path = skill
        .home_path
        .clone()
        .ok_or_else(|| "Skill has no physical home path, cannot archive".to_string())?;
    let home = std::path::PathBuf::from(&home_path);
    if !home.exists() || is_symlink_or_junction(&home) {
        return Err(format!(
            "Skill home path is not an archiveable directory: {home_path}"
        ));
    }

    let archive_id = ArchiveManifest::make_archive_id(&skill.id, &skill.directory);
    validate_archive_id(&archive_id)?;
    let archive_dir = ArchiveManifest::archive_skill_dir(&archive_id);
    if archive_dir.exists() {
        return Err(format!(
            "Cannot archive {}: archive destination already exists at {}. Restore or move that archived copy before trying again.",
            skill.name,
            archive_dir.display()
        ));
    }

    let old_manifest = ArchiveManifest::load().map_err(|e| e.to_string())?;
    if old_manifest.skills.contains_key(&archive_id) {
        return Err(format!("Skill is already archived: {}", skill.name));
    }

    let old_cache = state.skill_cache.read().map_err(|e| e.to_string())?.clone();
    let old_metadata = state.metadata.read().map_err(|e| e.to_string())?.clone();
    let old_lock = SkillLock::read().map_err(|e| e.to_string())?;
    assert_writable_schema(&old_lock, &old_manifest)?;
    let lock_key = if old_lock.skills.contains_key(&skill.directory) {
        Some(skill.directory.clone())
    } else if old_lock.skills.contains_key(&skill.name) {
        Some(skill.name.clone())
    } else {
        None
    };
    let lock_entry = lock_key
        .as_ref()
        .and_then(|key| old_lock.skills.get(key).cloned());
    let archived_skill = ArchivedSkill::from_installed(
        skill.clone(),
        archive_id.clone(),
        lock_key.clone(),
        lock_entry,
    );

    let mut manifest = old_manifest.clone();
    manifest
        .skills
        .insert(archive_id.clone(), archived_skill.clone());
    manifest.save().map_err(|e| e.to_string())?;

    if let Some(parent) = archive_dir.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            if let Err(restore_error) = old_manifest.save() {
                log_archive_rollback_error(
                    "restore manifest after archive dir create failure",
                    restore_error,
                );
            }
            return Err(format_archive_io_error(
                "Create archive directory",
                parent,
                &e,
            ));
        }
    }

    let mut removed_agents: Vec<String> = Vec::new();
    let rollback = |message: String, removed_agents: &[String]| -> String {
        if archive_dir.exists() && !home.exists() {
            if let Some(parent) = home.parent() {
                if let Err(e) = std::fs::create_dir_all(parent) {
                    log_archive_rollback_error("recreate skill parent", e);
                }
            }
            if let Err(e) = std::fs::rename(&archive_dir, &home) {
                log_archive_rollback_error("move archived skill back home", e);
            }
        }
        for agent in removed_agents {
            if let Err(e) = SkillService::toggle_symlink(&skill.directory, &home_path, agent, true)
            {
                log_archive_rollback_error("restore agent symlink after archive failure", e);
            }
        }
        if let Ok(mut cache) = state.skill_cache.write() {
            *cache = old_cache.clone();
            if let Err(e) = cache.save() {
                log_archive_rollback_error("restore cache after archive failure", e);
            }
        }
        if let Ok(mut metadata) = state.metadata.write() {
            *metadata = old_metadata.clone();
            if let Err(e) = metadata.save() {
                log_archive_rollback_error("restore metadata after archive failure", e);
            }
        }
        if let Err(e) = old_lock.write() {
            log_archive_rollback_error("restore lock after archive failure", e);
        }
        if let Err(e) = old_manifest.save() {
            log_archive_rollback_error("restore manifest after archive failure", e);
        }
        message
    };

    for (agent, enabled) in &archived_skill.apps {
        if !enabled {
            continue;
        }
        match SkillService::toggle_symlink(&skill.directory, &home_path, agent, false) {
            Ok(()) => removed_agents.push(agent.clone()),
            Err(e) => {
                return Err(rollback(
                    format_archive_app_error("Remove agent link while archiving", e),
                    &removed_agents,
                ))
            }
        }
    }

    if let Err(e) = std::fs::rename(&home, &archive_dir) {
        return Err(rollback(
            format_archive_io_error("Move skill into archive", &archive_dir, &e),
            &removed_agents,
        ));
    }

    {
        let mut cache = state
            .skill_cache
            .write()
            .map_err(|e| rollback(format!("Cache lock: {e}"), &removed_agents))?;
        cache.remove(&skill.id);
        if let Err(e) = cache.save() {
            return Err(rollback(e.to_string(), &removed_agents));
        }
    }

    {
        let mut metadata = state
            .metadata
            .write()
            .map_err(|e| rollback(format!("Metadata lock: {e}"), &removed_agents))?;
        metadata.remove(&skill.id);
        if let Err(e) = metadata.save() {
            return Err(rollback(e.to_string(), &removed_agents));
        }
    }

    if let Some(key) = lock_key {
        let mut lock = old_lock.clone();
        lock.skills.remove(&key);
        if let Err(e) = lock.write() {
            return Err(rollback(e.to_string(), &removed_agents));
        }
    }

    Ok(())
}

#[tauri::command]
pub fn archive_skill(state: State<'_, AppState>, skill_id: String) -> Result<(), String> {
    archive_skill_inner(&state, skill_id)
}

#[tauri::command]
pub fn archive_skills(
    state: State<'_, AppState>,
    skill_ids: Vec<String>,
) -> Result<ArchiveSkillsResult, String> {
    let mut archived: Vec<String> = Vec::new();
    let mut failed: Vec<ArchiveSkillFailure> = Vec::new();

    for skill_id in skill_ids {
        match archive_skill_inner(&state, skill_id.clone()) {
            Ok(()) => archived.push(skill_id),
            Err(e) => failed.push(ArchiveSkillFailure { skill_id, error: e }),
        }
    }

    Ok(ArchiveSkillsResult { archived, failed })
}

#[tauri::command]
pub fn restore_archived_skill(
    state: State<'_, AppState>,
    archive_id: String,
) -> Result<InstalledSkill, String> {
    let restored_id = restore_archived_skill_inner(&state, archive_id)?;
    let skills = SkillService::read_all_skills(&state.skill_cache, &state.metadata)
        .map_err(|e| e.to_string())?;
    skills
        .into_iter()
        .find(|s| s.id == restored_id)
        .ok_or_else(|| "Skill restored but not found in cache".to_string())
}

#[tauri::command]
pub fn restore_archived_skills(
    state: State<'_, AppState>,
    archive_ids: Vec<String>,
) -> Result<RestoreArchivedSkillsResult, String> {
    let mut restored: Vec<String> = Vec::new();
    let mut failed: Vec<RestoreArchivedSkillFailure> = Vec::new();

    for archive_id in archive_ids {
        match restore_archived_skill_inner(&state, archive_id.clone()) {
            Ok(_) => restored.push(archive_id),
            Err(e) => failed.push(RestoreArchivedSkillFailure {
                archive_id,
                error: e,
            }),
        }
    }

    Ok(RestoreArchivedSkillsResult { restored, failed })
}

fn restore_archived_skill_inner(state: &AppState, archive_id: String) -> Result<String, String> {
    validate_archive_id(&archive_id)?;
    let old_manifest = ArchiveManifest::load().map_err(|e| e.to_string())?;
    let archived_skill = old_manifest
        .skills
        .get(&archive_id)
        .cloned()
        .ok_or_else(|| format!("Archived skill not found: {archive_id}"))?;

    let archive_dir = ArchiveManifest::archive_skill_dir(&archive_id);
    if !archive_dir.exists() {
        return Err(format!(
            "Archived directory is missing: {}. The archive entry exists, but its files may have been moved or deleted outside Skill Zoo.",
            archive_dir.display()
        ));
    }

    let restore_path = archived_skill
        .home_path
        .as_ref()
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            if archived_skill.origin == "ssot" {
                config::get_agents_skills_dir().join(&archived_skill.directory)
            } else {
                archived_skill
                    .home_agent
                    .as_deref()
                    .and_then(config::get_agent_skills_dir)
                    .unwrap_or_else(config::get_agents_skills_dir)
                    .join(&archived_skill.directory)
            }
        });
    if restore_path.exists() {
        return Err(format!(
            "Cannot restore: destination already exists at {}. Move, rename, archive, or remove the existing skill folder before restoring this archived skill.",
            restore_path.display()
        ));
    }

    let old_cache = state.skill_cache.read().map_err(|e| e.to_string())?.clone();
    let old_metadata = state.metadata.read().map_err(|e| e.to_string())?.clone();
    let old_lock = SkillLock::read().map_err(|e| e.to_string())?;
    assert_writable_schema(&old_lock, &old_manifest)?;

    if let Some(parent) = restore_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format_archive_io_error("Create restore directory", parent, &e))?;
    }
    std::fs::rename(&archive_dir, &restore_path)
        .map_err(|e| format_archive_io_error("Move archived skill back", &restore_path, &e))?;

    let mut restored_agents: Vec<String> = Vec::new();
    let rollback = |message: String, restored_agents: &[String]| -> String {
        for agent in restored_agents {
            if let Err(e) = SkillService::toggle_symlink(
                &archived_skill.directory,
                &restore_path.to_string_lossy(),
                agent,
                false,
            ) {
                log_archive_rollback_error(
                    "remove restored agent symlink after restore failure",
                    e,
                );
            }
        }
        if restore_path.exists() && !archive_dir.exists() {
            if let Some(parent) = archive_dir.parent() {
                if let Err(e) = std::fs::create_dir_all(parent) {
                    log_archive_rollback_error("recreate archive parent", e);
                }
            }
            if let Err(e) = std::fs::rename(&restore_path, &archive_dir) {
                log_archive_rollback_error("move restored skill back to archive", e);
            }
        }
        if let Ok(mut cache) = state.skill_cache.write() {
            *cache = old_cache.clone();
            if let Err(e) = cache.save() {
                log_archive_rollback_error("restore cache after restore failure", e);
            }
        }
        if let Ok(mut metadata) = state.metadata.write() {
            *metadata = old_metadata.clone();
            if let Err(e) = metadata.save() {
                log_archive_rollback_error("restore metadata after restore failure", e);
            }
        }
        if let Err(e) = old_lock.write() {
            log_archive_rollback_error("restore lock after restore failure", e);
        }
        if let Err(e) = old_manifest.save() {
            log_archive_rollback_error("restore manifest after restore failure", e);
        }
        message
    };

    if let Some(lock_entry) = archived_skill.lock_entry.clone() {
        let mut lock = old_lock.clone();
        let key = archived_skill
            .lock_key
            .clone()
            .unwrap_or_else(|| archived_skill.directory.clone());
        lock.skills.insert(key, lock_entry);
        if let Err(e) = lock.write() {
            return Err(rollback(e.to_string(), &restored_agents));
        }
    }

    {
        let mut metadata = state
            .metadata
            .write()
            .map_err(|e| rollback(format!("Metadata lock: {e}"), &restored_agents))?;
        if archived_skill.starred || archived_skill.is_mine {
            metadata.entries.insert(
                archived_skill.original_skill_id.clone(),
                crate::persistence::metadata::SkillMetadata {
                    starred: archived_skill.starred,
                    is_mine: archived_skill.is_mine,
                },
            );
        } else {
            metadata.remove(&archived_skill.original_skill_id);
        }
        if let Err(e) = metadata.save() {
            return Err(rollback(e.to_string(), &restored_agents));
        }
    }

    for (agent, enabled) in &archived_skill.apps {
        if !enabled {
            continue;
        }
        let Some(agent_dir) = config::get_agent_skills_dir(agent) else {
            continue;
        };
        if !agent_dir.exists() {
            continue;
        }
        let agent_skill_path =
            agent_dir.join(SkillService::agent_link_name(&archived_skill.directory));
        if agent_skill_path.exists() && !is_symlink_or_junction(&agent_skill_path) {
            let is_native_home = agent_skill_path == restore_path
                || agent_skill_path
                    .canonicalize()
                    .ok()
                    .zip(restore_path.canonicalize().ok())
                    .is_some_and(|(agent_path, restore_path)| agent_path == restore_path);
            if is_native_home {
                continue;
            }
            return Err(rollback(
                format!(
                    "Restore agent link failed: destination already exists at {} and is a real directory, not a symlink.",
                    agent_skill_path.display()
                ),
                &restored_agents,
            ));
        }
        match SkillService::toggle_symlink(
            &archived_skill.directory,
            &restore_path.to_string_lossy(),
            agent,
            true,
        ) {
            Ok(()) => restored_agents.push(agent.clone()),
            Err(e) => {
                return Err(rollback(
                    format_archive_app_error("Restore agent link", e),
                    &restored_agents,
                ))
            }
        }
    }

    // Scan after symlinks are created so detect_agents finds the restored links.
    let entry = SkillService::scan_single_skill(&archived_skill.directory)
        .map_err(|e| rollback(e.to_string(), &restored_agents))?;
    let restored_id = entry.id.clone();
    if let Err(e) = SkillService::upsert_cache_entry(&state.skill_cache, entry) {
        return Err(rollback(e.to_string(), &restored_agents));
    }

    let mut manifest = old_manifest.clone();
    manifest.skills.remove(&archive_id);
    if let Err(e) = manifest.save() {
        return Err(rollback(e.to_string(), &restored_agents));
    }

    Ok(restored_id)
}

#[tauri::command]
pub fn read_skill_md(
    state: State<'_, AppState>,
    directory: String,
    skill_id: Option<String>,
) -> Result<String, String> {
    let skill_dir = {
        let cache = state.skill_cache.read().map_err(|e| e.to_string())?;
        resolve_skill_home_dir_from_cache(&cache, skill_id.as_deref(), &directory)?
    };
    let skill_md = skill_dir.join("SKILL.md");
    if !skill_md.exists() {
        return Err(format!("SKILL.md not found for: {directory}"));
    }
    std::fs::read_to_string(&skill_md).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_skill_md(
    state: State<'_, AppState>,
    directory: String,
    skill_id: Option<String>,
    content: String,
) -> Result<(), String> {
    let skill_dir = {
        let cache = state.skill_cache.read().map_err(|e| e.to_string())?;
        resolve_skill_home_dir_from_cache(&cache, skill_id.as_deref(), &directory)?
    };
    let skill_md = skill_dir.join("SKILL.md");

    let parent = skill_md
        .parent()
        .ok_or_else(|| "Invalid skill path".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;

    atomic_write(&skill_md, &content).map_err(|e| e.to_string())?;

    // Update lock file timestamp so resolve_timestamps reflects the edit.
    if let Ok(mut lock) = crate::services::lock::SkillLock::read() {
        if let Some(entry) = lock.skills.get_mut(&directory) {
            entry.updated_at = Some(chrono::Utc::now().to_rfc3339());
            let _ = lock.write();
        }
    }

    // Refresh cache to pick up changed name/description/contentHash/updatedAt
    let entry = scan_skill_home_for_cache(&state, &skill_dir, &directory)?;
    SkillService::upsert_cache_entry(&state.skill_cache, entry).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn list_skill_files(
    state: State<'_, AppState>,
    directory: String,
    skill_id: Option<String>,
) -> Result<Vec<SkillFileNode>, String> {
    let skill_dir = {
        let cache = state.skill_cache.read().map_err(|e| e.to_string())?;
        resolve_skill_home_dir_from_cache(&cache, skill_id.as_deref(), &directory)?
    };
    SkillService::list_skill_files_at(&skill_dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_skill_file_children(
    state: State<'_, AppState>,
    directory: String,
    skill_id: Option<String>,
    parent_path: Option<String>,
) -> Result<Vec<SkillFileNode>, String> {
    let skill_dir = {
        let cache = state.skill_cache.read().map_err(|e| e.to_string())?;
        resolve_skill_home_dir_from_cache(&cache, skill_id.as_deref(), &directory)?
    };
    SkillService::list_skill_file_children_at(&skill_dir, parent_path.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_symlink_status(state: State<'_, AppState>) -> Result<Vec<SymlinkStatus>, String> {
    let cache = state.skill_cache.read().map_err(|e| e.to_string())?;
    let settings = state.settings.lock().map_err(|e| e.to_string())?;
    Ok(SkillService::get_symlink_status(&cache, &settings))
}

#[tauri::command]
pub fn toggle_symlink(
    state: State<'_, AppState>,
    skill_id: String,
    agent: String,
    enabled: bool,
) -> Result<(), String> {
    let skill = SkillService::find_in_cache(&state.skill_cache, &skill_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Skill not found: {skill_id}"))?;

    let home_path = skill
        .home_path
        .as_ref()
        .ok_or_else(|| "Skill has no physical home path, cannot toggle symlink".to_string())?;

    validate_skill_directory(&skill.directory)?;

    SkillService::toggle_symlink(&skill.directory, home_path, &agent, enabled)
        .map_err(|e| e.to_string())?;

    // Update the in-memory cache so the frontend sees the new agent status
    // immediately without a full cache rebuild.
    let new_apps = SkillService::detect_agents(&skill.directory, &skill.home_path);
    if let Ok(mut cache) = state.skill_cache.write() {
        if let Some(mut entry) = cache.find_by_id(&skill_id).cloned() {
            entry.apps = new_apps;
            cache.upsert(entry);
            let _ = cache.save();
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn merge_duplicates_to_ssot(
    state: State<'_, AppState>,
    skill_name: String,
) -> Result<(), String> {
    SkillService::merge_duplicates_to_ssot(&skill_name, &state.skill_cache, &state.metadata)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_skill_dir(app_handle: tauri::AppHandle, directory: String) -> Result<(), String> {
    validate_skill_directory(&directory)?;
    let dir = config::get_agents_skills_dir().join(&directory);
    if !dir.exists() {
        return Err(format!("Directory does not exist: {}", dir.display()));
    }
    app_handle
        .opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

fn skill_file_error(code: &'static str, message: impl Into<String>) -> CommandError {
    CommandError {
        code,
        message: message.into(),
        repo: None,
    }
}

/// Read a text file at an absolute skill path (UTF-8 only).
#[tauri::command]
pub fn read_skill_file_path(path: String) -> Result<String, CommandError> {
    if path.is_empty() || path.contains('\0') {
        return Err(CommandError::bad_request("Invalid path"));
    }
    let p = std::path::Path::new(&path);
    if !p.is_absolute() {
        return Err(CommandError::bad_request("Path must be absolute"));
    }
    if !is_existing_path_under_skill_dir(p) {
        return Err(CommandError::bad_request(
            "Path is not under a known skill directory",
        ));
    }
    if !p.is_file() {
        return Err(CommandError::bad_request(format!(
            "Not a file: {}",
            p.display()
        )));
    }
    let bytes = std::fs::read(p).map_err(|e| CommandError::generic(e.to_string()))?;
    String::from_utf8(bytes).map_err(|_| skill_file_error("binaryFile", "File is not UTF-8 text"))
}

fn image_mime_from_path(path: &Path) -> Option<&'static str> {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => Some("image/png"),
        Some("jpg") | Some("jpeg") => Some("image/jpeg"),
        Some("gif") => Some("image/gif"),
        Some("webp") => Some("image/webp"),
        Some("bmp") => Some("image/bmp"),
        Some("svg") => Some("image/svg+xml"),
        Some("avif") => Some("image/avif"),
        Some("ico") => Some("image/x-icon"),
        _ => None,
    }
}

/// Read an image at an absolute skill path and return a browser-displayable data URL.
#[tauri::command]
pub fn read_skill_image_path(path: String) -> Result<String, CommandError> {
    if path.is_empty() || path.contains('\0') {
        return Err(CommandError::bad_request("Invalid path"));
    }
    let p = std::path::Path::new(&path);
    if !p.is_absolute() {
        return Err(CommandError::bad_request("Path must be absolute"));
    }
    if !is_existing_path_under_skill_dir(p) {
        return Err(CommandError::bad_request(
            "Path is not under a known skill directory",
        ));
    }
    if !p.is_file() {
        return Err(CommandError::bad_request(format!(
            "Not a file: {}",
            p.display()
        )));
    }
    let mime = image_mime_from_path(p)
        .ok_or_else(|| skill_file_error("unsupportedImageFile", "Unsupported image file"))?;
    let metadata = std::fs::metadata(p).map_err(|e| CommandError::generic(e.to_string()))?;
    if metadata.len() > MAX_IMAGE_PREVIEW_BYTES {
        return Err(skill_file_error("imageTooLarge", "Image file is too large"));
    }
    let bytes = std::fs::read(p).map_err(|e| CommandError::generic(e.to_string()))?;
    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}

/// Write content to a text file at an absolute skill path.
/// Also updates the skill's lock timestamp and cache so updatedAt reflects the change.
#[tauri::command]
pub fn write_skill_file_path(
    state: State<'_, AppState>,
    path: String,
    content: String,
) -> Result<(), String> {
    if path.is_empty() || path.contains('\0') {
        return Err("Invalid path".into());
    }
    let p = std::path::Path::new(&path);
    if !p.is_absolute() {
        return Err("Path must be absolute".into());
    }
    if !is_writable_path_under_skill_dir(p) {
        return Err("Path is not under a known skill directory".into());
    }
    atomic_write(p, content).map_err(|e| e.to_string())?;

    let cached_skill = {
        let cache = state.skill_cache.read().map_err(|e| e.to_string())?;
        find_cached_skill_for_path(&cache, p)
    };

    if let Some(skill) = cached_skill {
        // Update lock file timestamp
        if let Ok(mut lock) = crate::services::lock::SkillLock::read() {
            if let Some(entry) = lock.skills.get_mut(&skill.directory) {
                entry.updated_at = Some(chrono::Utc::now().to_rfc3339());
                let _ = lock.write();
            }
        }
        // Refresh cache so updatedAt is reflected in the frontend
        let home = PathBuf::from(
            skill
                .home_path
                .as_ref()
                .ok_or_else(|| "Skill has no physical home path".to_string())?,
        );
        if let Ok(entry) = scan_cached_skill_home(&skill, &home) {
            let _ = SkillService::upsert_cache_entry(&state.skill_cache, entry);
        }
    }

    Ok(())
}

/// Open an absolute skill path in the file manager.
/// Validates that the path is under a known skill directory (SSOT or agent).
#[tauri::command]
pub fn open_skill_path(app_handle: tauri::AppHandle, path: String) -> Result<(), String> {
    if path.is_empty() || path.contains('\0') {
        return Err("Invalid path".into());
    }
    let p = std::path::Path::new(&path);
    if !p.is_absolute() {
        return Err("Path must be absolute".into());
    }
    // Verify the path is under a known skill directory
    if !is_existing_path_under_skill_dir(p) {
        return Err("Path is not under a known skill directory".into());
    }
    if !p.exists() {
        return Err(format!("Path does not exist: {}", p.display()));
    }
    app_handle
        .opener()
        .open_path(path, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_skills_dir(app_handle: tauri::AppHandle, agent: String) -> Result<(), String> {
    let dir = if agent == "ssot" {
        config::get_agents_skills_dir()
    } else if let Some(d) = config::get_agent_skills_dir(&agent) {
        d
    } else {
        return Err(format!("Unknown agent: {agent}"));
    };
    if !dir.exists() {
        return Err(format!("Directory does not exist: {}", dir.display()));
    }
    app_handle
        .opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

// ────────────── Banners ──────────────

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct BannerEntry {
    pub image: String,
    pub title: String,
    pub subtitle: String,
    pub owner: Option<String>,
    pub name: Option<String>,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default, rename = "hideText")]
    pub hide_text: Option<bool>,
}

#[tauri::command]
pub fn get_banners(app: tauri::AppHandle) -> Result<Vec<BannerEntry>, String> {
    let json_str = app
        .path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join("banners.json"))
        .and_then(|path| std::fs::read_to_string(&path).ok())
        .unwrap_or_else(|| include_str!("../../resources/banners.json").to_string());

    let entries: Vec<BannerEntry> =
        serde_json::from_str(&json_str).map_err(|e| format!("Invalid banners JSON: {e}"))?;
    Ok(entries)
}

// ────────────── Discover (repo-driven) ──────────────

#[derive(Debug, Clone, serde::Deserialize)]
struct RecommendedRepoEntry {
    pub owner: String,
    pub name: String,
    pub branch: String,
    pub description: String,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverRepo {
    pub owner: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_branch: Option<String>,
    pub description: Option<String>,
    pub stars: Option<i32>,
    pub forks: Option<i32>,
    pub language: Option<String>,
    pub license: Option<String>,
    pub open_issues: Option<i32>,
    pub pushed_at: Option<String>,
    #[serde(default)]
    pub topics: Vec<String>,
    pub html_url: Option<String>,
}

fn minimal_discover_repo(owner: String, name: String, branch: Option<String>) -> DiscoverRepo {
    DiscoverRepo {
        owner,
        name,
        branch,
        default_branch: None,
        description: None,
        stars: None,
        forks: None,
        language: None,
        license: None,
        open_issues: None,
        pushed_at: None,
        topics: vec![],
        html_url: None,
    }
}

#[tauri::command]
pub fn get_recommended_repos(app: tauri::AppHandle) -> Result<Vec<DiscoverRepo>, String> {
    let json_str = app
        .path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join("recommended-repos.json"))
        .and_then(|path| std::fs::read_to_string(&path).ok())
        .unwrap_or_else(|| include_str!("../../resources/recommended-repos.json").to_string());

    let entries: Vec<RecommendedRepoEntry> = serde_json::from_str(&json_str)
        .map_err(|e| format!("Invalid recommended repos JSON: {e}"))?;

    Ok(entries
        .into_iter()
        .map(|e| DiscoverRepo {
            owner: e.owner,
            name: e.name,
            branch: Some(e.branch),
            default_branch: None,
            description: Some(e.description),
            stars: None,
            forks: None,
            language: None,
            license: None,
            open_issues: None,
            pushed_at: None,
            topics: vec![],
            html_url: None,
        })
        .collect())
}

async fn fetch_github_repo_metadata(
    owner: &str,
    name: &str,
) -> Result<DiscoverRepo, AppError> {
    let url = format!("https://api.github.com/repos/{owner}/{name}");
    let client = config::http_client();

    match client
        .get(&url)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => match resp.json::<serde_json::Value>().await {
            Ok(json) => Ok(DiscoverRepo {
                owner: owner.to_string(),
                name: name.to_string(),
                branch: None,
                default_branch: json
                    .get("default_branch")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                description: json
                    .get("description")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                stars: json
                    .get("stargazers_count")
                    .and_then(|v| v.as_i64())
                    .map(|n| n as i32),
                forks: json
                    .get("forks_count")
                    .and_then(|v| v.as_i64())
                    .map(|n| n as i32),
                language: json
                    .get("language")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                license: json
                    .get("license")
                    .and_then(|v| v.get("spdx_id"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                open_issues: json
                    .get("open_issues_count")
                    .and_then(|v| v.as_i64())
                    .map(|n| n as i32),
                pushed_at: json
                    .get("pushed_at")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                topics: json
                    .get("topics")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|t| t.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default(),
                html_url: json
                    .get("html_url")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
            }),
            Err(e) => Err(AppError::Parse(format!(
                "Invalid repo metadata JSON for {owner}/{name}: {e}"
            ))),
        },
        Ok(resp) => {
            eprintln!(
                "metadata fetch HTTP {} for {owner}/{name}",
                resp.status().as_u16()
            );
            let status = resp.status().as_u16();
            if status == 404 {
                Err(AppError::RepoNotFound(format!("{owner}/{name}")))
            } else {
                Err(AppError::DownloadUnavailable(format!("{owner}/{name}")))
            }
        }
        Err(e) => Err(classify_download_error(format!("{owner}/{name}"), e)),
    }
}

#[tauri::command]
pub async fn search_repo(query: String) -> Result<DiscoverRepo, String> {
    let repo_query = github::parse_repo_query(&query)?;
    if let Some(branch) = repo_query.branch {
        return Ok(minimal_discover_repo(
            repo_query.owner,
            repo_query.name,
            Some(branch),
        ));
    }
    let owner = repo_query.owner;
    let name = repo_query.name;
    match get_repo_metadata(owner.clone(), name.clone(), None).await {
        Ok(repo) => Ok(repo),
        Err(e) => {
            eprintln!(
                "search_repo: metadata degraded for {owner}/{name}: code={} message={}",
                e.code, e.message
            );
            Ok(minimal_discover_repo(owner, name, None))
        }
    }
}

/// Cache entry keyed by "owner/name", stored in ~/.skill-zoo/repo-metadata-cache.json
const REPO_METADATA_CACHE_TTL: u64 = 7 * 86400; // 7 days in seconds

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct RepoMetadataCacheEntry {
    data: DiscoverRepo,
    fetched_at: u64,
}

fn normalize_repo_metadata_cache_entry(
    mut entry: RepoMetadataCacheEntry,
) -> RepoMetadataCacheEntry {
    let legacy_default_branch = entry.data.branch.take();
    if entry.data.default_branch.is_none() {
        entry.data.default_branch = legacy_default_branch;
    }
    entry
}

fn load_repo_metadata_cache() -> std::collections::HashMap<String, RepoMetadataCacheEntry> {
    let path = config::get_app_config_dir().join("repo-metadata-cache.json");
    let content = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return std::collections::HashMap::new(),
    };
    serde_json::from_str::<std::collections::HashMap<String, RepoMetadataCacheEntry>>(&content)
        .map(|cache| {
            cache
                .into_iter()
                .map(|(key, entry)| (key, normalize_repo_metadata_cache_entry(entry)))
                .collect()
        })
        .unwrap_or_default()
}

fn save_repo_metadata_cache(cache: &std::collections::HashMap<String, RepoMetadataCacheEntry>) {
    let path = config::get_app_config_dir().join("repo-metadata-cache.json");
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(cache) {
        let _ = atomic_write(&path, json);
    }
}

#[tauri::command]
pub async fn get_repo_metadata(
    owner: String,
    name: String,
    force: Option<bool>,
) -> Result<DiscoverRepo, CommandError> {
    github::validate_repo_segments(&owner, &name, "HEAD").map_err(CommandError::bad_request)?;
    let force = force.unwrap_or(false);
    let key = format!("{owner}/{name}");
    let mut cache = load_repo_metadata_cache();
    let stale_cache = cache.get(&key).map(|entry| entry.data.clone());

    // Check disk cache
    if !force {
        if let Some(entry) = cache.get(&key) {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            if now.saturating_sub(entry.fetched_at) < REPO_METADATA_CACHE_TTL {
                return Ok(entry.data.clone());
            }
        }
    }

    // Fetch from GitHub
    match fetch_github_repo_metadata(&owner, &name).await {
        Ok(data) => {
            // Persist on success
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            cache.insert(
                key,
                RepoMetadataCacheEntry {
                    data: data.clone(),
                    fetched_at: now,
                },
            );
            save_repo_metadata_cache(&cache);
            Ok(data)
        }
        Err(e) => {
            if let Some(data) = stale_cache {
                eprintln!(
                    "metadata fetch failed for {owner}/{name}, using stale cache: {e}"
                );
                return Ok(data);
            }
            Err(CommandError::from(e))
        }
    }
}

// ── README cache ──

const REPO_README_CACHE_TTL: u64 = 7 * 86400; // 7 days

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct RepoReadmeCacheEntry {
    content: String,
    fetched_at: u64,
}

fn load_readme_cache() -> std::collections::HashMap<String, RepoReadmeCacheEntry> {
    let path = config::get_app_config_dir().join("repo-readme-cache.json");
    let content = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return std::collections::HashMap::new(),
    };
    serde_json::from_str(&content).unwrap_or_default()
}

fn save_readme_cache(cache: &std::collections::HashMap<String, RepoReadmeCacheEntry>) {
    let path = config::get_app_config_dir().join("repo-readme-cache.json");
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(cache) {
        let _ = atomic_write(&path, json);
    }
}

// Returns Ok(content) on success, Err(()) on 404 or network/timeout errors.
// Neither is cached, since repos may add a README later.
fn repo_ref_cache_key(branch: Option<&str>) -> &str {
    branch.unwrap_or("default")
}

async fn fetch_repo_readme(
    owner: &str,
    name: &str,
    branch: Option<&str>,
) -> Result<String, AppError> {
    let url = match branch {
        Some(branch) => format!("https://api.github.com/repos/{owner}/{name}/readme?ref={branch}"),
        None => format!("https://api.github.com/repos/{owner}/{name}/readme"),
    };
    let client = config::http_client();

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| classify_download_error(format!("{owner}/{name}"), e))?;
    if resp.status().as_u16() == 404 {
        return Err(AppError::RepoNotFound(format!("{owner}/{name}")));
    }
    if !resp.status().is_success() {
        return Err(AppError::DownloadUnavailable(format!("{owner}/{name}")));
    }
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Parse(format!("Invalid README response for {owner}/{name}: {e}")))?;
    let content = json
        .get("content")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Parse("README response missing content".into()))?;
    let encoding = json.get("encoding").and_then(|v| v.as_str());

    let decoded = if encoding == Some("base64") {
        let cleaned: String = content.chars().filter(|c| !c.is_whitespace()).collect();
        use base64::Engine;
        base64::engine::general_purpose::STANDARD
            .decode(&cleaned)
            .map_err(|e| AppError::Parse(format!("README base64 decode: {e}")))?
    } else {
        content.as_bytes().to_vec()
    };

    String::from_utf8(decoded)
        .map_err(|e| AppError::Parse(format!("README not valid UTF-8: {e}")))
}

fn read_repo_readme_from_zip_path(zip_path: &Path) -> Result<String, ()> {
    let file = std::fs::File::open(zip_path).map_err(|_| ())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|_| ())?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|_| ())?;
        if !is_root_readme_path(entry.name()) {
            continue;
        }

        let mut content = String::new();
        std::io::Read::read_to_string(&mut entry, &mut content).map_err(|_| ())?;
        return Ok(content);
    }

    Err(())
}

fn is_root_readme_path(path: &str) -> bool {
    let mut parts = path.split('/').filter(|part| !part.is_empty());
    let Some(_) = parts.next() else {
        return false;
    };
    let Some(file_name) = parts.next() else {
        return false;
    };
    if parts.next().is_some() {
        return false;
    }

    matches!(
        file_name.to_ascii_lowercase().as_str(),
        "readme.md" | "readme.mdx" | "readme.markdown" | "readme.txt"
    )
}

fn read_cached_repo_readme_from_zip(
    owner: &str,
    name: &str,
    branch: Option<&str>,
) -> Result<String, ()> {
    let zip_path = CliService::cache_zip_path(owner, name, branch);
    read_repo_readme_from_zip_path(&zip_path)
}

#[tauri::command]
pub async fn get_repo_readme(
    owner: String,
    name: String,
    branch: Option<String>,
    force: Option<bool>,
) -> Result<String, CommandError> {
    let force = force.unwrap_or(false);
    if let Some(branch) = branch.as_deref() {
        github::validate_repo_segments(&owner, &name, branch).map_err(CommandError::bad_request)?;
    } else {
        github::validate_repo_segments(&owner, &name, "HEAD")
            .map_err(CommandError::bad_request)?;
    }
    let key = format!("{owner}/{name}/{}", repo_ref_cache_key(branch.as_deref()));

    let mut cache = load_readme_cache();
    let stale_cache = cache.get(&key).map(|entry| entry.content.clone());
    if !force {
        if let Some(entry) = cache.get(&key) {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            if now.saturating_sub(entry.fetched_at) < REPO_README_CACHE_TTL {
                return Ok(entry.content.clone());
            }
        }
    }

    match fetch_repo_readme(&owner, &name, branch.as_deref()).await {
        Ok(content) => {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            cache.insert(
                key,
                RepoReadmeCacheEntry {
                    content: content.clone(),
                    fetched_at: now,
                },
            );
            save_readme_cache(&cache);
            Ok(content)
        }
        Err(e) => {
            if let Some(content) = stale_cache {
                eprintln!(
                    "README fetch failed for {owner}/{name}, using stale cache: {e}"
                );
                return Ok(content);
            }

            match read_cached_repo_readme_from_zip(&owner, &name, branch.as_deref()) {
                Ok(content) => {
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs();
                    cache.insert(
                        key,
                        RepoReadmeCacheEntry {
                            content: content.clone(),
                            fetched_at: now,
                        },
                    );
                    save_readme_cache(&cache);
                    Ok(content)
                }
                Err(()) => Err(CommandError::from(e)),
            }
        }
    }
}

#[tauri::command]
pub async fn get_repo_skills(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    owner: String,
    name: String,
    branch: Option<String>,
    force: Option<bool>,
) -> Result<RepoSkillsResult, CommandError> {
    if let Some(branch) = branch.as_deref() {
        github::validate_repo_segments(&owner, &name, branch).map_err(CommandError::bad_request)?;
    } else {
        github::validate_repo_segments(&owner, &name, "HEAD").map_err(CommandError::bad_request)?;
    }
    let force = force.unwrap_or(false);

    let (mut skills, total) = SkillService::discover_from_repo_capped(
        &owner,
        &name,
        branch.as_deref(),
        800,
        force,
        Some(&app),
    )
    .await
    .map_err(CommandError::from)?;

    let cache = state
        .skill_cache
        .read()
        .map_err(|e| CommandError::generic(e.to_string()))?;
    let lock = SkillLock::read().map_err(CommandError::from)?;

    for skill in &mut skills {
        (skill.install_status, skill.installed_skill_id) =
            SkillService::classify_discoverable_skill(
                &cache,
                &lock,
                &skill.directory,
                &owner,
                &name,
                branch.as_deref(),
            );
    }

    Ok(RepoSkillsResult { skills, total })
}

#[tauri::command]
pub async fn preview_skill_md(
    owner: String,
    name: String,
    branch: Option<String>,
    skill_dir: String,
) -> Result<String, CommandError> {
    if let Some(branch) = branch.as_deref() {
        github::validate_repo_segments(&owner, &name, branch).map_err(CommandError::bad_request)?;
    } else {
        github::validate_repo_segments(&owner, &name, "HEAD").map_err(CommandError::bad_request)?;
    }
    validate_skill_directory(&skill_dir).map_err(CommandError::bad_request)?;

    let zip_path = CliService::ensure_cached_zip(&owner, &name, branch.as_deref(), false)
        .await
        .map_err(CommandError::from)?;

    let file = std::fs::File::open(&zip_path).map_err(|e| CommandError::from(AppError::Io(e)))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| CommandError::from(AppError::from(e)))?;

    let needle = format!("/{}/SKILL.md", &skill_dir);
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| CommandError::from(AppError::from(e)))?;
        if entry.name().ends_with(&needle) {
            let mut content = String::new();
            std::io::Read::read_to_string(&mut entry, &mut content)
                .map_err(|e| CommandError::from(AppError::Io(e)))?;
            return Ok(content);
        }
    }

    Err(CommandError::from(AppError::NotFound(format!(
        "SKILL.md not found for skill: {skill_dir}"
    ))))
}

// ────────────── Discover (skills.sh) ──────────────

#[derive(Debug, Clone, serde::Deserialize)]
struct SkillsShApiResponse {
    #[allow(dead_code)]
    query: String,
    skills: Vec<SkillsShApiSkill>,
    #[allow(dead_code)]
    count: usize,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct SkillsShApiSkill {
    #[allow(dead_code)]
    id: String,
    #[serde(rename = "skillId")]
    skill_id: String,
    name: String,
    installs: u64,
    source: String,
}

#[tauri::command]
pub async fn search_skills_sh(
    state: State<'_, AppState>,
    query: String,
    limit: Option<u32>,
) -> Result<Vec<DiscoverableSkill>, String> {
    let query = query.trim().to_string();
    if query.len() < 2 {
        return Err("Query must be at least 2 characters".into());
    }
    let limit = limit.unwrap_or(20);
    let url = "https://skills.sh/api/search";

    let client = config::http_client();

    let resp = client
        .get(url)
        .timeout(std::time::Duration::from_secs(10))
        .query(&[("q", query.as_str()), ("limit", &limit.to_string())])
        .send()
        .await
        .map_err(|e| {
            serde_json::to_string(&CommandError::from(classify_download_error(
                "skills.sh".into(),
                e,
            )))
            .unwrap_or_else(|_| "skills.sh request failed".into())
        })?;

    if !resp.status().is_success() {
        return Err(format!("skills.sh returned status {}", resp.status()));
    }

    let api_result: SkillsShApiResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse skills.sh response: {e}"))?;

    // Classify against the current filesystem-derived cache.
    let cache = state.skill_cache.read().map_err(|e| e.to_string())?;
    let lock = SkillLock::read().map_err(|e| e.to_string())?;

    let mut skills = Vec::new();
    for s in api_result.skills {
        // Filter out non-GitHub sources (e.g. "skills.volces.com/foo")
        let parts: Vec<&str> = s.source.splitn(2, '/').collect();
        if parts.len() != 2 {
            continue;
        }
        let owner = parts[0];
        let repo = parts[1];
        // If either part contains a dot, it's not a GitHub owner/repo
        if owner.contains('.') || repo.contains('.') {
            continue;
        }

        let directory = s.skill_id.clone();
        let (install_status, installed_skill_id) =
            SkillService::classify_discoverable_skill(&cache, &lock, &directory, owner, repo, None);
        skills.push(DiscoverableSkill {
            key: s.id.clone(),
            name: s.name,
            description: None,
            directory,
            repo_owner: owner.to_string(),
            repo_name: repo.to_string(),
            install_status,
            installed_skill_id,
            installs: Some(s.installs),
        });
    }

    Ok(skills)
}

// ────────────── Security Audit (skills.sh) ──────────────

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillAudit {
    provider: String,
    slug: String,
    status: String,
    summary: String,
    risk_level: Option<String>,
    audited_at: Option<String>,
    categories: Option<Vec<String>>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillAuditApiResponse {
    #[allow(dead_code)]
    id: String,
    audits: Vec<SkillAuditApiEntry>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillAuditApiEntry {
    provider: String,
    slug: String,
    status: String,
    summary: String,
    risk_level: Option<String>,
    audited_at: Option<String>,
    categories: Option<Vec<String>>,
}

#[tauri::command]
pub async fn get_skill_audit(
    owner: String,
    repo: String,
    slug: String,
) -> Result<Vec<SkillAudit>, String> {
    if owner.is_empty() || repo.is_empty() || slug.is_empty() {
        return Ok(vec![]);
    }

    let url = format!("https://skills.sh/api/v1/skills/audit/{owner}/{repo}/{slug}");
    let client = config::http_client();

    let resp = client
        .get(&url)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| {
            serde_json::to_string(&CommandError::from(classify_download_error(
                "skills.sh/audit".into(),
                e,
            )))
            .unwrap_or_else(|_| "Audit request failed".into())
        })?;

    if !resp.status().is_success() {
        let status = resp.status();
        return Err(format!("Audit API returned status {status}"));
    }

    let api_result: SkillAuditApiResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to read audit response: {e}"))?;

    Ok(api_result
        .audits
        .into_iter()
        .map(|a| SkillAudit {
            provider: a.provider,
            slug: a.slug,
            status: a.status,
            summary: a.summary,
            risk_level: a.risk_level,
            audited_at: a.audited_at,
            categories: a.categories,
        })
        .collect())
}

// ────────────── Star / Unstar / Create ──────────────

#[tauri::command]
pub fn star_skill(state: State<'_, AppState>, skill_id: String) -> Result<(), String> {
    let mut metadata = state.metadata.write().map_err(|e| e.to_string())?;
    metadata.set_starred(&skill_id, true);
    metadata.save().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn unstar_skill(state: State<'_, AppState>, skill_id: String) -> Result<(), String> {
    let mut metadata = state.metadata.write().map_err(|e| e.to_string())?;
    metadata.set_starred(&skill_id, false);
    metadata.save().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_skill_is_mine(
    state: State<'_, AppState>,
    skill_id: String,
    is_mine: bool,
) -> Result<(), String> {
    let mut metadata = state.metadata.write().map_err(|e| e.to_string())?;
    metadata.set_is_mine(&skill_id, is_mine);
    metadata.save().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_skill(
    state: State<'_, AppState>,
    name: String,
    content: String,
    agents: Vec<String>,
) -> Result<InstalledSkill, String> {
    validate_skill_name(&name)?;
    validate_skill_directory(&name)?;

    let agents_dir = config::get_agents_skills_dir();
    let skill_dir = agents_dir.join(&name);

    if skill_dir.exists() {
        return Err(format!("Skill directory already exists: {name}"));
    }

    std::fs::create_dir_all(&skill_dir)
        .map_err(|e| format!("Failed to create skill directory: {e}"))?;

    let skill_md_path = skill_dir.join("SKILL.md");
    std::fs::write(&skill_md_path, &content)
        .map_err(|e| format!("Failed to write SKILL.md: {e}"))?;

    for agent in &agents {
        if let Some(_agent_dir) = config::get_agent_skills_dir(agent) {
            let _ = SkillService::toggle_symlink(&name, &skill_dir.to_string_lossy(), agent, true);
        }
    }

    // Scan and insert into cache incrementally
    let entry = SkillService::scan_single_skill(&name).map_err(|e| e.to_string())?;
    let entry_id = entry.id.clone();
    SkillService::upsert_cache_entry(&state.skill_cache, entry).map_err(|e| e.to_string())?;

    // Mark as mine in metadata
    {
        let mut metadata = state.metadata.write().map_err(|e| e.to_string())?;
        metadata.set_is_mine(&entry_id, true);
        metadata.save().map_err(|e| e.to_string())?;
    }

    // Return with metadata merged
    let skills = SkillService::read_all_skills(&state.skill_cache, &state.metadata)
        .map_err(|e| e.to_string())?;
    skills
        .into_iter()
        .find(|s| s.id == entry_id)
        .ok_or_else(|| "Skill disappeared after creation".to_string())
}

fn assert_writable_schema(lock: &SkillLock, manifest: &ArchiveManifest) -> Result<(), String> {
    if lock.version > SUPPORTED_LOCK_VERSION {
        return Err(format!(
            "Lock file version {0} is newer than this desktop app supports. Upgrade Skill Zoo before writing.",
            lock.version
        ));
    }
    if manifest.version > SUPPORTED_ARCHIVE_VERSION {
        return Err(format!(
            "Archive manifest version {0} is newer than this desktop app supports. Upgrade Skill Zoo before writing.",
            manifest.version
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::lock::SkillLockEntry;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    fn write_test_zip(entries: &[(&str, &str)]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("repo.zip");
        let file = std::fs::File::create(&path).expect("create zip");
        let mut zip = zip::ZipWriter::new(file);
        let options = SimpleFileOptions::default();

        for (name, content) in entries {
            zip.start_file(name, options).expect("start file");
            zip.write_all(content.as_bytes()).expect("write file");
        }

        zip.finish().expect("finish zip");
        dir
    }

    #[test]
    fn reads_root_readme_from_cached_repo_zip() {
        let dir = write_test_zip(&[
            ("repo-main/docs/README.md", "nested"),
            ("repo-main/README.md", "# Root README"),
        ]);

        let content = read_repo_readme_from_zip_path(&dir.path().join("repo.zip")).unwrap();

        assert_eq!(content, "# Root README");
    }

    #[test]
    fn ignores_nested_readme_in_cached_repo_zip() {
        let dir = write_test_zip(&[("repo-main/docs/README.md", "nested")]);

        let result = read_repo_readme_from_zip_path(&dir.path().join("repo.zip"));

        assert!(result.is_err());
    }

    #[test]
    fn metadata_cache_treats_legacy_branch_as_default_branch_only() {
        let entry = RepoMetadataCacheEntry {
            data: minimal_discover_repo(
                "owner".to_string(),
                "repo".to_string(),
                Some("master".to_string()),
            ),
            fetched_at: 1,
        };

        let entry = normalize_repo_metadata_cache_entry(entry);

        assert_eq!(entry.data.branch, None);
        assert_eq!(entry.data.default_branch.as_deref(), Some("master"));
    }

    #[test]
    fn metadata_cache_clears_branch_when_default_branch_is_present() {
        let mut repo = minimal_discover_repo(
            "owner".to_string(),
            "repo".to_string(),
            Some("main".to_string()),
        );
        repo.default_branch = Some("master".to_string());
        let entry = RepoMetadataCacheEntry {
            data: repo,
            fetched_at: 1,
        };

        let entry = normalize_repo_metadata_cache_entry(entry);

        assert_eq!(entry.data.branch, None);
        assert_eq!(entry.data.default_branch.as_deref(), Some("master"));
    }

    #[test]
    fn maps_supported_image_extensions_to_mime_types() {
        assert_eq!(
            image_mime_from_path(Path::new("/tmp/demo.PNG")),
            Some("image/png")
        );
        assert_eq!(
            image_mime_from_path(Path::new("/tmp/demo.jpeg")),
            Some("image/jpeg")
        );
        assert_eq!(
            image_mime_from_path(Path::new("/tmp/demo.svg")),
            Some("image/svg+xml")
        );
        assert_eq!(image_mime_from_path(Path::new("/tmp/demo.txt")), None);
    }

    #[test]
    fn skill_file_error_uses_stable_command_error_code() {
        let error = skill_file_error("binaryFile", "File is not UTF-8 text");

        assert_eq!(error.code, "binaryFile");
        assert_eq!(error.message, "File is not UTF-8 text");
        assert_eq!(error.repo, None);
    }

    #[test]
    fn update_all_candidates_only_include_ssot_skills() {
        let cache = crate::persistence::SkillCache::from_entries(vec![
            test_cache_entry("repo:owner/repo:ssot-skill", "ssot-skill", "ssot"),
            test_cache_entry("agent:codex:local-skill", "local-skill", "agent"),
        ]);

        let candidates = update_all_candidate_dirs(&cache);

        assert_eq!(candidates, vec!["ssot-skill".to_string()]);
    }

    #[test]
    fn checked_update_candidates_reject_stale_sha_and_non_ssot() {
        let cache = crate::persistence::SkillCache::from_entries(vec![
            test_cache_entry("repo:owner/repo:ssot-skill", "ssot-skill", "ssot"),
            test_cache_entry("agent:codex:local-skill", "local-skill", "agent"),
        ]);
        let mut lock = SkillLock {
            version: SUPPORTED_LOCK_VERSION,
            skills: Default::default(),
            dismissed: serde_json::json!({}),
        };
        lock.skills.insert(
            "ssot-skill".to_string(),
            test_lock_entry("owner/repo", "old-ssot"),
        );
        lock.skills.insert(
            "local-skill".to_string(),
            test_lock_entry("owner/repo", "old-local"),
        );

        let checked = vec![
            CheckedSkillUpdate {
                skill_name: "ssot-skill".to_string(),
                current_sha: "stale".to_string(),
                latest_sha: "new-ssot".to_string(),
            },
            CheckedSkillUpdate {
                skill_name: "local-skill".to_string(),
                current_sha: "old-local".to_string(),
                latest_sha: "new-local".to_string(),
            },
        ];

        let (entries, errors) = checked_update_entries_from_lock(&cache, &lock, &checked);

        assert!(entries.is_empty());
        assert_eq!(errors.len(), 2);
        assert!(errors[0].contains("Update state changed"));
        assert!(errors[1].contains("Only Skill Zoo-managed skills"));
    }

    #[test]
    fn checked_update_candidates_keep_latest_sha_for_reuse() {
        let cache = crate::persistence::SkillCache::from_entries(vec![test_cache_entry(
            "repo:owner/repo:ssot-skill",
            "ssot-skill",
            "ssot",
        )]);
        let mut lock = SkillLock {
            version: SUPPORTED_LOCK_VERSION,
            skills: Default::default(),
            dismissed: serde_json::json!({}),
        };
        lock.skills.insert(
            "ssot-skill".to_string(),
            test_lock_entry("owner/repo", "old-ssot"),
        );
        let checked = vec![CheckedSkillUpdate {
            skill_name: "ssot-skill".to_string(),
            current_sha: "old-ssot".to_string(),
            latest_sha: "new-ssot".to_string(),
        }];

        let (entries, errors) = checked_update_entries_from_lock(&cache, &lock, &checked);

        assert!(errors.is_empty());
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "ssot-skill");
        assert_eq!(entries[0].latest_sha, "new-ssot");
    }

    #[test]
    fn update_result_error_count_matches_errors() {
        let result = update_result_with_error_count(crate::services::cli::UpdateResult {
            success_count: 0,
            fail_count: 0,
            errors: vec!["network failed".to_string()],
            updated: vec![],
        });

        assert_eq!(result.fail_count, 1);
        assert_eq!(result.errors, vec!["network failed".to_string()]);
    }

    #[test]
    fn added_update_error_changes_history_status_from_success_to_partial() {
        let result = update_result_with_added_error(
            crate::services::cli::UpdateResult {
                success_count: 1,
                fail_count: 0,
                errors: vec![],
                updated: vec!["demo".to_string()],
            },
            "cache refresh failed".to_string(),
        );

        assert_eq!(result.fail_count, 1);
        assert_eq!(
            update_history_status(result.success_count, result.fail_count),
            "partial"
        );
        assert!(failed_skill_names(&result.errors).is_empty());
    }

    #[test]
    fn failed_skill_names_only_extracts_skill_prefixed_errors() {
        let errors = vec![
            "demo: download failed".to_string(),
            "cache refresh failed".to_string(),
            "other: missing path".to_string(),
            "demo: another error".to_string(),
        ];

        assert_eq!(failed_skill_names(&errors), vec!["demo", "other"]);
    }

    #[test]
    fn resolves_skill_home_dir_by_skill_id_not_directory_priority() {
        let root = tempfile::tempdir().expect("tempdir");
        let ssot_home = root.path().join(".agents").join("skills").join("demo");
        let agent_home = root.path().join(".codex").join("skills").join("demo");
        std::fs::create_dir_all(&ssot_home).expect("create ssot skill");
        std::fs::create_dir_all(&agent_home).expect("create agent skill");

        let cache = crate::persistence::SkillCache::from_entries(vec![
            test_cache_entry_with_home(
                "repo:owner/repo:demo",
                "demo",
                "ssot",
                Some(ssot_home.to_string_lossy().to_string()),
            ),
            test_cache_entry_with_home(
                "agent:codex:demo",
                "demo",
                "agent",
                Some(agent_home.to_string_lossy().to_string()),
            ),
        ]);

        let resolved = resolve_skill_home_dir_from_cache(&cache, Some("agent:codex:demo"), "demo")
            .expect("resolve skill home");

        assert_eq!(resolved, agent_home);
    }

    #[test]
    fn remove_cached_skill_from_disk_removes_selected_home_not_same_named_duplicate() {
        let root = tempfile::tempdir().expect("tempdir");
        let ssot_home = root.path().join(".agents").join("skills").join("demo");
        let agent_home = root.path().join(".codex").join("skills").join("demo");
        std::fs::create_dir_all(&ssot_home).expect("create ssot skill");
        std::fs::create_dir_all(&agent_home).expect("create agent skill");

        let skill = test_cache_entry_with_home(
            "agent:codex:demo",
            "demo",
            "agent",
            Some(agent_home.to_string_lossy().to_string()),
        );

        remove_cached_skill_from_disk(&skill).expect("remove selected skill");

        assert!(ssot_home.exists());
        assert!(!agent_home.exists());
    }

    fn test_cache_entry(
        id: &str,
        directory: &str,
        origin: &str,
    ) -> crate::persistence::SkillCacheEntry {
        test_cache_entry_with_home(id, directory, origin, None)
    }

    fn test_cache_entry_with_home(
        id: &str,
        directory: &str,
        origin: &str,
        home_path: Option<String>,
    ) -> crate::persistence::SkillCacheEntry {
        crate::persistence::SkillCacheEntry {
            id: id.to_string(),
            name: directory.to_string(),
            yaml_name: None,
            description: None,
            directory: directory.to_string(),
            repo_owner: Some("owner".to_string()),
            repo_name: Some("repo".to_string()),
            source_url: Some("https://github.com/owner/repo".to_string()),
            origin: origin.to_string(),
            home_path,
            content_hash: None,
            home_agent: None,
            apps: std::collections::HashMap::new(),
            installed_at: 0,
            updated_at: 0,
        }
    }

    fn test_lock_entry(source: &str, commit_sha: &str) -> SkillLockEntry {
        SkillLockEntry {
            source: Some(source.to_string()),
            source_type: Some("github".to_string()),
            source_url: Some(format!("https://github.com/{source}")),
            branch: Some("main".to_string()),
            skill_path: Some("skills/demo".to_string()),
            skill_folder_hash: None,
            installed_at: None,
            updated_at: None,
            commit_sha: Some(commit_sha.to_string()),
        }
    }
}

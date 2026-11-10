use crate::config;
use crate::config::{AgentConfig, AgentPathInfo};
use crate::error::{classify_download_error, AppError, CommandError};
use crate::persistence::external_imports::SUPPORTED_EXTERNAL_IMPORTS_VERSION;
use crate::persistence::{
    atomic_write, ArchivedSkill, ExternalImportEntry, ExternalImports, SkillCache, SkillCacheEntry,
    SkillUpdateHistory, SkillUpdateHistoryRecord,
};
use crate::services::cli::{CliService, KnownSkillUpdate};
use crate::services::github;
use crate::services::lock::SkillLock;
use crate::services::opener::open_directory;
use crate::services::skill::{
    is_symlink_or_junction, plugin_read_only_error, DiscoverableSkill, InstalledSkill,
    ManagedSkill, RepoSkillsResult, SkillFileNode, SkillService, SymlinkStatus,
};
use crate::services::skill_archive::{self, ArchiveSkillsResult, RestoreArchivedSkillsResult};
use crate::store::AppState;
use futures::future::Abortable;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use tauri_plugin_opener::OpenerExt;

use rand::distr::{Alphanumeric, SampleString};
use regex::Regex;
use tauri::{Manager, State};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SingleSkillUpdateResult {
    pub skill: InstalledSkill,
    pub updated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAllResult {
    pub skills: Vec<InstalledSkill>,
    pub success_count: usize,
    pub fail_count: usize,
    pub errors: Vec<String>,
    pub updated: Vec<String>,
    pub skipped_drifted: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckedSkillUpdate {
    pub skill_name: String,
    pub current_sha: String,
    pub latest_sha: String,
    pub force: Option<bool>,
}

const MAX_IMAGE_PREVIEW_BYTES: u64 = 25 * 1024 * 1024;

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

fn known_skill_roots() -> Vec<PathBuf> {
    std::iter::once(config::get_agents_skills_dir())
        .chain(config::agents().iter().filter_map(config::agent_skills_dir))
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

fn link_points_to_import_source(link_path: &Path, source_path: &Path) -> bool {
    crate::services::skill::symlink_target_matches(link_path, source_path)
        || crate::services::skill::raw_symlink_target_matches(link_path, source_path)
}

fn external_import_link_path(directory: &str, agent: &str) -> Result<PathBuf, String> {
    if !config::agents().iter().any(|config| config.id == agent) {
        return Err(format!("Unknown agent: {agent}"));
    }
    let agent_dir =
        config::get_agent_skills_dir(agent).ok_or_else(|| format!("Unknown agent: {agent}"))?;
    Ok(agent_dir.join(SkillService::agent_link_name(directory)))
}

fn remove_external_import_store_link_for_target(
    directory: &str,
    source_path: &Path,
    store_dir: &Path,
) -> Result<usize, crate::error::AppError> {
    let link_path = store_dir.join(SkillService::agent_link_name(directory));
    if is_symlink_or_junction(&link_path) && link_points_to_import_source(&link_path, source_path) {
        SkillService::safe_remove(&link_path)?;
        return Ok(1);
    }
    Ok(0)
}

fn remove_external_import_links_for_target(
    directory: &str,
    source_path: &Path,
) -> Result<usize, crate::error::AppError> {
    let mut removed = SkillService::remove_agent_links_for_target(directory, source_path)?;
    removed += remove_external_import_store_link_for_target(
        directory,
        source_path,
        &config::get_agents_skills_dir(),
    )?;
    Ok(removed)
}

fn selected_agent_skill_dirs(agents: &[String]) -> Vec<PathBuf> {
    agents
        .iter()
        .filter_map(|agent| config::get_agent_skills_dir(agent))
        .collect()
}

fn visible_discover_conflict_cache(state: &AppState) -> Result<SkillCache, String> {
    let visible_agents = {
        let settings = state.settings.lock().map_err(|e| e.to_string())?;
        SkillService::get_visible_agents(&settings)
    };
    let cache = state.skill_cache.read().map_err(|e| e.to_string())?;
    Ok(SkillCache::from_entries(
        cache
            .iter()
            .filter(|skill| SkillService::is_visible_local_skill(skill, &visible_agents, false))
            .cloned()
            .collect(),
    ))
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
    crate::config::agents().as_ref().clone()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalImportSelection {
    pub source_path: String,
    pub directory: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalImportCandidate {
    pub source_path: String,
    pub directory: String,
    pub name: String,
    pub description: Option<String>,
    pub already_imported: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ExternalImportStatus {
    Valid,
    SourceMissing,
    SkillMissing,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalImportInfo {
    pub id: String,
    pub source_path: String,
    pub directory: String,
    pub name: String,
    pub description: Option<String>,
    pub status: ExternalImportStatus,
    pub linked_agents: Vec<String>,
    pub imported_at: i64,
    pub updated_at: i64,
}

fn external_import_status(import: &ExternalImportEntry) -> ExternalImportStatus {
    let source_path = PathBuf::from(&import.source_path);
    if !source_path.exists() {
        return ExternalImportStatus::SourceMissing;
    }
    if !source_path.join("SKILL.md").exists() {
        return ExternalImportStatus::SkillMissing;
    }
    ExternalImportStatus::Valid
}

fn linked_external_import_agents(import: &ExternalImportEntry) -> Vec<String> {
    let source_path = PathBuf::from(&import.source_path);
    config::agents()
        .iter()
        .filter_map(|agent| {
            let link_path = external_import_link_path(&import.directory, &agent.id).ok()?;
            if is_symlink_or_junction(&link_path)
                && link_points_to_import_source(&link_path, &source_path)
            {
                Some(agent.id.to_string())
            } else {
                None
            }
        })
        .collect()
}

fn external_import_info(import: &ExternalImportEntry) -> ExternalImportInfo {
    let source_path = PathBuf::from(&import.source_path);
    let dir_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_else(|| SkillService::agent_link_name(&import.directory))
        .to_string();
    let skill_md = source_path.join("SKILL.md");
    let (parsed_name, description) =
        SkillService::parse_skill_md(&skill_md).unwrap_or((dir_name.clone(), None));
    ExternalImportInfo {
        id: import.id.clone(),
        source_path: strip_verbatim_prefix(import.source_path.clone()),
        directory: import.directory.clone(),
        name: parsed_name,
        description,
        status: external_import_status(import),
        linked_agents: linked_external_import_agents(import),
        imported_at: import.imported_at,
        updated_at: import.updated_at,
    }
}

fn strip_verbatim_prefix(path: String) -> String {
    path.strip_prefix("\\\\?\\UNC\\")
        .map(|rest| format!("\\\\{}", rest))
        .or_else(|| path.strip_prefix("\\\\?\\").map(str::to_string))
        .unwrap_or(path)
}

fn collect_external_import_candidates(
    root: &Path,
    dir: &Path,
    existing_sources: &HashSet<PathBuf>,
    candidates: &mut Vec<ExternalImportCandidate>,
) -> Result<(), String> {
    let managed_roots = known_skill_roots();
    let entries = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let raw_path = entry.path();
        if !raw_path.is_dir() {
            continue;
        }
        let path = raw_path.canonicalize().unwrap_or(raw_path.clone());
        let file_name = raw_path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if config::SKIP_DIRS.contains(&file_name) {
            continue;
        }
        if is_path_under_roots(&path, &managed_roots, true) {
            continue;
        }
        if path.join("SKILL.md").exists() {
            let directory = raw_path
                .strip_prefix(root)
                .ok()
                .and_then(|relative| {
                    if relative.as_os_str().is_empty() {
                        None
                    } else {
                        relative.to_str().map(|s| s.to_string())
                    }
                })
                .unwrap_or_else(|| file_name.to_string())
                .replace(std::path::MAIN_SEPARATOR, "/");
            validate_skill_directory(&directory)?;
            let (name, description) = SkillService::parse_skill_md(&path.join("SKILL.md"))
                .unwrap_or((file_name.into(), None));
            let source_path = path.canonicalize().unwrap_or(path);
            candidates.push(ExternalImportCandidate {
                source_path: strip_verbatim_prefix(source_path.display().to_string()),
                directory,
                name,
                description,
                already_imported: existing_sources.contains(&source_path),
            });
        } else if is_symlink_or_junction(&raw_path) {
            continue;
        } else {
            collect_external_import_candidates(root, &path, existing_sources, candidates)?;
        }
    }
    Ok(())
}

fn make_external_import_id(source_path: &Path, imports: &ExternalImports) -> String {
    let slug = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("skill")
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    let slug = if slug.is_empty() { "skill" } else { &slug };
    loop {
        let suffix = Alphanumeric
            .sample_string(&mut rand::rng(), 8)
            .to_ascii_lowercase();
        let id = format!("external:{slug}-{suffix}");
        if !imports.imports.contains_key(&id) {
            return id;
        }
    }
}

fn ensure_external_import_link_available(
    directory: &str,
    source_path: &Path,
    agent: &str,
) -> Result<(), String> {
    let link_path = external_import_link_path(directory, agent)?;
    if is_symlink_or_junction(&link_path) {
        if link_points_to_import_source(&link_path, source_path) {
            return Ok(());
        }
        return Err(format!(
            "Cannot link {directory} for {agent}: {} already points to a different target.",
            link_path.display()
        ));
    }
    if link_path.exists() && !link_points_to_import_source(&link_path, source_path) {
        return Err(format!(
            "Cannot link {directory} for {agent}: {} already exists.",
            link_path.display()
        ));
    }
    Ok(())
}

fn assert_external_source_path(source_path: &Path) -> Result<(), String> {
    if is_path_under_roots(source_path, &known_skill_roots(), true) {
        return Err(
            "External imports must be outside Skill Zoo and registered agent skill directories."
                .to_string(),
        );
    }
    Ok(())
}

#[tauri::command]
pub fn list_external_imports() -> Result<Vec<ExternalImportInfo>, String> {
    let imports = ExternalImports::load().map_err(|e| e.to_string())?;
    Ok(imports.imports.values().map(external_import_info).collect())
}

#[tauri::command]
pub fn scan_external_import_folder(path: String) -> Result<Vec<ExternalImportCandidate>, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("Import folder does not exist: {}", root.display()));
    }
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    assert_external_source_path(&root)?;
    let imports = ExternalImports::load().map_err(|e| e.to_string())?;
    let existing_sources: HashSet<PathBuf> = imports
        .imports
        .values()
        .filter_map(|import| PathBuf::from(&import.source_path).canonicalize().ok())
        .collect();
    let mut candidates = Vec::new();
    if root.join("SKILL.md").exists() {
        let file_name = root.file_name().and_then(|n| n.to_str()).unwrap_or("skill");
        let (name, description) = SkillService::parse_skill_md(&root.join("SKILL.md"))
            .unwrap_or((file_name.into(), None));
        candidates.push(ExternalImportCandidate {
            source_path: strip_verbatim_prefix(root.display().to_string()),
            directory: file_name.to_string(),
            name,
            description,
            already_imported: existing_sources.contains(&root),
        });
    } else {
        collect_external_import_candidates(&root, &root, &existing_sources, &mut candidates)?;
    }
    candidates.sort_by(|left, right| left.directory.cmp(&right.directory));
    Ok(candidates)
}

#[tauri::command]
pub async fn import_external_skills(
    state: State<'_, AppState>,
    selections: Vec<ExternalImportSelection>,
    agents: Vec<String>,
) -> Result<Vec<InstalledSkill>, String> {
    import_external_skills_for_state(&state, selections, agents).await
}

async fn import_external_skills_for_state(
    state: &AppState,
    selections: Vec<ExternalImportSelection>,
    agents: Vec<String>,
) -> Result<Vec<InstalledSkill>, String> {
    let _update = state.update_exit.start_update();
    let _agent_lease = state.acquire_local_lease().map_err(|e| e.to_string())?;
    let _refresh = state.cache_refresh_lock.lock().await;
    if selections.is_empty() {
        return Err("No external skills selected".into());
    }
    if agents.is_empty() {
        return Err("Select at least one agent".into());
    }

    let mut imports = ExternalImports::load().map_err(|e| e.to_string())?;
    if imports.version > SUPPORTED_EXTERNAL_IMPORTS_VERSION {
        return Err(format!(
            "External imports version {} is newer than this desktop app supports. Upgrade Skill Zoo before writing.",
            imports.version
        ));
    }

    let now = chrono::Utc::now().timestamp();
    let previous_imports = imports.clone();
    let mut prepared = Vec::new();
    let mut sources = HashSet::new();
    let mut link_names = HashSet::new();
    for selection in &selections {
        validate_skill_directory(&selection.directory)?;
        let source_path = PathBuf::from(&selection.source_path)
            .canonicalize()
            .map_err(|e| format!("Invalid source path {}: {e}", selection.source_path))?;
        assert_external_source_path(&source_path)?;
        if !sources.insert(source_path.clone()) {
            return Err("The same external source was selected more than once".into());
        }
        if !link_names.insert(SkillService::agent_link_name(&selection.directory).to_string()) {
            return Err("Selected external skills require the same agent link name".into());
        }
        if !source_path.join("SKILL.md").is_file() {
            return Err(format!("SKILL.md not found: {}", source_path.display()));
        }
        for agent in &agents {
            ensure_external_import_link_available(&selection.directory, &source_path, agent)?;
        }
        prepared.push((selection.clone(), source_path));
    }

    let mut imported_ids = Vec::new();
    let mut renamed_imports: Vec<(String, String)> = Vec::new();
    for (selection, source_path) in &prepared {
        let existing_id = imports.imports.values().find_map(|import| {
            PathBuf::from(&import.source_path)
                .canonicalize()
                .ok()
                .filter(|path| path == source_path)
                .map(|_| import.id.clone())
        });
        let import_id =
            existing_id.unwrap_or_else(|| make_external_import_id(source_path, &imports));
        match imports.imports.get_mut(&import_id) {
            Some(import) => {
                if SkillService::agent_link_name(&import.directory)
                    != SkillService::agent_link_name(&selection.directory)
                {
                    renamed_imports.push((import.directory.clone(), import.source_path.clone()));
                }
                import.source_path = strip_verbatim_prefix(source_path.display().to_string());
                import.directory = selection.directory.clone();
                import.updated_at = now;
            }
            None => {
                imports.imports.insert(
                    import_id.clone(),
                    ExternalImportEntry {
                        id: import_id.clone(),
                        source_path: strip_verbatim_prefix(source_path.display().to_string()),
                        directory: selection.directory.clone(),
                        imported_at: now,
                        updated_at: now,
                    },
                );
            }
        }
        imported_ids.push(import_id);
    }

    imports.save().map_err(|e| e.to_string())?;

    let rollback = |message: String, created_links: &[(String, PathBuf, String)]| {
        let mut errors = Vec::new();
        for (directory, source_path, agent) in created_links.iter().rev() {
            if let Err(e) = SkillService::toggle_symlink(
                directory,
                &source_path.to_string_lossy(),
                agent,
                false,
            ) {
                errors.push(format!("remove new import link: {e}"));
            }
        }
        if let Err(e) = previous_imports.save() {
            errors.push(format!("restore imports: {e}"));
        }
        if errors.is_empty() {
            message
        } else {
            format!("{message}. Recovery incomplete: {}", errors.join("; "))
        }
    };
    let mut created_links: Vec<(String, PathBuf, String)> = Vec::new();
    for (selection, source_path) in &prepared {
        for agent in &agents {
            let preexisting = external_import_link_path(&selection.directory, agent)
                .ok()
                .map(|link| {
                    is_symlink_or_junction(&link)
                        && link_points_to_import_source(&link, source_path)
                })
                .unwrap_or(false);
            if let Err(e) = SkillService::toggle_symlink(
                &selection.directory,
                &source_path.to_string_lossy(),
                agent,
                true,
            ) {
                return Err(rollback(e.to_string(), &created_links));
            }
            if !preexisting {
                created_links.push((
                    selection.directory.clone(),
                    source_path.clone(),
                    agent.clone(),
                ));
            }
        }
    }

    let entries = imported_ids
        .iter()
        .map(|id| SkillService::scan_external_import(&imports.imports[id]))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| rollback(e.to_string(), &created_links))?;
    SkillService::upsert_cache_entries(&state.skill_cache, entries)
        .map_err(|e| rollback(e.to_string(), &created_links))?;

    for (old_directory, old_source) in &renamed_imports {
        let _ = remove_external_import_links_for_target(old_directory, &PathBuf::from(old_source));
    }

    for (selection, source_path) in &prepared {
        let _ = remove_external_import_store_link_for_target(
            &selection.directory,
            source_path,
            &config::get_agents_skills_dir(),
        );
    }

    {
        let mut seen = std::collections::HashSet::new();
        for (_, source_path) in &prepared {
            if seen.insert(source_path) {
                crate::services::watcher::watch_external_path(state, source_path);
            }
        }
    }

    SkillService::read_all_skills(&state.skill_cache, &state.metadata).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_external_import(state: State<'_, AppState>, import_id: String) -> Result<(), String> {
    let _agent_lease = state.acquire_local_lease().map_err(|e| e.to_string())?;
    let mut imports = ExternalImports::load().map_err(|e| e.to_string())?;
    let import = imports
        .imports
        .remove(&import_id)
        .ok_or_else(|| format!("External import not found: {import_id}"))?;
    imports.save().map_err(|e| e.to_string())?;

    let source_path = PathBuf::from(&import.source_path);
    crate::services::watcher::unwatch_external_path(&state, &source_path);

    let _ = remove_external_import_links_for_target(&import.directory, &source_path);
    let _ = SkillService::remove_cache_entry(&state.skill_cache, &import_id);
    if let Ok(mut metadata) = state.metadata.write() {
        metadata.remove(&import_id);
        let _ = metadata.save();
    }
    Ok(())
}

#[tauri::command]
pub fn clean_external_import_links(
    state: State<'_, AppState>,
    import_id: Option<String>,
) -> Result<usize, String> {
    let _agent_lease = state.acquire_local_lease().map_err(|e| e.to_string())?;
    let imports = ExternalImports::load().map_err(|e| e.to_string())?;
    let mut removed = 0;
    for import in imports.imports.values() {
        if import_id.as_deref().is_some_and(|id| id != import.id) {
            continue;
        }
        if matches!(external_import_status(import), ExternalImportStatus::Valid) {
            continue;
        }
        let source_path = PathBuf::from(&import.source_path);
        removed += remove_external_import_links_for_target(&import.directory, &source_path)
            .map_err(|e| e.to_string())?;
        if let Ok(entry) = SkillService::scan_external_import(import) {
            let _ = SkillService::upsert_cache_entry(&state.skill_cache, entry);
        } else {
            let _ = SkillService::remove_cache_entry(&state.skill_cache, &import.id);
        }
    }
    Ok(removed)
}

fn rollback_installed_skills(
    installed_dirs: &[String],
    created_links: &[(String, String)],
) -> Vec<String> {
    let mut errors = Vec::new();
    for (skill_dir, agent) in created_links.iter().rev() {
        let home_path = config::get_agents_skills_dir().join(skill_dir);
        if let Err(error) =
            SkillService::toggle_symlink(skill_dir, &home_path.to_string_lossy(), agent, false)
        {
            errors.push(format!("remove link for {skill_dir} from {agent}: {error}"));
        }
    }
    for skill_dir in installed_dirs {
        let path = config::get_agents_skills_dir().join(skill_dir);
        if let Err(error) = std::fs::remove_dir_all(&path) {
            if error.kind() != std::io::ErrorKind::NotFound {
                errors.push(format!("remove {}: {error}", path.display()));
            }
        }
    }
    if let Err(error) = SkillLock::update(|lock| {
        for skill_dir in installed_dirs {
            lock.skills.remove(skill_dir);
        }
        Ok::<(), AppError>(())
    }) {
        errors.push(format!("update lock file: {error}"));
    }
    errors
}

fn lease_command_error(error: AppError) -> String {
    CommandError::from(error).to_json()
}

fn command_error_with_recovery(error: AppError, recovery_errors: Vec<String>) -> CommandError {
    let mut command_error = CommandError::from(error);
    if !recovery_errors.is_empty() {
        command_error.message.push_str(&format!(
            ". Recovery incomplete: {}",
            recovery_errors.join("; ")
        ));
    }
    command_error
}

async fn fail_installed_skills(
    state: &AppState,
    installed_dirs: &[String],
    created_links: &[(String, String)],
    error: AppError,
) -> CommandError {
    let mut recovery_errors = rollback_installed_skills(installed_dirs, created_links);
    if let Err(error) = SkillService::rebuild_cache(
        &state.skill_cache,
        &state.metadata,
        &state.cache_refresh_lock,
    )
    .await
    {
        recovery_errors.push(format!("rebuild cache after rollback: {error}"));
    }

    command_error_with_recovery(error, recovery_errors)
}

#[tauri::command]
pub async fn install_skills(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_url: String,
    skill_names: Vec<String>,
    agents: Vec<String>,
) -> Result<Vec<InstalledSkill>, CommandError> {
    let _update_guard = state.update_exit.start_update();
    let _agent_lease = state.acquire_local_lease().map_err(CommandError::from)?;
    for agent in &agents {
        if !config::agents().iter().any(|config| config.id == *agent) {
            return Err(CommandError::from(AppError::BadRequest(format!(
                "Unknown agent: {agent}"
            ))));
        }
    }
    let preflight_agent_dirs = selected_agent_skill_dirs(&agents);
    let needs_monitoring = preflight_agent_dirs.iter().any(|p| !p.exists());
    let installed_dirs = CliService::add_skills(&repo_url, &skill_names, &preflight_agent_dirs)
        .await
        .map_err(CommandError::from)?;

    let mut created_links = Vec::new();
    for skill_dir in &installed_dirs {
        let home_path = config::get_agents_skills_dir().join(skill_dir);
        for agent in &agents {
            if let Err(error) =
                SkillService::toggle_symlink(skill_dir, &home_path.to_string_lossy(), agent, true)
            {
                return Err(
                    fail_installed_skills(&state, &installed_dirs, &created_links, error).await,
                );
            }
            created_links.push((skill_dir.clone(), agent.clone()));
        }
    }

    if needs_monitoring {
        if let Err(error) = crate::services::watcher::restart_skill_watcher(&app, &state) {
            eprintln!("Failed to monitor installed agent root: {error}");
        }
    }
    match SkillService::refresh_installed_skills(
        &state.skill_cache,
        &state.metadata,
        &state.cache_refresh_lock,
        installed_dirs.clone(),
    )
    .await
    {
        Ok(skills) => Ok(skills),
        Err(error) => {
            Err(fail_installed_skills(&state, &installed_dirs, &created_links, error).await)
        }
    }
}

#[tauri::command]
pub async fn get_installed_skills(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    force: Option<bool>,
) -> Result<Vec<InstalledSkill>, String> {
    if force.unwrap_or(false) {
        if let Err(error) = crate::services::watcher::restart_skill_watcher(&app, &state) {
            eprintln!("Failed to restart skill monitoring on refresh: {error}");
        }
    }
    if !force.unwrap_or(false) {
        let (is_empty, has_stale_plugins) = {
            let cache = state.skill_cache.read().map_err(|e| e.to_string())?;
            let settings = state.settings.lock().map_err(|e| e.to_string())?;
            let discovery_off = !settings.plugins_discovery_enabled();
            (
                cache.is_empty(),
                discovery_off && cache.iter().any(|s| s.origin == "plugin"),
            )
        };
        if !is_empty && !has_stale_plugins {
            return SkillService::read_all_skills(&state.skill_cache, &state.metadata)
                .map_err(|e| e.to_string());
        }
    }
    SkillService::rebuild_cache(
        &state.skill_cache,
        &state.metadata,
        &state.cache_refresh_lock,
    )
    .await
    .map_err(|e| e.to_string())
}

fn locally_modified_error(skill_name: &str) -> CommandError {
    CommandError {
        code: "skillLocallyModified",
        message: format!("{skill_name} was modified locally. Updating replaces your edits."),
        repo: None,
        authenticated: None,
        retry_at: None,
    }
}

#[tauri::command]
pub async fn update_skill(
    state: State<'_, AppState>,
    skill_id: String,
    force: Option<bool>,
) -> Result<SingleSkillUpdateResult, CommandError> {
    let _update_guard = state.update_exit.start_update();
    let _agent_lease = state.acquire_local_lease().map_err(CommandError::from)?;
    let skill = SkillService::find_in_cache(&state.skill_cache, &skill_id)
        .map_err(CommandError::from)?
        .ok_or_else(|| CommandError::not_found(format!("Skill not found: {skill_id}")))?;

    if skill.origin != "ssot" {
        return Err(CommandError::bad_request(
            "Only Skill Zoo-managed skills in the SSOT store can be updated from Git.",
        ));
    }

    let lock = SkillLock::read().map_err(CommandError::from)?;
    let lock_entry = lock.skills.get(&skill.directory).cloned().ok_or_else(|| {
        CommandError::not_found(format!(
            "Skill {} is not tracked in the lock file. Reinstall from GitHub to enable updates.",
            skill.directory
        ))
    })?;

    let (owner, repo, branch) =
        CliService::update_repo_info(&lock_entry).map_err(CommandError::from)?;

    let tree = CliService::fetch_repo_tree(&owner, &repo, branch.as_deref())
        .await
        .map_err(CommandError::from)?
        .ok_or_else(|| {
            CommandError::not_found(format!(
                "Repository or branch not found: {}/{}",
                owner, repo
            ))
        })?;

    let skill_path = lock_entry.skill_path.as_deref().unwrap_or("");
    let new_sha = CliService::get_folder_sha_from_tree(&tree, skill_path).ok_or_else(|| {
        CommandError::not_found(format!(
            "Skill path no longer exists in {}/{}: {}",
            owner, repo, skill_path
        ))
    })?;

    let started_at = chrono::Utc::now().to_rfc3339();
    let requested_skills = vec![skill.directory.clone()];

    if lock_entry.commit_sha.as_deref() == Some(&new_sha) {
        let result = crate::services::cli::UpdateResult {
            success_count: 0,
            fail_count: 0,
            errors: vec![],
            updated: vec![],
            skipped_drifted: vec![],
        };
        record_update_history_with_started_at(started_at, "single", requested_skills, &result);

        let skills = SkillService::read_all_skills(&state.skill_cache, &state.metadata)
            .map_err(|e| CommandError::generic(e.to_string()))?;
        let updated_skill = skills
            .into_iter()
            .find(|s| s.id == skill_id)
            .unwrap_or_else(|| InstalledSkill::from(skill.clone()));
        return Ok(SingleSkillUpdateResult {
            skill: updated_skill,
            updated: false,
        });
    }

    let known_update = KnownSkillUpdate {
        name: skill.directory.clone(),
        entry: lock_entry,
        latest_sha: new_sha,
        force: force == Some(true),
    };

    if force != Some(true) {
        let ssot_dir = crate::config::get_agents_skills_dir();
        if crate::services::lock::skill_folder_drifted(
            &ssot_dir.join(&skill.directory),
            &known_update.entry,
        ) {
            return Err(locally_modified_error(&skill.name));
        }
    }

    let result = CliService::update_known_skill_entries(vec![known_update])
        .await
        .unwrap_or_else(|e| {
            eprintln!("Update skill error: {e}");
            crate::services::cli::UpdateResult {
                success_count: 0,
                fail_count: 1,
                errors: vec![format!("{}: {e}", skill.directory)],
                updated: vec![],
                skipped_drifted: vec![],
            }
        });

    if !result.skipped_drifted.is_empty() {
        return Err(locally_modified_error(&skill.name));
    }

    if result.fail_count > 0 {
        record_update_history_with_started_at(started_at, "single", requested_skills, &result);
        return Err(CommandError::generic(result.errors.join("; ")));
    }

    let skills = match SkillService::refresh_installed_skills(
        &state.skill_cache,
        &state.metadata,
        &state.cache_refresh_lock,
        result.updated.clone(),
    )
    .await
    {
        Ok(skills) => skills,
        Err(e) => {
            let message = e.to_string();
            let result =
                update_result_with_added_error(result, format!("{}: {message}", skill.directory));
            record_update_history_with_started_at(started_at, "single", requested_skills, &result);
            return Err(CommandError::generic(message));
        }
    };

    match skills.into_iter().find(|s| s.id == skill_id) {
        Some(skill) => {
            record_update_history_with_started_at(started_at, "single", requested_skills, &result);
            Ok(SingleSkillUpdateResult {
                skill,
                updated: true,
            })
        }
        None => {
            let message = "Skill disappeared after update".to_string();
            let result =
                update_result_with_added_error(result, format!("{}: {message}", skill.directory));
            record_update_history_with_started_at(started_at, "single", requested_skills, &result);
            Err(CommandError::generic(message))
        }
    }
}

#[tauri::command]
pub async fn update_all_skills(
    state: State<'_, AppState>,
    checked_updates: Option<Vec<CheckedSkillUpdate>>,
) -> Result<UpdateAllResult, String> {
    let _update_guard = state.update_exit.start_update();
    let _agent_lease = state.acquire_local_lease().map_err(lease_command_error)?;
    let started_at = chrono::Utc::now().to_rfc3339();
    let (mode, requested_skills, update_result) = if let Some(checked_updates) = checked_updates {
        let requested_skills: Vec<String> = checked_updates
            .iter()
            .map(|checked| checked.skill_name.clone())
            .collect();
        let (known_updates, validation_errors, skipped_drifted) = {
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
                skipped_drifted,
            }
        } else {
            let mut result = CliService::update_known_skill_entries(known_updates)
                .await
                .unwrap_or_else(|e| {
                    eprintln!("Update checked skills error: {e}");
                    crate::services::cli::UpdateResult {
                        success_count: 0,
                        fail_count: 0,
                        errors: vec![e.to_string()],
                        updated: vec![],
                        skipped_drifted: vec![],
                    }
                });
            result.skipped_drifted.extend(skipped_drifted);
            result
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
                    skipped_drifted: vec![],
                }
            });
        ("all", requested_skills, result)
    };
    let update_result = update_result_with_error_count(update_result);

    let skills = match SkillService::refresh_installed_skills(
        &state.skill_cache,
        &state.metadata,
        &state.cache_refresh_lock,
        update_result.updated.clone(),
    )
    .await
    {
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
        skipped_drifted: update_result.skipped_drifted,
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
) -> (Vec<KnownSkillUpdate>, Vec<String>, Vec<String>) {
    let allowed: HashSet<String> = update_all_candidate_dirs(cache).into_iter().collect();
    let mut updates = Vec::new();
    let mut errors = Vec::new();
    let mut skipped_drifted = Vec::new();
    let ssot_dir = crate::config::get_agents_skills_dir();

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
        if checked.force != Some(true)
            && crate::services::lock::skill_folder_drifted(
                &ssot_dir.join(&checked.skill_name),
                &entry,
            )
        {
            skipped_drifted.push(checked.skill_name.clone());
            continue;
        }
        updates.push(KnownSkillUpdate {
            name: checked.skill_name.clone(),
            entry,
            latest_sha: checked.latest_sha.clone(),
            force: checked.force == Some(true),
        });
    }

    (updates, errors, skipped_drifted)
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

fn remove_lock_entry_for_skill(skill: &SkillCacheEntry) {
    if skill.origin != "ssot" {
        return;
    }
    if let Err(e) = SkillLock::update(|lock| {
        let key = if lock.skills.contains_key(&skill.directory) {
            skill.directory.clone()
        } else if lock.skills.contains_key(&skill.name) {
            skill.name.clone()
        } else {
            return Ok::<(), AppError>(());
        };
        lock.skills.remove(&key);
        Ok::<(), AppError>(())
    }) {
        eprintln!(
            "Failed to write lock after removing {}: {e}",
            skill.directory
        );
    }
}

fn remove_cached_skill_from_disk(skill: &SkillCacheEntry) -> Result<(), String> {
    if skill.origin == "external" {
        let mut imports = ExternalImports::load().map_err(|e| e.to_string())?;
        let import = imports
            .imports
            .remove(&skill.id)
            .ok_or_else(|| format!("External import not found: {}", skill.id))?;
        imports.save().map_err(|e| e.to_string())?;
        let _ = remove_external_import_links_for_target(
            &import.directory,
            &PathBuf::from(&import.source_path),
        );
        return Ok(());
    }

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
    let imports = ExternalImports::load().map_err(|e| e.to_string())?;
    if imports.imports.contains_key(&skill.id) || skill.origin == "external" {
        let import = imports
            .imports
            .get(&skill.id)
            .ok_or_else(|| format!("External import not found: {}", skill.id))?;
        return SkillService::scan_external_import(import).map_err(|e| e.to_string());
    }

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
pub struct BatchUnlinkSkillsResult {
    pub unlinked: Vec<String>,
    pub skipped: Vec<String>,
    pub failed: Vec<BatchUnlinkSkillFailure>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchUnlinkSkillFailure {
    pub skill_id: String,
    pub error: String,
}

#[tauri::command]
pub async fn remove_skills(
    state: State<'_, AppState>,
    skill_ids: Vec<String>,
) -> Result<RemoveSkillsResult, String> {
    let _agent_lease = state.acquire_local_lease().map_err(lease_command_error)?;
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

        if skill.origin == "plugin" {
            failed.push(RemoveSkillFailure {
                skill_id: skill_id.clone(),
                error: plugin_read_only_error(&skill.name, skill.plugin_source.as_deref()),
            });
            continue;
        }

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

        removed.push(skill_id.clone());
    }

    {
        let mut metadata = state.metadata.write().map_err(|e| e.to_string())?;
        for skill_id in &removed {
            metadata.remove(skill_id);
        }
        metadata.save().map_err(|e| e.to_string())?;
    }

    Ok(RemoveSkillsResult { removed, failed })
}

#[tauri::command]
pub fn get_archived_skills() -> Result<Vec<ArchivedSkill>, String> {
    skill_archive::get_archived_skills()
}

#[tauri::command]
pub fn read_archived_skill_md(archive_id: String) -> Result<String, String> {
    skill_archive::read_archived_skill_md(archive_id)
}

#[tauri::command]
pub async fn archive_skills(
    state: State<'_, AppState>,
    skill_ids: Vec<String>,
) -> Result<ArchiveSkillsResult, String> {
    skill_archive::archive_skills(&state, skill_ids).await
}

#[tauri::command]
pub async fn restore_archived_skills(
    state: State<'_, AppState>,
    archive_ids: Vec<String>,
) -> Result<RestoreArchivedSkillsResult, String> {
    skill_archive::restore_archived_skills(&state, archive_ids).await
}

#[tauri::command]
pub fn list_skill_files(
    state: State<'_, AppState>,
    skill_id: String,
    parent_path: Option<String>,
) -> Result<Vec<SkillFileNode>, String> {
    let cache = state.skill_cache.read().map_err(|e| e.to_string())?;
    let skill = ManagedSkill::resolve(&cache, &skill_id, false).map_err(|e| e.to_string())?;
    SkillService::list_skill_file_children_at(&skill.root, parent_path.as_deref())
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
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    skill_id: String,
    agent: String,
    enabled: bool,
) -> Result<(), String> {
    let _agent_lease = state.acquire_local_lease().map_err(|e| e.to_string())?;
    let skill = SkillService::find_in_cache(&state.skill_cache, &skill_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Skill not found: {skill_id}"))?;
    if skill.origin == "plugin" {
        return Err(plugin_read_only_error(
            &skill.name,
            skill.plugin_source.as_deref(),
        ));
    }

    let home_path = skill
        .home_path
        .as_ref()
        .ok_or_else(|| "Skill has no physical home path, cannot toggle symlink".to_string())?;

    validate_skill_directory(&skill.directory)?;

    let needs_monitoring =
        enabled && config::get_agent_skills_dir(&agent).is_some_and(|p| !p.exists());
    SkillService::toggle_symlink(&skill.directory, home_path, &agent, enabled)
        .map_err(|e| e.to_string())?;

    if needs_monitoring {
        if let Err(error) = crate::services::watcher::restart_skill_watcher(&app, &state) {
            eprintln!("Failed to monitor recreated agent root: {error}");
        }
    }
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
pub fn batch_unlink_skills(
    state: State<'_, AppState>,
    skill_ids: Vec<String>,
    agent: String,
) -> Result<BatchUnlinkSkillsResult, String> {
    let _agent_lease = state.acquire_local_lease().map_err(|e| e.to_string())?;
    if config::get_agent_skills_dir(&agent).is_none() {
        return Err(format!("Unknown agent: {agent}"));
    }

    let mut unlinked = Vec::new();
    let mut skipped = Vec::new();
    let mut failed = Vec::new();
    let mut seen = HashSet::new();

    for skill_id in skill_ids {
        if !seen.insert(skill_id.clone()) {
            continue;
        }

        let skill = match SkillService::find_in_cache(&state.skill_cache, &skill_id) {
            Ok(Some(skill)) => skill,
            Ok(None) => {
                failed.push(BatchUnlinkSkillFailure {
                    skill_id,
                    error: "Skill not found".to_string(),
                });
                continue;
            }
            Err(error) => {
                failed.push(BatchUnlinkSkillFailure {
                    skill_id,
                    error: error.to_string(),
                });
                continue;
            }
        };

        if skill.home_agent.as_deref() == Some(agent.as_str())
            || !skill.apps.get(&agent).copied().unwrap_or(false)
        {
            skipped.push(skill_id);
            continue;
        }

        let Some(home_path) = skill.home_path.as_ref() else {
            failed.push(BatchUnlinkSkillFailure {
                skill_id,
                error: "Skill has no physical home path".to_string(),
            });
            continue;
        };

        if let Err(error) = validate_skill_directory(&skill.directory) {
            failed.push(BatchUnlinkSkillFailure { skill_id, error });
            continue;
        }

        match SkillService::toggle_symlink(&skill.directory, home_path, &agent, false) {
            Ok(()) => {
                let new_apps = SkillService::detect_agents(&skill.directory, &skill.home_path);
                if let Ok(mut cache) = state.skill_cache.write() {
                    if let Some(mut entry) = cache.find_by_id(&skill_id).cloned() {
                        entry.apps = new_apps;
                        cache.upsert(entry);
                        let _ = cache.save();
                    }
                }
                unlinked.push(skill_id);
            }
            Err(error) => failed.push(BatchUnlinkSkillFailure {
                skill_id,
                error: error.to_string(),
            }),
        }
    }

    Ok(BatchUnlinkSkillsResult {
        unlinked,
        skipped,
        failed,
    })
}

#[tauri::command]
pub async fn merge_duplicates_to_ssot(
    state: State<'_, AppState>,
    skill_name: String,
) -> Result<(), String> {
    SkillService::merge_duplicates(&state, &skill_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_skill_dir(app_handle: tauri::AppHandle, directory: String) -> Result<(), String> {
    validate_skill_directory(&directory)?;
    let dir = config::get_agents_skills_dir().join(&directory);
    if !dir.exists() {
        return Err(format!("Directory does not exist: {}", dir.display()));
    }
    open_directory(&app_handle, &dir)
}

fn skill_file_error(code: &'static str, message: impl Into<String>) -> CommandError {
    CommandError {
        code,
        message: message.into(),
        repo: None,
        authenticated: None,
        retry_at: None,
    }
}

#[tauri::command]
pub fn read_skill_text(
    state: State<'_, AppState>,
    skill_id: String,
    relative_path: String,
) -> Result<String, CommandError> {
    let cache = state
        .skill_cache
        .read()
        .map_err(|e| CommandError::generic(e.to_string()))?;
    let skill = ManagedSkill::resolve(&cache, &skill_id, false)
        .map_err(|e| CommandError::bad_request(e.to_string()))?;
    let p = skill
        .existing_path(&relative_path)
        .map_err(|e| CommandError::bad_request(e.to_string()))?;
    if !p.is_file() {
        return Err(CommandError::bad_request("Path is not a file"));
    }
    let bytes = std::fs::read(&p).map_err(|e| CommandError::generic(e.to_string()))?;
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

#[tauri::command]
pub fn read_skill_image(
    state: State<'_, AppState>,
    skill_id: String,
    relative_path: String,
) -> Result<String, CommandError> {
    let cache = state
        .skill_cache
        .read()
        .map_err(|e| CommandError::generic(e.to_string()))?;
    let skill = ManagedSkill::resolve(&cache, &skill_id, false)
        .map_err(|e| CommandError::bad_request(e.to_string()))?;
    let p = skill
        .existing_path(&relative_path)
        .map_err(|e| CommandError::bad_request(e.to_string()))?;
    if !p.is_file() {
        return Err(CommandError::bad_request("Path is not a file"));
    }
    let mime = image_mime_from_path(&p)
        .ok_or_else(|| skill_file_error("unsupportedImageFile", "Unsupported image file"))?;
    let metadata = std::fs::metadata(&p).map_err(|e| CommandError::generic(e.to_string()))?;
    if metadata.len() > MAX_IMAGE_PREVIEW_BYTES {
        return Err(skill_file_error("imageTooLarge", "Image file is too large"));
    }
    let bytes = std::fs::read(&p).map_err(|e| CommandError::generic(e.to_string()))?;
    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}

#[tauri::command]
pub fn write_skill_text(
    state: State<'_, AppState>,
    skill_id: String,
    relative_path: String,
    content: String,
) -> Result<(), String> {
    let skill = {
        let cache = state.skill_cache.read().map_err(|e| e.to_string())?;
        ManagedSkill::resolve(&cache, &skill_id, true).map_err(|e| e.to_string())?
    };
    let path = skill
        .writable_path(&relative_path)
        .map_err(|e| e.to_string())?;
    atomic_write(&path, content).map_err(|e| e.to_string())?;

    if skill.entry.origin == "ssot" {
        let _ = SkillLock::update(|lock| {
            if let Some(entry) = lock.skills.get_mut(&skill.entry.directory) {
                entry.updated_at = Some(chrono::Utc::now().to_rfc3339());
            }
            Ok::<(), AppError>(())
        });
    }
    let entry = scan_cached_skill_home(&skill.entry, &skill.root)?;
    SkillService::upsert_cache_entry(&state.skill_cache, entry).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn open_skill_path(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    skill_id: String,
    relative_path: Option<String>,
) -> Result<(), String> {
    let cache = state.skill_cache.read().map_err(|e| e.to_string())?;
    let skill = ManagedSkill::resolve(&cache, &skill_id, false).map_err(|e| e.to_string())?;
    let path = skill
        .existing_path(relative_path.as_deref().unwrap_or(""))
        .map_err(|e| e.to_string())?;
    if path.is_dir() {
        return open_directory(&app_handle, &path);
    }
    app_handle
        .opener()
        .open_path(path.to_string_lossy(), None::<&str>)
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
    open_directory(&app_handle, &dir)
}

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

async fn fetch_github_repo_metadata(owner: &str, name: &str) -> Result<DiscoverRepo, AppError> {
    let url = format!("https://api.github.com/repos/{owner}/{name}");
    let client = config::http_client();

    match crate::services::github::github_get(client, &url)
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
            Err(
                crate::services::github::response_error(&resp, &format!("{owner}/{name}"))
                    .unwrap_or_else(|| AppError::DownloadUnavailable(format!("{owner}/{name}"))),
            )
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

const REPO_METADATA_CACHE_TTL: u64 = 7 * 86400;

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

    match fetch_github_repo_metadata(&owner, &name).await {
        Ok(data) => {
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
                eprintln!("metadata fetch failed for {owner}/{name}, using stale cache: {e}");
                return Ok(data);
            }
            Err(CommandError::from(e))
        }
    }
}

const REPO_README_CACHE_TTL: u64 = 7 * 86400;

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

    let resp = crate::services::github::github_get(client, &url)
        .send()
        .await
        .map_err(|e| classify_download_error(format!("{owner}/{name}"), e))?;
    if let Some(error) = crate::services::github::response_error(&resp, &format!("{owner}/{name}"))
    {
        return Err(error);
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

    String::from_utf8(decoded).map_err(|e| AppError::Parse(format!("README not valid UTF-8: {e}")))
}

fn read_repo_readme_from_zip_path(zip_path: &Path) -> Result<String, ()> {
    let file = std::fs::File::open(zip_path).map_err(|_| ())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|_| ())?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|_| ())?;
        let Ok(name) = entry.name() else {
            continue;
        };
        if !is_root_readme_path(&name) {
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
    read_cached_repo_readme_from_zip_dir(&config::get_repo_zip_cache_dir(), owner, name, branch)
}

fn read_cached_repo_readme_from_zip_dir(
    cache_dir: &Path,
    owner: &str,
    name: &str,
    branch: Option<&str>,
) -> Result<String, ()> {
    let zip_path = cache_dir.join(CliService::cache_zip_file_name(owner, name, branch));
    if branch.is_some() {
        return read_repo_readme_from_zip_path(&zip_path);
    }
    if let Ok(content) = read_repo_readme_from_zip_path(&zip_path) {
        return Ok(content);
    }

    let prefix = format!("{owner}--{name}--branch--");
    let mut candidates: Vec<PathBuf> = std::fs::read_dir(cache_dir)
        .map_err(|_| ())?
        .filter_map(|entry| {
            let path = entry.ok()?.path();
            let file_name = path.file_name()?.to_str()?;
            if file_name.starts_with(&prefix) && file_name.ends_with(".zip") {
                Some(path)
            } else {
                None
            }
        })
        .collect();
    candidates.sort_by(|a, b| {
        let modified = |path: &PathBuf| {
            path.metadata()
                .and_then(|metadata| metadata.modified())
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
        };
        modified(b).cmp(&modified(a)).then_with(|| a.cmp(b))
    });

    for zip_path in candidates {
        if let Ok(content) = read_repo_readme_from_zip_path(&zip_path) {
            return Ok(content);
        }
    }

    Err(())
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
        github::validate_repo_segments(&owner, &name, "HEAD").map_err(CommandError::bad_request)?;
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
                eprintln!("README fetch failed for {owner}/{name}, using stale cache: {e}");
                return Ok(content);
            }

            match read_cached_repo_readme_from_zip(&owner, &name, branch.as_deref()) {
                Ok(content) => {
                    cache.insert(
                        key,
                        RepoReadmeCacheEntry {
                            content: content.clone(),
                            fetched_at: 0,
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

    let cancel_key = repo_load_cancel_key(&owner, &name, branch.as_deref());
    let (registration, handle) = state.repo_load_cancels.register(&cancel_key);
    let discovery = Abortable::new(
        SkillService::discover_from_repo_capped(
            &owner,
            &name,
            branch.as_deref(),
            1000,
            force,
            Some(&app),
        ),
        registration,
    );
    let discovered = match discovery.await {
        Ok(result) => result.map_err(CommandError::from),
        Err(_aborted) => Err(CommandError::cancelled()),
    };
    state.repo_load_cancels.finish(&cancel_key, &handle);
    let (mut skills, total) = discovered?;

    SkillService::rebuild_cache(
        &state.skill_cache,
        &state.metadata,
        &state.cache_refresh_lock,
    )
    .await
    .map_err(CommandError::from)?;

    let cache = visible_discover_conflict_cache(&state).map_err(CommandError::generic)?;
    let lock = SkillLock::read().map_err(CommandError::from)?;

    for skill in &mut skills {
        (skill.install_status, skill.installed_skill_id) =
            SkillService::classify_discoverable_skill(
                &cache,
                &lock,
                &skill.directory,
                &skill.key,
                &owner,
                &name,
                branch.as_deref(),
            );
    }

    Ok(RepoSkillsResult { skills, total })
}

fn repo_load_cancel_key(owner: &str, name: &str, branch: Option<&str>) -> String {
    format!("{owner}/{name}@{}", branch.unwrap_or("HEAD"))
}

#[tauri::command]
pub fn cancel_repo_skills(
    state: State<'_, AppState>,
    owner: String,
    name: String,
    branch: Option<String>,
) -> Result<(), CommandError> {
    if let Some(branch) = branch.as_deref() {
        github::validate_repo_segments(&owner, &name, branch).map_err(CommandError::bad_request)?;
    } else {
        github::validate_repo_segments(&owner, &name, "HEAD").map_err(CommandError::bad_request)?;
    }
    state
        .repo_load_cancels
        .cancel(&repo_load_cancel_key(&owner, &name, branch.as_deref()));
    Ok(())
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

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| CommandError::from(AppError::from(e)))?;
        let entry_name = match entry.name() {
            Ok(name) => name.trim_matches('/').to_string(),
            Err(_) => continue,
        };
        let mut parts = entry_name.split('/');
        let Some(_) = parts.next() else {
            continue;
        };
        if parts.next() != Some("SKILL.md") || parts.next().is_some() {
            continue;
        }

        let mut content = Vec::new();
        if std::io::Read::read_to_end(&mut entry, &mut content).is_err() {
            continue;
        }
        let Some(content) = valid_root_preview_content(content, &name) else {
            continue;
        };
        if skill_dir == "." {
            return Ok(content);
        }
        return Err(CommandError::from(AppError::NotFound(format!(
            "SKILL.md not found for skill: {skill_dir}"
        ))));
    }

    let needle = format!("/{}/SKILL.md", skill_dir);
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| CommandError::from(AppError::from(e)))?;
        let Ok(name) = entry.name() else {
            continue;
        };
        if name.ends_with(&needle) {
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

fn valid_root_preview_content(content: Vec<u8>, repo_name: &str) -> Option<String> {
    SkillService::normalized_repo_root_skill_name_bytes(&content, repo_name)?;
    String::from_utf8(content).ok()
}

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

fn parse_skills_sh_source(source: &str) -> Option<(&str, &str)> {
    let (owner, repo) = source.split_once('/')?;
    if owner.contains('.') || github::validate_repo_segments(owner, repo, "HEAD").is_err() {
        return None;
    }
    Some((owner, repo))
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

    let cache = visible_discover_conflict_cache(&state)?;
    let lock = SkillLock::read().map_err(|e| e.to_string())?;

    let mut skills = Vec::new();
    for s in api_result.skills {
        let Some((owner, repo)) = parse_skills_sh_source(&s.source) else {
            continue;
        };

        let directory = s.skill_id.clone();
        let (install_status, installed_skill_id) = SkillService::classify_discoverable_skill(
            &cache, &lock, &directory, &directory, owner, repo, None,
        );
        skills.push(DiscoverableSkill {
            key: s.id.clone(),
            name: s.name,
            frontmatter_name: None,
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

#[tauri::command]
pub fn set_skill_starred(
    state: State<'_, AppState>,
    skill_id: String,
    starred: bool,
) -> Result<(), String> {
    let _lease = state.acquire_local_lease().map_err(lease_command_error)?;
    let mut metadata = state.metadata.write().map_err(|e| e.to_string())?;
    metadata.set_starred(&skill_id, starred);
    metadata.save().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_skill_is_mine(
    state: State<'_, AppState>,
    skill_id: String,
    is_mine: bool,
) -> Result<(), String> {
    let _lease = state.acquire_local_lease().map_err(lease_command_error)?;
    let mut metadata = state.metadata.write().map_err(|e| e.to_string())?;
    metadata.set_is_mine(&skill_id, is_mine);
    metadata.save().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_skill(
    state: State<'_, AppState>,
    name: String,
    content: String,
) -> Result<InstalledSkill, String> {
    let _agent_lease = state.acquire_local_lease().map_err(|e| e.to_string())?;
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

    let entry = SkillService::scan_single_skill(&name).map_err(|e| e.to_string())?;
    let entry_id = entry.id.clone();
    SkillService::upsert_cache_entry(&state.skill_cache, entry).map_err(|e| e.to_string())?;

    {
        let mut metadata = state.metadata.write().map_err(|e| e.to_string())?;
        metadata.set_is_mine(&entry_id, true);
        metadata.save().map_err(|e| e.to_string())?;
    }

    let skills = SkillService::read_all_skills(&state.skill_cache, &state.metadata)
        .map_err(|e| e.to_string())?;
    skills
        .into_iter()
        .find(|s| s.id == entry_id)
        .ok_or_else(|| "Skill disappeared after creation".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::lock::{SkillLockEntry, SUPPORTED_LOCK_VERSION};
    fn test_lock_entry(source: &str, commit_sha: &str) -> SkillLockEntry {
        SkillLockEntry {
            extra: Default::default(),
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

    use std::io::Write;
    use zip::write::SimpleFileOptions;

    #[test]
    fn skills_sh_source_accepts_dotted_repository_names() {
        for (owner, repo) in [
            ("citypaul", ".dotfiles"),
            ("dmmulroy", ".dotfiles"),
            ("owner", "skills.v2"),
            ("owner", "skills"),
        ] {
            let source = format!("{owner}/{repo}");
            assert_eq!(parse_skills_sh_source(&source), Some((owner, repo)));
        }
    }

    #[test]
    fn skills_sh_source_rejects_domains_and_malformed_pairs() {
        for source in [
            "skills.volces.com/foo",
            "open.feishu.cn/wiki/id",
            "uizze.sh",
            "owner/",
            "/repo",
            "owner/repo/extra",
            "owner/repo?query",
            "owner/repo name",
        ] {
            assert_eq!(parse_skills_sh_source(source), None, "{source}");
        }
    }

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
    fn root_preview_requires_valid_root_skill_metadata() {
        let content = "---\nname: identity-skill\n---\n# Identity";

        assert!(SkillService::normalized_repo_root_skill_name(content, "repo").is_none());

        let valid = "---\nname: identity-skill\ndescription: Demo\n---\n# Identity";
        assert_eq!(
            SkillService::normalized_repo_root_skill_name(valid, "repo").as_deref(),
            Some("identity-skill")
        );
    }

    #[test]
    fn invalid_utf8_root_skill_metadata_is_not_treated_as_valid() {
        let content = b"---\nname: identity-skill\ndescription: Demo\n---\n\xff";

        assert!(SkillService::normalized_repo_root_skill_name_bytes(content, "repo").is_none());
        assert!(valid_root_preview_content(content.to_vec(), "repo").is_none());
    }

    #[test]
    fn ignores_nested_readme_in_cached_repo_zip() {
        let dir = write_test_zip(&[("repo-main/docs/README.md", "nested")]);

        let result = read_repo_readme_from_zip_path(&dir.path().join("repo.zip"));

        assert!(result.is_err());
    }

    #[test]
    fn reads_default_readme_from_cached_branch_zip_when_default_zip_is_missing() {
        let zip = write_test_zip(&[("repo-main/README.md", "# Branch README")]);
        let cache = tempfile::tempdir().unwrap();
        std::fs::copy(
            zip.path().join("repo.zip"),
            cache.path().join("owner--repo--branch--main.zip"),
        )
        .unwrap();

        let content =
            read_cached_repo_readme_from_zip_dir(cache.path(), "owner", "repo", None).unwrap();

        assert_eq!(content, "# Branch README");
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
    fn lease_command_error_uses_stable_code_in_string_commands() {
        let error: serde_json::Value =
            serde_json::from_str(&lease_command_error(AppError::OperationInProgress)).unwrap();
        assert_eq!(error["code"], "operationInProgress");
        assert!(error["repo"].is_null());
        assert_eq!(
            CommandError::from(AppError::OperationInProgress).code,
            "operationInProgress"
        );
    }

    #[test]
    fn install_preflight_uses_selected_agents_not_all_visible_agents() {
        let dirs = selected_agent_skill_dirs(&["codex".to_string()]);

        assert_eq!(dirs, vec![config::get_agent_skills_dir("codex").unwrap()]);
        assert!(!dirs.contains(&config::get_agent_skills_dir("hermes").unwrap()));
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
            extra: Default::default(),
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
                force: None,
            },
            CheckedSkillUpdate {
                skill_name: "local-skill".to_string(),
                current_sha: "old-local".to_string(),
                latest_sha: "new-local".to_string(),
                force: None,
            },
        ];

        let (entries, errors, _skipped) = checked_update_entries_from_lock(&cache, &lock, &checked);

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
            extra: Default::default(),
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
            force: None,
        }];

        let (entries, errors, skipped) = checked_update_entries_from_lock(&cache, &lock, &checked);

        assert!(errors.is_empty());
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "ssot-skill");
        assert_eq!(entries[0].latest_sha, "new-ssot");
        assert!(skipped.is_empty());
    }

    #[test]
    fn checked_update_skips_drifted_skills_unless_forced() {
        let tmp = tempfile::tempdir().unwrap();
        config::with_test_home(tmp.path(), || {
            let skill_dir = crate::config::get_agents_skills_dir().join("ssot-skill");
            std::fs::create_dir_all(&skill_dir).unwrap();
            std::fs::write(skill_dir.join("SKILL.md"), "# edited locally\n").unwrap();

            let cache = crate::persistence::SkillCache::from_entries(vec![test_cache_entry(
                "repo:owner/repo:ssot-skill",
                "ssot-skill",
                "ssot",
            )]);
            let mut entry = test_lock_entry("owner/repo", "old-ssot");
            entry.skill_folder_hash =
                Some("8293db63637957643abb559a59c1122ef387e21f61b60e8b0b3b2dfda73bae36".into());
            let mut lock = SkillLock {
                extra: Default::default(),
                version: SUPPORTED_LOCK_VERSION,
                skills: Default::default(),
                dismissed: serde_json::json!({}),
            };
            lock.skills.insert("ssot-skill".to_string(), entry);

            let make_checked = |force: Option<bool>| {
                vec![CheckedSkillUpdate {
                    skill_name: "ssot-skill".to_string(),
                    current_sha: "old-ssot".to_string(),
                    latest_sha: "new-ssot".to_string(),
                    force,
                }]
            };

            let (entries, errors, skipped) =
                checked_update_entries_from_lock(&cache, &lock, &make_checked(None));
            assert!(entries.is_empty());
            assert!(errors.is_empty());
            assert_eq!(skipped, vec!["ssot-skill".to_string()]);

            let (entries, errors, skipped) =
                checked_update_entries_from_lock(&cache, &lock, &make_checked(Some(true)));
            assert_eq!(entries.len(), 1);
            assert!(entries[0].force);
            assert!(errors.is_empty());
            assert!(skipped.is_empty());

            let mut lock = lock;
            lock.skills.get_mut("ssot-skill").unwrap().skill_folder_hash = Some(String::new());
            let (entries, errors, skipped) =
                checked_update_entries_from_lock(&cache, &lock, &make_checked(None));
            assert_eq!(entries.len(), 1);
            assert!(!entries[0].force);
            assert!(errors.is_empty());
            assert!(skipped.is_empty());
        });
    }

    #[test]
    fn update_result_error_count_matches_errors() {
        let result = update_result_with_error_count(crate::services::cli::UpdateResult {
            success_count: 0,
            fail_count: 0,
            errors: vec!["network failed".to_string()],
            updated: vec![],
            skipped_drifted: vec![],
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
                skipped_drifted: vec![],
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
    fn remove_cached_skill_from_disk_removes_selected_home_not_same_named_duplicate() {
        let root = tempfile::tempdir().expect("tempdir");
        let ssot_home = root.path().join(".agents").join("skills").join("demo");
        let agent_home = root.path().join(".codex").join("skills").join("demo");
        std::fs::create_dir_all(&ssot_home).expect("create ssot skill");
        std::fs::create_dir_all(&agent_home).expect("create agent skill");
        std::fs::write(ssot_home.join("SKILL.md"), "# Demo").expect("write ssot skill");
        std::fs::write(agent_home.join("SKILL.md"), "# Demo").expect("write agent skill");

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

    #[test]
    fn external_import_status_ignores_unmanaged_agent_conflicts() {
        let root = tempfile::tempdir().expect("tempdir");
        let source = root.path().join("demo");
        std::fs::create_dir_all(&source).expect("create source");
        std::fs::write(source.join("SKILL.md"), "# Demo").expect("write skill");
        let import = ExternalImportEntry {
            id: "external:demo".to_string(),
            source_path: source.to_string_lossy().to_string(),
            directory: "demo".to_string(),
            imported_at: 1,
            updated_at: 1,
        };

        assert!(matches!(
            external_import_status(&import),
            ExternalImportStatus::Valid
        ));
    }

    #[test]
    fn external_import_links_reject_ssot_store() {
        let root = tempfile::tempdir().expect("tempdir");
        let source = root.path().join("demo");
        std::fs::create_dir_all(&source).expect("create source");

        let err = ensure_external_import_link_available("demo", &source, "ssot")
            .expect_err("external imports must not link into the SSOT store");

        assert!(err.contains("Unknown agent: ssot"));
    }

    #[cfg(unix)]
    #[test]
    fn removes_historical_external_import_link_from_ssot_store() {
        let root = tempfile::tempdir().expect("tempdir");
        let store = root.path().join(".agents").join("skills");
        let source = root.path().join("external").join("demo");
        std::fs::create_dir_all(&store).expect("create store");
        std::fs::create_dir_all(&source).expect("create source");
        let link = store.join("demo");
        std::os::unix::fs::symlink(&source, &link).expect("create bad ssot link");

        let removed =
            remove_external_import_store_link_for_target("demo", &source, &store).expect("cleanup");

        assert_eq!(removed, 1);
        assert!(!link.exists());
        assert!(source.exists());
    }

    #[cfg(unix)]
    #[test]
    fn dangling_external_import_symlink_still_matches_raw_target() {
        let root = tempfile::tempdir().expect("tempdir");
        let link = root.path().join("demo-link");
        let missing_target = root.path().join("missing").join("demo");
        std::os::unix::fs::symlink(&missing_target, &link).expect("create dangling symlink");

        assert!(link_points_to_import_source(&link, &missing_target));
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
            plugin_source: None,
            apps: std::collections::HashMap::new(),
            installed_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn install_error_reports_every_incomplete_recovery_step() {
        let error = command_error_with_recovery(
            AppError::Cli("link creation failed".to_string()),
            vec![
                "remove skill directory: permission denied".to_string(),
                "update lock file: disk full".to_string(),
            ],
        );

        assert!(error.message.contains("link creation failed"));
        assert!(error
            .message
            .contains("remove skill directory: permission denied"));
        assert!(error.message.contains("update lock file: disk full"));
    }

    #[test]
    fn strip_verbatim_prefix_no_prefix_passthrough() {
        assert_eq!(
            strip_verbatim_prefix("/home/user/skills".into()),
            "/home/user/skills"
        );
        assert_eq!(
            strip_verbatim_prefix("C:\\Users\\demo".into()),
            "C:\\Users\\demo"
        );
    }

    #[test]
    fn strip_verbatim_prefix_local_verbatim() {
        assert_eq!(
            strip_verbatim_prefix("\\\\?\\C:\\Users\\demo\\.claude\\skills".into()),
            "C:\\Users\\demo\\.claude\\skills"
        );
    }

    #[test]
    fn strip_verbatim_prefix_unc_verbatim() {
        assert_eq!(
            strip_verbatim_prefix("\\\\?\\UNC\\server\\share\\skills\\demo".into()),
            "\\\\server\\share\\skills\\demo"
        );
    }
    #[test]
    fn external_import_failures_preserve_sources_and_registry() {
        for duplicate in [true, false] {
            let tmp = tempfile::tempdir().unwrap();
            config::with_test_home(tmp.path(), || {
                let source = tmp.path().join("private/demo");
                std::fs::create_dir_all(&source).unwrap();
                std::fs::write(source.join("SKILL.md"), "# private").unwrap();
                let root = config::get_agent_skills_dir("codex").unwrap();
                std::fs::create_dir_all(&root).unwrap();
                let state = AppState::new(
                    SkillCache::empty(),
                    crate::persistence::MetadataStore {
                        entries: Default::default(),
                    },
                    crate::persistence::Settings {
                        values: Default::default(),
                    },
                );
                let mut selections = vec![ExternalImportSelection {
                    source_path: source.to_string_lossy().into_owned(),
                    directory: "demo".into(),
                }];
                if duplicate {
                    selections.push(ExternalImportSelection {
                        source_path: source.to_string_lossy().into_owned(),
                        directory: "alias".into(),
                    });
                } else {
                    std::fs::create_dir_all(
                        config::get_app_config_dir().join("skills-cache.json.tmp"),
                    )
                    .unwrap();
                }
                let result = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .unwrap()
                    .block_on(import_external_skills_for_state(
                        &state,
                        selections,
                        vec!["codex".into()],
                    ));
                assert!(
                    result.is_err(),
                    "duplicate={duplicate}: operation must fail"
                );
                assert!(ExternalImports::load().unwrap().imports.is_empty());
                assert!(!is_symlink_or_junction(&root.join("demo")));
                assert!(!is_symlink_or_junction(&root.join("alias")));
                assert!(state.skill_cache.read().unwrap().skills().is_empty());
                assert_eq!(
                    std::fs::read_to_string(source.join("SKILL.md")).unwrap(),
                    "# private"
                );
            });
        }
    }
    #[test]
    fn external_import_commit_preserves_preexisting_links_on_failure() {
        for (fail_cache, old_directory, new_directory) in [
            (true, "demo", "demo"),
            (false, "demo", "demo"),
            (false, "a/demo", "b/demo"),
            (false, "old", "new"),
        ] {
            let tmp = tempfile::tempdir().unwrap();
            config::with_test_home(tmp.path(), || {
                let source = tmp.path().join("private/demo");
                std::fs::create_dir_all(&source).unwrap();
                std::fs::write(source.join("SKILL.md"), "# private").unwrap();
                let root = config::get_agent_skills_dir("codex").unwrap();
                std::fs::create_dir_all(&root).unwrap();
                SkillService::toggle_symlink(
                    old_directory,
                    &source.to_string_lossy(),
                    "codex",
                    true,
                )
                .unwrap();
                let mut previous = ExternalImports::default();
                previous.imports.insert(
                    "external:existing".into(),
                    ExternalImportEntry {
                        id: "external:existing".into(),
                        source_path: source.to_string_lossy().into_owned(),
                        directory: old_directory.into(),
                        imported_at: 1,
                        updated_at: 1,
                    },
                );
                previous.save().unwrap();
                let state = AppState::new(
                    SkillCache::empty(),
                    crate::persistence::MetadataStore {
                        entries: Default::default(),
                    },
                    crate::persistence::Settings {
                        values: Default::default(),
                    },
                );
                if fail_cache {
                    std::fs::create_dir_all(
                        config::get_app_config_dir().join("skills-cache.json.tmp"),
                    )
                    .unwrap();
                }
                let result = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .unwrap()
                    .block_on(import_external_skills_for_state(
                        &state,
                        vec![ExternalImportSelection {
                            source_path: source.to_string_lossy().into_owned(),
                            directory: new_directory.into(),
                        }],
                        vec!["codex".into()],
                    ));
                if fail_cache {
                    assert!(result.is_err());
                    assert_eq!(ExternalImports::load().unwrap(), previous);
                    assert!(state.skill_cache.read().unwrap().skills().is_empty());
                } else {
                    let skills = result.unwrap();
                    assert!(
                        skills
                            .iter()
                            .any(|skill| skill.id == "external:existing"
                                && skill.origin == "external")
                    );
                    assert_eq!(
                        ExternalImports::load().unwrap().imports["external:existing"].imported_at,
                        1
                    );
                }
                let active_directory = if fail_cache {
                    old_directory
                } else {
                    new_directory
                };
                assert!(link_points_to_import_source(
                    &root.join(SkillService::agent_link_name(active_directory)),
                    &source,
                ));
                if !fail_cache {
                    assert_eq!(
                        ExternalImports::load().unwrap().imports["external:existing"].directory,
                        new_directory
                    );
                    if SkillService::agent_link_name(old_directory)
                        != SkillService::agent_link_name(new_directory)
                    {
                        assert!(!is_symlink_or_junction(
                            &root.join(SkillService::agent_link_name(old_directory))
                        ));
                    }
                }
                assert_eq!(
                    std::fs::read_to_string(source.join("SKILL.md")).unwrap(),
                    "# private"
                );
            });
        }
    }
}

use crate::config;
use crate::config::{AgentConfig, AgentPathInfo};
use crate::persistence::atomic_write;
use crate::services::cli::CliService;
use crate::services::lock::SkillLock;
use crate::services::skill::{
    is_symlink_or_junction, DiscoverableSkill, InstalledSkill, RepoSkillsResult, SkillFileNode,
    SkillService, SymlinkStatus,
};
use crate::store::AppState;
use serde::Serialize;
use std::collections::HashSet;
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
}

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

fn is_under_skill_dir(p: &std::path::Path) -> bool {
    let agents_dir = config::get_agents_skills_dir();
    p.starts_with(&agents_dir)
        || config::AGENTS.iter().any(|agent| {
            config::get_agent_skills_dir(agent.id)
                .map(|d| p.starts_with(&d))
                .unwrap_or(false)
        })
}

static REPO_SEGMENT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-zA-Z0-9_.-]+$").unwrap());

fn validate_repo_segments(owner: &str, name: &str, branch: &str) -> Result<(), String> {
    let id_re = &REPO_SEGMENT_RE;
    if !id_re.is_match(owner) || !id_re.is_match(name) {
        return Err("Invalid owner or repository name format".into());
    }
    if branch.contains('\0') || branch.contains("..") || branch.len() > 255 {
        return Err("Invalid branch name format".into());
    }
    Ok(())
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
) -> Result<Vec<InstalledSkill>, String> {
    CliService::add_skills(
        &repo_url,
        &skill_names,
        &agents.first().cloned().unwrap_or_default(),
    )
    .await
    .map_err(|e| e.to_string())?;

    // Discover which skill directories were just installed in SSOT
    let ssot_dir = config::get_agents_skills_dir();
    let installed_dirs: Vec<String> = if let Ok(entries) = std::fs::read_dir(&ssot_dir) {
        entries
            .flatten()
            .filter(|e| e.path().is_dir() || is_symlink_or_junction(&e.path()))
            .filter_map(|e| {
                let name = e.file_name().to_str()?.to_string();
                let skill_md = e.path().join("SKILL.md");
                if skill_md.exists() {
                    let matches = skill_names.is_empty()
                        || skill_names
                            .iter()
                            .any(|s| s.to_lowercase() == name.to_lowercase());
                    if matches {
                        Some(name)
                    } else {
                        None
                    }
                } else {
                    None
                }
            })
            .collect()
    } else {
        Vec::new()
    };

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

    SkillService::read_all_skills(&state.skill_cache, &state.metadata).map_err(|e| e.to_string())
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
            .skills
            .is_empty();
        if !is_empty {
            return SkillService::read_all_skills(&state.skill_cache, &state.metadata)
                .map_err(|e| e.to_string());
        }
    }
    // Cache is empty (app just started) or force=true: rebuild from filesystem
    let mut skills =
        SkillService::rebuild_cache(&state.skill_cache, &state.metadata, &state.sync_in_progress)
            .await
            .map_err(|e| e.to_string())?;
    SkillService::fill_detect_agents(&mut skills);
    Ok(skills)
}

/// Best-effort refresh of commit SHA after update. Fails silently on error or rate-limit.
async fn refresh_commit_sha_for_skill_dir(skill_dir: &str) {
    let lock = match SkillLock::read() {
        Ok(l) => l,
        Err(_) => return,
    };
    let entry = match lock.skills.get(skill_dir).cloned() {
        Some(e) => e,
        None => return,
    };
    let (Some(owner), Some(name)) = entry.parse_source_owner_name() else {
        return;
    };
    let branch = entry.branch.unwrap_or_else(|| "main".to_string());
    if let Ok(Some(tree)) = CliService::fetch_repo_tree(&owner, &name, &branch).await {
        let skill_path = entry.skill_path.as_deref().unwrap_or("");
        if let Some(sha) = CliService::get_folder_sha_from_tree(&tree, skill_path) {
            let _ = SkillLock::update_commit_sha(skill_dir, &sha);
        }
    }
}

async fn refresh_commit_shas_after_update_all() {
    let lock = match SkillLock::read() {
        Ok(l) => l,
        Err(_) => return,
    };
    let mut seen: HashSet<(String, String, String)> = HashSet::new();
    for entry in lock.skills.values() {
        let (Some(owner), Some(name)) = entry.parse_source_owner_name() else {
            continue;
        };
        let branch = entry.branch.clone().unwrap_or_else(|| "main".to_string());
        let key = (owner.clone(), name.clone(), branch.clone());
        if !seen.insert(key) {
            continue;
        }
        if let Ok(Some(tree)) = CliService::fetch_repo_tree(&owner, &name, &branch).await {
            for (sn, e) in &lock.skills {
                let (Some(o), Some(n)) = e.parse_source_owner_name() else {
                    continue;
                };
                if o == owner && n == name {
                    let skill_path = e.skill_path.as_deref().unwrap_or("");
                    if let Some(sha) = CliService::get_folder_sha_from_tree(&tree, skill_path) {
                        let _ = SkillLock::update_commit_sha(sn, &sha);
                    }
                }
            }
        }
    }
}

#[tauri::command]
pub async fn update_skill(
    state: State<'_, AppState>,
    skill_id: String,
) -> Result<InstalledSkill, String> {
    let skill = SkillService::find_in_cache(&state.skill_cache, &skill_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Skill not found: {skill_id}"))?;

    let result = CliService::update_skills(Some(&skill.directory))
        .await
        .map_err(|e| e.to_string())?;

    if result.fail_count > 0 {
        return Err(result.errors.join("; "));
    }

    // Best-effort: refresh commit SHA so next check doesn't show false positive
    refresh_commit_sha_for_skill_dir(&skill.directory).await;

    let entry = SkillService::scan_single_skill(&skill.directory).map_err(|e| e.to_string())?;
    SkillService::upsert_cache_entry(&state.skill_cache, entry).map_err(|e| e.to_string())?;

    let skills = SkillService::read_all_skills(&state.skill_cache, &state.metadata)
        .map_err(|e| e.to_string())?;
    skills
        .into_iter()
        .find(|s| s.id == skill_id)
        .ok_or_else(|| "Skill disappeared after update".to_string())
}

#[tauri::command]
pub async fn update_all_skills(state: State<'_, AppState>) -> Result<UpdateAllResult, String> {
    let update_result = CliService::update_skills(None).await.unwrap_or_else(|e| {
        eprintln!("Update all skills error: {e}");
        crate::services::cli::UpdateResult {
            success_count: 0,
            fail_count: 0,
            errors: vec![e.to_string()],
        }
    });

    // Best-effort: refresh commit SHAs
    refresh_commit_shas_after_update_all().await;

    let dirs: Vec<String> = {
        let cache = state.skill_cache.read().map_err(|e| e.to_string())?;
        cache.skills.iter().map(|s| s.directory.clone()).collect()
    };
    let (entries, _failed) = SkillService::scan_skills_batch(&dirs);
    for entry in entries {
        let _ = SkillService::upsert_cache_entry(&state.skill_cache, entry);
    }

    let skills = SkillService::read_all_skills(&state.skill_cache, &state.metadata)
        .map_err(|e| e.to_string())?;

    Ok(UpdateAllResult {
        skills,
        success_count: update_result.success_count,
        fail_count: update_result.fail_count,
        errors: update_result.errors,
    })
}

#[tauri::command]
pub async fn remove_skill(state: State<'_, AppState>, skill_id: String) -> Result<(), String> {
    let skill = SkillService::find_in_cache(&state.skill_cache, &skill_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Skill not found: {skill_id}"))?;

    CliService::remove_skill(&skill.directory)
        .await
        .map_err(|e| e.to_string())?;

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
            Ok(None) => continue,
            Err(e) => {
                failed.push(RemoveSkillFailure {
                    skill_id: skill_id.clone(),
                    error: e.to_string(),
                });
                continue;
            }
        };

        if let Err(e) = CliService::remove_skill(&skill.directory).await {
            failed.push(RemoveSkillFailure {
                skill_id: skill_id.clone(),
                error: e.to_string(),
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
pub fn read_skill_md(directory: String) -> Result<String, String> {
    validate_skill_directory(&directory)?;

    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    candidates.push(
        config::get_agents_skills_dir()
            .join(&directory)
            .join("SKILL.md"),
    );
    for agent in config::AGENTS {
        if let Some(agent_dir) = config::get_agent_skills_dir(agent.id) {
            candidates.push(agent_dir.join(&directory).join("SKILL.md"));
        }
    }

    for skill_md in &candidates {
        if skill_md.exists() {
            return std::fs::read_to_string(skill_md).map_err(|e| e.to_string());
        }
    }

    Err(format!("SKILL.md not found for: {directory}"))
}

#[tauri::command]
pub fn write_skill_md(
    state: State<'_, AppState>,
    directory: String,
    content: String,
) -> Result<(), String> {
    validate_skill_directory(&directory)?;

    let agents_dir = config::get_agents_skills_dir();
    let skill_md = agents_dir.join(&directory).join("SKILL.md");

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
    let entry = SkillService::scan_single_skill(&directory).map_err(|e| e.to_string())?;
    SkillService::upsert_cache_entry(&state.skill_cache, entry).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn list_skill_files(directory: String) -> Result<Vec<SkillFileNode>, String> {
    validate_skill_directory(&directory)?;
    SkillService::list_skill_files(&directory).map_err(|e| e.to_string())
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
        .map_err(|e| e.to_string())
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

/// Read a text file at an absolute skill path (UTF-8 only).
/// Returns Err("BINARY_FILE") for non-UTF-8 files.
#[tauri::command]
pub fn read_skill_file_path(path: String) -> Result<String, String> {
    if path.is_empty() || path.contains('\0') {
        return Err("Invalid path".into());
    }
    let p = std::path::Path::new(&path);
    if !p.is_absolute() {
        return Err("Path must be absolute".into());
    }
    if !is_under_skill_dir(p) {
        return Err("Path is not under a known skill directory".into());
    }
    if !p.is_file() {
        return Err(format!("Not a file: {}", p.display()));
    }
    let bytes = std::fs::read(p).map_err(|e| e.to_string())?;
    String::from_utf8(bytes).map_err(|_| "BINARY_FILE".to_string())
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
    let agents_dir = config::get_agents_skills_dir();
    if !is_under_skill_dir(p) {
        return Err("Path is not under a known skill directory".into());
    }
    atomic_write(p, content).map_err(|e| e.to_string())?;

    // Derive skill directory name from the path so we can update the lock + cache.
    // The skill dir is the first component after the known skill root.
    let skill_dir: Option<String> = {
        let mut candidate = None;
        if let Ok(rel) = p.strip_prefix(&agents_dir) {
            candidate = rel.components().next().and_then(|c| {
                if let std::path::Component::Normal(s) = c {
                    s.to_str().map(|s| s.to_string())
                } else {
                    None
                }
            });
        }
        if candidate.is_none() {
            for agent in config::AGENTS {
                if let Some(agent_dir) = config::get_agent_skills_dir(agent.id) {
                    if let Ok(rel) = p.strip_prefix(&agent_dir) {
                        candidate = rel.components().next().and_then(|c| {
                            if let std::path::Component::Normal(s) = c {
                                s.to_str().map(|s| s.to_string())
                            } else {
                                None
                            }
                        });
                        if candidate.is_some() {
                            break;
                        }
                    }
                }
            }
        }
        candidate
    };

    if let Some(dir) = skill_dir {
        // Update lock file timestamp
        if let Ok(mut lock) = crate::services::lock::SkillLock::read() {
            if let Some(entry) = lock.skills.get_mut(&dir) {
                entry.updated_at = Some(chrono::Utc::now().to_rfc3339());
                let _ = lock.write();
            }
        }
        // Refresh cache so updatedAt is reflected in the frontend
        if let Ok(entry) = SkillService::scan_single_skill(&dir) {
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
    if !is_under_skill_dir(p) {
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
    pub branch: String,
    pub description: Option<String>,
    pub stars: Option<i32>,
    pub forks: Option<i32>,
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
            branch: e.branch,
            description: Some(e.description),
            stars: None,
            forks: None,
        })
        .collect())
}

async fn fetch_github_repo_metadata(owner: &str, name: &str) -> DiscoverRepo {
    let url = format!("https://api.github.com/repos/{owner}/{name}");
    let client = config::http_client();

    match client.get(&url).send().await {
        Ok(resp) if resp.status().is_success() => match resp.json::<serde_json::Value>().await {
            Ok(json) => DiscoverRepo {
                owner: owner.to_string(),
                name: name.to_string(),
                branch: json
                    .get("default_branch")
                    .and_then(|v| v.as_str())
                    .unwrap_or("main")
                    .to_string(),
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
            },
            Err(_) => DiscoverRepo::simple(owner, name),
        },
        Ok(_) => DiscoverRepo::simple(owner, name),
        Err(_) => DiscoverRepo::simple(owner, name),
    }
}

impl DiscoverRepo {
    fn simple(owner: &str, name: &str) -> Self {
        Self {
            owner: owner.to_string(),
            name: name.to_string(),
            branch: "main".to_string(),
            description: None,
            stars: None,
            forks: None,
        }
    }
}

fn parse_repo_query(query: &str) -> Result<(String, String, String), String> {
    let query = query.trim();

    if query.starts_with("http://") || query.starts_with("https://") {
        let url = url::Url::parse(query).map_err(|e| format!("Invalid URL: {e}"))?;
        match url.host_str() {
            Some("github.com") => {}
            Some(host) => return Err(format!("Expected github.com URL, got host: {host}")),
            None => return Err("Invalid GitHub URL: no host".into()),
        }
        let segments: Vec<&str> = url
            .path_segments()
            .ok_or("Invalid GitHub URL: no path segments")?
            .collect();

        if segments.len() < 2 {
            return Err("GitHub URL must include owner/name".into());
        }

        let owner = segments[0].to_string();
        let name = segments[1].trim_end_matches(".git").to_string();
        let branch = if segments.len() >= 4 && segments[2] == "tree" {
            segments[3].to_string()
        } else {
            "main".to_string()
        };

        validate_repo_segments(&owner, &name, &branch)?;
        Ok((owner, name, branch))
    } else {
        let parts: Vec<&str> = query.splitn(2, '/').collect();
        if parts.len() != 2 {
            return Err("Query must be in 'owner/name' format or a GitHub URL".into());
        }
        let owner = parts[0].to_string();
        let name = parts[1].trim_end_matches(".git").to_string();
        validate_repo_segments(&owner, &name, "main")?;
        Ok((owner, name, "main".to_string()))
    }
}

#[tauri::command]
pub fn search_repo(query: String) -> Result<DiscoverRepo, String> {
    let (owner, name, branch) = parse_repo_query(&query)?;
    Ok(DiscoverRepo {
        owner,
        name,
        branch,
        description: None,
        stars: None,
        forks: None,
    })
}

#[tauri::command]
pub async fn get_repo_metadata(owner: String, name: String) -> Result<DiscoverRepo, String> {
    validate_repo_segments(&owner, &name, "main")?;
    Ok(fetch_github_repo_metadata(&owner, &name).await)
}

#[tauri::command]
pub async fn get_repo_skills(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    owner: String,
    name: String,
    branch: Option<String>,
    force: Option<bool>,
) -> Result<RepoSkillsResult, String> {
    let branch = branch.unwrap_or_else(|| "main".to_string());
    validate_repo_segments(&owner, &name, &branch)?;
    let force = force.unwrap_or(false);

    let (mut skills, total) =
        SkillService::discover_from_repo_capped(&owner, &name, &branch, 800, force, Some(&app))
            .await
            .map_err(|e| e.to_string())?;

    let cache = state.skill_cache.read().map_err(|e| e.to_string())?;
    let installed_dirs: std::collections::HashSet<String> =
        cache.skills.iter().map(|s| s.directory.clone()).collect();

    for skill in &mut skills {
        skill.installed = installed_dirs.contains(&skill.directory);
    }

    Ok(RepoSkillsResult { skills, total })
}

#[tauri::command]
pub async fn preview_skill_md(
    owner: String,
    name: String,
    branch: Option<String>,
    skill_dir: String,
) -> Result<String, String> {
    let branch = branch.unwrap_or_else(|| "main".to_string());
    validate_repo_segments(&owner, &name, &branch)?;
    validate_skill_directory(&skill_dir)?;

    let zip_path = CliService::ensure_cached_zip(&owner, &name, &branch, false)
        .await
        .map_err(|e| e.to_string())?;

    let file = std::fs::File::open(&zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    let needle = format!("/{}/SKILL.md", &skill_dir);
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.name().ends_with(&needle) {
            let mut content = String::new();
            std::io::Read::read_to_string(&mut entry, &mut content).map_err(|e| e.to_string())?;
            return Ok(content);
        }
    }

    Err(format!("SKILL.md not found for skill: {skill_dir}"))
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
        .map_err(|e| format!("skills.sh request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("skills.sh returned status {}", resp.status()));
    }

    let api_result: SkillsShApiResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse skills.sh response: {e}"))?;

    // Build installed set from cache
    let cache = state.skill_cache.read().map_err(|e| e.to_string())?;
    let installed_dirs: std::collections::HashSet<String> =
        cache.skills.iter().map(|s| s.directory.clone()).collect();

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
        skills.push(DiscoverableSkill {
            key: s.id.clone(),
            name: s.name,
            description: None,
            directory,
            repo_owner: owner.to_string(),
            repo_name: repo.to_string(),
            installed: installed_dirs.contains(&s.skill_id),
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
        .map_err(|e| format!("Audit request failed: {e}"))?;

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

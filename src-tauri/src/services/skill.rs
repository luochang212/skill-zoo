use crate::config;
use crate::error::{self, AppError};
use crate::persistence::metadata::SkillMetadata;
use crate::persistence::{
    ExternalImportEntry, ExternalImports, MetadataStore, Settings, SkillCache, SkillCacheEntry,
};
use crate::services::cli::CliService;
use crate::services::lock::{SkillLock, SkillLockEntry};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use tauri::Emitter;

fn commit_cache_entries(
    cache: &mut SkillCache,
    entries: Vec<SkillCacheEntry>,
    persist: impl FnOnce(&SkillCache) -> Result<(), AppError>,
) -> Result<(), AppError> {
    let previous = cache.clone();
    for entry in entries {
        cache.upsert(entry);
    }
    if let Err(error) = persist(cache) {
        *cache = previous;
        return Err(error);
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledSkill {
    pub id: String,
    pub name: String,
    pub yaml_name: Option<String>,
    pub description: Option<String>,
    pub directory: String,
    pub repo_owner: Option<String>,
    pub repo_name: Option<String>,
    pub source_url: Option<String>,
    pub apps: HashMap<String, bool>,
    pub origin: String,
    pub home_path: Option<String>,
    pub content_hash: Option<String>,
    pub home_agent: Option<String>,
    pub starred: bool,
    pub is_mine: bool,
    pub installed_at: i64,
    pub updated_at: i64,
}

pub(crate) struct StagedAgentSymlinkRemoval {
    moved_links: Vec<(PathBuf, PathBuf)>,
    staging_dirs: Vec<tempfile::TempDir>,
}

impl StagedAgentSymlinkRemoval {
    pub(crate) fn rollback(self) -> Result<(), AppError> {
        let mut errors = Vec::new();
        for (original, staged) in self.moved_links.iter().rev() {
            if std::fs::symlink_metadata(staged).is_err() {
                if std::fs::symlink_metadata(original).is_err() {
                    errors.push(format!(
                        "cannot restore {} because its staged backup is missing",
                        original.display()
                    ));
                }
                continue;
            }
            if std::fs::symlink_metadata(original).is_ok() {
                errors.push(format!(
                    "cannot restore {} because the destination now exists",
                    original.display()
                ));
                continue;
            }
            if let Err(error) = std::fs::rename(staged, original) {
                errors.push(format!(
                    "restore {} from {}: {error}",
                    original.display(),
                    staged.display()
                ));
            }
        }

        if errors.is_empty() {
            return Ok(());
        }

        let retained = self
            .staging_dirs
            .into_iter()
            .map(|dir| dir.keep().display().to_string())
            .collect::<Vec<_>>();
        Err(AppError::Cli(format!(
            "Failed to restore agent links: {}. Backups retained at: {}",
            errors.join("; "),
            retained.join(", ")
        )))
    }

    pub(crate) fn commit(self) {
        for dir in self.staging_dirs {
            let path = dir.path().to_path_buf();
            if let Err(error) = dir.close() {
                eprintln!(
                    "Failed to remove staged agent links at {}: {error}",
                    path.display()
                );
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverableSkill {
    pub key: String,
    pub name: String,
    pub description: Option<String>,
    pub directory: String,
    pub repo_owner: String,
    pub repo_name: String,
    pub install_status: DiscoverableSkillInstallStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_skill_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installs: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DiscoverableSkillInstallStatus {
    Available,
    Installed,
    Conflict,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSkillsResult {
    pub skills: Vec<DiscoverableSkill>,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SymlinkStatus {
    pub skill_id: String,
    pub skill_name: String,
    pub agent: String,
    pub symlink_path: String,
    pub target_path: String,
    pub exists: bool,
    pub is_valid: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillFileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_skill_md: bool,
    pub children: Option<Vec<SkillFileNode>>,
}

pub struct ManagedSkill {
    pub entry: SkillCacheEntry,
    pub root: PathBuf,
}

impl ManagedSkill {
    pub fn resolve(cache: &SkillCache, skill_id: &str, writable: bool) -> Result<Self, AppError> {
        let entry = cache
            .find_by_id(skill_id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("Skill not found: {skill_id}")))?;
        if writable && entry.origin == "external" {
            return Err(AppError::BadRequest(
                "External imported skills are read-only in Skill Zoo.".into(),
            ));
        }
        let home = PathBuf::from(
            entry
                .home_path
                .as_ref()
                .ok_or_else(|| AppError::BadRequest("Skill has no physical home path".into()))?,
        );
        let root = home.canonicalize().map_err(|e| error::io(&home, e))?;
        if !root.is_dir() {
            return Err(AppError::BadRequest(
                "Skill home path is not a directory".into(),
            ));
        }
        Ok(Self { entry, root })
    }

    fn relative_path(relative: &str) -> Result<&Path, AppError> {
        let path = Path::new(relative);
        if relative.contains('\0')
            || relative.contains('\\')
            || path.is_absolute()
            || path
                .components()
                .any(|part| !matches!(part, std::path::Component::Normal(_)))
        {
            return Err(AppError::BadRequest("Invalid relative skill path".into()));
        }
        Ok(path)
    }

    pub fn existing_path(&self, relative: &str) -> Result<PathBuf, AppError> {
        if relative.is_empty() {
            return Ok(self.root.clone());
        }
        let path = self.root.join(Self::relative_path(relative)?);
        let real = path.canonicalize().map_err(|e| error::io(&path, e))?;
        if real != self.root && !real.starts_with(&self.root) {
            return Err(AppError::BadRequest(
                "Path escapes the requested skill directory".into(),
            ));
        }
        Ok(real)
    }

    pub fn writable_path(&self, relative: &str) -> Result<PathBuf, AppError> {
        let relative = Self::relative_path(relative)?;
        let path = self.root.join(relative);
        let parent = path
            .parent()
            .ok_or_else(|| AppError::BadRequest("Invalid relative skill path".into()))?;
        let real_parent = parent.canonicalize().map_err(|e| error::io(parent, e))?;
        if real_parent != self.root && !real_parent.starts_with(&self.root) {
            return Err(AppError::BadRequest(
                "Path escapes the requested skill directory".into(),
            ));
        }
        if path.exists() {
            let real = path.canonicalize().map_err(|e| error::io(&path, e))?;
            if real != self.root && !real.starts_with(&self.root) {
                return Err(AppError::BadRequest(
                    "Path escapes the requested skill directory".into(),
                ));
            }
        }
        Ok(path)
    }
}

impl From<SkillCacheEntry> for InstalledSkill {
    fn from(e: SkillCacheEntry) -> Self {
        InstalledSkill {
            id: e.id,
            name: e.name,
            yaml_name: e.yaml_name,
            description: e.description,
            directory: e.directory,
            repo_owner: e.repo_owner,
            repo_name: e.repo_name,
            source_url: e.source_url,
            apps: e.apps,
            origin: e.origin,
            home_path: e.home_path,
            content_hash: e.content_hash,
            home_agent: e.home_agent,
            starred: false, // set by get_cached_skills from metadata
            is_mine: false, // set by get_cached_skills from metadata
            installed_at: e.installed_at,
            updated_at: e.updated_at,
        }
    }
}

/// Check whether `path` is a symlink (Unix/macOS) or a junction/symlink (Windows).
///
/// Rust's `Path::is_symlink()` only matches `IO_REPARSE_TAG_SYMLINK`. On Windows we
/// create junction points (reparse tag `IO_REPARSE_TAG_MOUNT_POINT`) because they do
/// not require admin privileges or Developer Mode. This function returns `true` for
/// both, so all link-handling code treats junctions identically.
///
/// Uses `junction::exists()` on Windows to check specifically for junction reparse
/// points — not all reparse points (e.g. OneDrive placeholders, DFS links).
#[inline]
pub fn is_symlink_or_junction(path: &std::path::Path) -> bool {
    if path.is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        junction::exists(path).unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// Compare two paths by canonicalizing both. Returns false if either fails.
fn canonical_paths_eq(a: &std::path::Path, b: &std::path::Path) -> bool {
    a.canonicalize()
        .ok()
        .zip(b.canonicalize().ok())
        .is_some_and(|(a, b)| a == b)
}

/// Check whether a symlink/junction at `link_path` resolves to `expected_target`.
///
/// Resolves relative targets against the symlink's parent directory. Falls back
/// to canonicalized path comparison when `read_link` fails (Windows junctions).
fn resolve_link_target(
    link_path: &std::path::Path,
    target: std::path::PathBuf,
) -> std::path::PathBuf {
    if target.is_relative() {
        link_path
            .parent()
            .unwrap_or(std::path::Path::new("."))
            .join(&target)
    } else {
        target
    }
}

pub(crate) fn symlink_target_matches(
    link_path: &std::path::Path,
    expected_target: &std::path::Path,
) -> bool {
    match std::fs::read_link(link_path) {
        Ok(target) => canonical_paths_eq(&resolve_link_target(link_path, target), expected_target),
        Err(_) => canonical_paths_eq(link_path, expected_target),
    }
}

pub(crate) fn raw_symlink_target_matches(
    link_path: &std::path::Path,
    expected_target: &std::path::Path,
) -> bool {
    let Ok(target) = std::fs::read_link(link_path) else {
        return false;
    };
    resolve_link_target(link_path, target) == expected_target
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LinkTargetState {
    Matches,
    Different,
    Unknown,
}

fn symlink_target_state(
    link_path: &std::path::Path,
    expected_target: &std::path::Path,
) -> LinkTargetState {
    match std::fs::read_link(link_path) {
        Ok(target) => {
            let resolved = resolve_link_target(link_path, target);
            if canonical_paths_eq(&resolved, expected_target) {
                LinkTargetState::Matches
            } else if resolved.exists() || expected_target.exists() {
                LinkTargetState::Different
            } else {
                LinkTargetState::Unknown
            }
        }
        Err(_) => {
            if canonical_paths_eq(link_path, expected_target) {
                LinkTargetState::Matches
            } else {
                LinkTargetState::Unknown
            }
        }
    }
}

fn external_source_under_known_skill_root(source_path: &Path) -> bool {
    let Ok(source_path) = source_path.canonicalize() else {
        return false;
    };
    std::iter::once(config::get_agents_skills_dir())
        .chain(
            config::AGENTS
                .iter()
                .filter_map(|agent| config::get_agent_skills_dir(agent.id)),
        )
        .filter_map(|root| root.canonicalize().ok())
        .any(|root| source_path == root || source_path.starts_with(root))
}

pub struct SkillService;

impl SkillService {
    pub(crate) fn agent_link_name(skill_dir: &str) -> &str {
        std::path::Path::new(skill_dir)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(skill_dir)
    }

    fn duplicates_have_verified_matching_content(entries: &[SkillCacheEntry]) -> bool {
        let Some(first_hash) = entries
            .first()
            .and_then(|entry| entry.content_hash.as_deref())
        else {
            return false;
        };
        entries
            .iter()
            .all(|entry| entry.content_hash.as_deref() == Some(first_hash))
    }

    #[cfg(feature = "test-helpers")]
    pub fn duplicates_have_verified_matching_content_for_test(entries: &[SkillCacheEntry]) -> bool {
        Self::duplicates_have_verified_matching_content(entries)
    }

    /// Check which agents can access this skill:
    /// - If the skill's homePath is under an agent directory (origin=agent),
    ///   that agent is marked as available directly.
    /// - For all other agents, only a symlink pointing to this skill's
    ///   homePath counts — a same-named real directory is a separate skill.
    pub fn detect_agents(skill_dir: &str, home_path: &Option<String>) -> HashMap<String, bool> {
        let mut enabled = HashMap::new();
        let home = home_path.as_ref().map(std::path::Path::new);
        for agent in config::AGENTS {
            if let Some(agent_dir) = config::get_agent_skills_dir(agent.id) {
                // If homePath is directly under this agent dir, it's natively available
                if let Some(h) = home {
                    if h.starts_with(&agent_dir) {
                        enabled.insert(agent.id.to_string(), true);
                        continue;
                    }
                }
                // Otherwise, only count if there's a symlink pointing to homePath
                let symlink_path = agent_dir.join(Self::agent_link_name(skill_dir));
                if is_symlink_or_junction(&symlink_path) {
                    let matched = home.is_some_and(|h| symlink_target_matches(&symlink_path, h));
                    enabled.insert(agent.id.to_string(), matched);
                } else {
                    enabled.insert(agent.id.to_string(), false);
                }
            }
        }
        enabled
    }

    /// Determine which agent a scan root directory belongs to.
    /// Returns None for the SSOT directory.
    fn detect_agent_for_path(scan_root: &PathBuf) -> Option<&'static str> {
        for agent in config::AGENTS {
            if let Some(agent_dir) = config::get_agent_skills_dir(agent.id) {
                if scan_root == &agent_dir {
                    return Some(agent.id);
                }
            }
        }
        None
    }

    /// Determine origin of a skill based on where it exists on disk
    fn detect_origin(skill_dir: &str) -> &'static str {
        let agents_dir = config::get_agents_skills_dir();
        let ssot_path = agents_dir.join(skill_dir);
        if ssot_path.is_dir() && !is_symlink_or_junction(&ssot_path) {
            "ssot"
        } else {
            "agent"
        }
    }

    /// Determine the physical (non-symlink) home path of a skill.
    fn detect_home_path(skill_dir: &str, origin: &str) -> Option<String> {
        let agents_dir = config::get_agents_skills_dir();
        if origin == "ssot" {
            let ssot_path = agents_dir.join(skill_dir);
            if ssot_path.is_dir() && !is_symlink_or_junction(&ssot_path) {
                return Some(crate::persistence::normalize_path_separators(
                    ssot_path.to_str()?,
                ));
            }
        }
        for agent in config::AGENTS {
            if let Some(agent_dir) = config::get_agent_skills_dir(agent.id) {
                let path = agent_dir.join(skill_dir);
                if path.exists() && !is_symlink_or_junction(&path) {
                    return Some(crate::persistence::normalize_path_separators(
                        path.to_str()?,
                    ));
                }
            }
        }
        let ssot_path = agents_dir.join(skill_dir);
        if ssot_path.exists() {
            return Some(crate::persistence::normalize_path_separators(
                ssot_path.to_str()?,
            ));
        }
        None
    }

    /// Determine which agent a skill's home_path belongs to.
    fn detect_home_agent(home_path: &Option<String>, origin: &str) -> Option<String> {
        if origin == "ssot" {
            return None;
        }
        let hp = std::path::Path::new(home_path.as_deref()?);
        for agent in config::AGENTS {
            if let Some(agent_dir) = config::get_agent_skills_dir(agent.id) {
                if hp.starts_with(&agent_dir) {
                    return Some(agent.id.to_string());
                }
            }
        }
        None
    }

    /// Construct the canonical skill ID string used across cache and duplicate detection.
    /// Must match the logic in `scan_single_skill`.
    fn make_skill_id(
        origin: &str,
        dir: &str,
        repo_owner: &Option<String>,
        repo_name: &Option<String>,
        agent_id: Option<&str>,
    ) -> String {
        if origin == "ssot" {
            match (repo_owner.as_deref(), repo_name.as_deref()) {
                (Some(owner), Some(repo)) => format!("repo:{owner}/{repo}:{dir}"),
                _ => format!("ssot:{dir}"),
            }
        } else {
            format!(
                "agent:{aid}:{dir}",
                aid = agent_id.expect("non-ssot skill must have an agent_id")
            )
        }
    }

    /// Compute a SHA-256 hash of all files in the skill directory.
    fn compute_content_hash(home_path: &str) -> Option<String> {
        use sha2::{Digest, Sha256};
        let root = std::path::Path::new(home_path);
        if !root.is_dir() {
            return None;
        }
        let mut files: Vec<std::path::PathBuf> = Vec::new();
        Self::collect_files_recursive(root, root, &mut files);
        if files.is_empty() {
            return None;
        }
        files.sort();
        let mut hasher = Sha256::new();
        for rel_path in &files {
            hasher.update(rel_path.to_str()?);
            hasher.update(b"\0");
            let full_path = root.join(rel_path);
            match std::fs::read(&full_path) {
                Ok(content) => {
                    hasher.update(&content);
                }
                Err(_) => continue,
            }
            hasher.update(b"\0");
        }
        let result = hasher.finalize();
        Some(result.iter().map(|b| format!("{:02x}", b)).collect())
    }

    fn collect_files_recursive(
        dir: &std::path::Path,
        root: &std::path::Path,
        files: &mut Vec<std::path::PathBuf>,
    ) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if is_symlink_or_junction(&path) {
                if path.is_file() {
                    if let Ok(rel) = path.strip_prefix(root) {
                        files.push(rel.to_path_buf());
                    }
                }
            } else if path.is_dir() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if crate::config::SKIP_DIRS.contains(&name) {
                        continue;
                    }
                }
                Self::collect_files_recursive(&path, root, files);
            } else if path.is_file() {
                if let Ok(rel) = path.strip_prefix(root) {
                    files.push(rel.to_path_buf());
                }
            }
        }
    }

    // ──────────────────────────────────────────────
    //  Read path: return cached skills
    // ──────────────────────────────────────────────

    /// Return installed skills from the JSON cache with metadata merged.
    /// Does not perform filesystem I/O.
    pub fn get_cached_skills(
        cache: &SkillCache,
        metadata: &MetadataStore,
    ) -> Result<Vec<InstalledSkill>, AppError> {
        let mut skills = Vec::with_capacity(cache.skills().len());
        for entry in cache.skills() {
            let mut skill: InstalledSkill = entry.clone().into();
            let meta = metadata.get(&entry.id);
            skill.starred = meta.starred;
            skill.is_mine = meta.is_mine;
            skills.push(skill);
        }
        Ok(skills)
    }

    /// Read cache + metadata, merge into InstalledSkill list.
    pub fn read_all_skills(
        skill_cache: &RwLock<SkillCache>,
        metadata: &RwLock<MetadataStore>,
    ) -> Result<Vec<InstalledSkill>, AppError> {
        Ok({
            let cache = skill_cache
                .read()
                .map_err(|e: std::sync::PoisonError<_>| AppError::Cli(e.to_string()))?;
            let meta = metadata
                .read()
                .map_err(|e: std::sync::PoisonError<_>| AppError::Cli(e.to_string()))?;
            Self::get_cached_skills(&cache, &meta)?
        })
    }

    // ──────────────────────────────────────────────
    //  Write path: rebuild cache from filesystem truth
    // ──────────────────────────────────────────────

    /// Rebuild the skill cache from filesystem + CLI + lock file.
    /// Returns skills with metadata merged.
    pub async fn rebuild_cache(
        cache: &RwLock<SkillCache>,
        metadata: &RwLock<MetadataStore>,
        refresh_lock: &tokio::sync::Mutex<()>,
    ) -> Result<Vec<InstalledSkill>, AppError> {
        let _refresh_guard = refresh_lock.lock().await;

        // Run the heavy filesystem scan on the blocking thread pool so
        // the async runtime stays free to handle incoming Tauri commands.
        let entries = tokio::task::spawn_blocking(move || {
            let mut entries: Vec<SkillCacheEntry> = Vec::new();
            Self::scan_filesystem_into(&mut entries);
            Self::scan_external_imports_into(&mut entries);
            entries
        })
        .await
        .map_err(|e| AppError::Parse(format!("Cache rebuild panicked: {e}")))?;

        let mut new_cache = cache
            .write()
            .map_err(|e| AppError::Parse(format!("Cache lock: {e}")))?;

        new_cache.replace_all(entries);
        new_cache.save()?;

        let m = metadata
            .read()
            .map_err(|e| AppError::Parse(format!("Metadata lock: {e}")))?;
        Self::get_cached_skills(&new_cache, &m)
    }

    /// Scan newly installed SSOT skills and commit them to the cache as one
    /// serialized update. This prevents an overlapping full rebuild from
    /// replacing fresh entries with an older filesystem snapshot.
    pub async fn refresh_installed_skills(
        cache: &RwLock<SkillCache>,
        metadata: &RwLock<MetadataStore>,
        refresh_lock: &tokio::sync::Mutex<()>,
        skill_dirs: Vec<String>,
    ) -> Result<Vec<InstalledSkill>, AppError> {
        let _refresh_guard = refresh_lock.lock().await;
        let (entries, failed) =
            tokio::task::spawn_blocking(move || Self::scan_skills_batch(&skill_dirs))
                .await
                .map_err(|e| AppError::Parse(format!("Installed skill scan panicked: {e}")))?;

        if !failed.is_empty() {
            return Err(AppError::Parse(format!(
                "Failed to scan installed skills: {}",
                failed.join(", ")
            )));
        }

        let mut current = cache
            .write()
            .map_err(|e| AppError::Parse(format!("Cache lock: {e}")))?;
        commit_cache_entries(&mut current, entries, SkillCache::save)?;
        drop(current);

        Self::read_all_skills(cache, metadata)
    }

    /// Scan filesystem for skill directories and push into entries.
    fn scan_filesystem_into(entries: &mut Vec<SkillCacheEntry>) {
        let mut scan_dirs: Vec<PathBuf> = Vec::new();
        let agents_dir = config::get_agents_skills_dir();
        if agents_dir.exists() {
            scan_dirs.push(agents_dir);
        }
        for agent in config::AGENTS {
            if let Some(agent_dir) = config::get_agent_skills_dir(agent.id) {
                if agent_dir.exists() {
                    scan_dirs.push(agent_dir);
                }
            }
        }
        if scan_dirs.is_empty() {
            return;
        }

        let imports = ExternalImports::load().ok();
        let imports_by_source: HashMap<PathBuf, &ExternalImportEntry> = imports
            .as_ref()
            .map(|i| {
                i.imports
                    .values()
                    .filter_map(|entry| {
                        PathBuf::from(&entry.source_path)
                            .canonicalize()
                            .ok()
                            .map(|p| (p, entry))
                    })
                    .collect()
            })
            .unwrap_or_default();

        let mut seen_ids: HashSet<String> = HashSet::new();
        for scan_dir in &scan_dirs {
            Self::scan_dir_recursive_into(
                scan_dir,
                entries,
                &mut seen_ids,
                scan_dir,
                &imports_by_source,
            );
        }
    }

    fn scan_external_imports_into(entries: &mut Vec<SkillCacheEntry>) {
        let Ok(imports) = ExternalImports::load() else {
            return;
        };
        let mut seen_ids: HashSet<String> = entries.iter().map(|entry| entry.id.clone()).collect();
        for import in imports.imports.values() {
            if external_source_under_known_skill_root(Path::new(&import.source_path)) {
                continue;
            }
            let Ok(entry) = Self::scan_external_import(import) else {
                continue;
            };
            if seen_ids.insert(entry.id.clone()) {
                entries.push(entry);
            }
        }
    }

    /// Resolve timestamps for a skill cache entry.
    ///
    /// Priority:
    /// 1. Lock file timestamps (RFC3339 strings → unix seconds) — for GitHub-installed skills
    /// 2. Filesystem metadata (created/modified time) — for local skills without lock entries
    /// 3. Fallback to `now`
    fn resolve_timestamps(
        lock_entry: Option<&SkillLockEntry>,
        skill_home_path: &str,
        now: i64,
    ) -> (i64, i64) {
        let parse_rfc3339 = |s: &str| -> Option<i64> {
            chrono::DateTime::parse_from_rfc3339(s)
                .ok()
                .map(|dt| dt.timestamp())
        };

        // Try lock file timestamps first
        if let Some(entry) = lock_entry {
            let installed_at = entry
                .installed_at
                .as_deref()
                .and_then(parse_rfc3339)
                .unwrap_or(now);
            let updated_at = entry
                .updated_at
                .as_deref()
                .and_then(parse_rfc3339)
                .unwrap_or(now);
            return (installed_at, updated_at);
        }

        // No lock entry — fall back to filesystem metadata
        let fs_installed = std::fs::metadata(skill_home_path)
            .ok()
            .and_then(|m| m.created().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64);

        let fs_updated = std::fs::metadata(skill_home_path)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64);

        let installed_at = fs_installed.unwrap_or(now);
        let updated_at = fs_updated.unwrap_or(now);

        (installed_at, updated_at)
    }

    fn scan_dir_recursive_into(
        dir: &PathBuf,
        entries: &mut Vec<SkillCacheEntry>,
        seen_ids: &mut HashSet<String>,
        scan_root: &PathBuf,
        imports_by_source: &HashMap<PathBuf, &ExternalImportEntry>,
    ) {
        let Ok(dir_entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in dir_entries.flatten() {
            let path = entry.path();
            if is_symlink_or_junction(&path) {
                // Clean up broken symlinks/junctions whose target no longer exists.
                if !path.exists() {
                    let _ = Self::safe_remove(&path);
                    continue;
                }
                // If the symlink target is an external import source, scan it
                // here with origin = "external". Otherwise it's a symlink to
                // SSOT which is already scanned from the SSOT root — skip it.
                if let Ok(target) = path.canonicalize() {
                    if let Some(import) = imports_by_source.get(&target) {
                        if let Ok(ext_entry) = Self::scan_external_import(import) {
                            if seen_ids.insert(ext_entry.id.clone()) {
                                entries.push(ext_entry);
                            }
                        }
                    }
                }
                continue;
            }
            if !path.is_dir() {
                continue;
            }
            let dir_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown");
            if crate::config::SKIP_DIRS.contains(&dir_name) {
                continue;
            }
            if path.join("SKILL.md").exists() {
                let is_ssot = config::get_agents_skills_dir() == *scan_root;
                let agent_id = if is_ssot {
                    None
                } else {
                    Some(
                        Self::detect_agent_for_path(scan_root)
                            .expect("scan_root should be SSOT or a known agent directory"),
                    )
                };
                let Ok(entry) = Self::scan_skill_root(&path, scan_root, agent_id) else {
                    continue;
                };
                if !seen_ids.insert(entry.id.clone()) {
                    continue; // Already seen this ID, skip
                }
                entries.push(entry);
            } else {
                Self::scan_dir_recursive_into(
                    &path,
                    entries,
                    seen_ids,
                    scan_root,
                    imports_by_source,
                );
            }
        }
    }

    pub fn parse_skill_md(path: &std::path::Path) -> Result<(String, Option<String>), AppError> {
        let content = std::fs::read_to_string(path).map_err(|e| error::io(path, e))?;
        let fallback_name = path
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();
        Ok(Self::parse_skill_md_content(&content, &fallback_name))
    }

    pub(crate) fn parse_skill_md_content(
        content: &str,
        fallback_name: &str,
    ) -> (String, Option<String>) {
        let mut name = fallback_name.to_string();
        let mut description: Option<String> = None;
        if let Some(frontmatter) = Self::extract_frontmatter(content) {
            if let Ok(meta) = serde_yaml::from_str::<serde_yaml::Value>(&frontmatter) {
                if let Some(n) = meta.get("name") {
                    let n_str = Self::yaml_value_to_string(n);
                    name = n_str;
                }
                if let Some(d) = meta.get("description") {
                    description = Some(Self::yaml_value_to_string(d));
                }
            }
        }
        (name, description)
    }

    pub fn extract_frontmatter(content: &str) -> Option<String> {
        let content = content.trim();
        if content.starts_with("---") {
            let parts: Vec<&str> = content.splitn(3, "---").collect();
            if parts.len() >= 3 {
                return Some(parts[1].trim().to_string());
            }
        }
        None
    }

    const MAX_SCAN_DEPTH: usize = 20;

    /// Convert a YAML value to a string, handling numbers, booleans, and null.
    fn yaml_value_to_string(v: &serde_yaml::Value) -> String {
        if let Some(s) = v.as_str() {
            return s.to_string();
        }
        if let Some(i) = v.as_i64() {
            return i.to_string();
        }
        if let Some(f) = v.as_f64() {
            return f.to_string();
        }
        if let Some(b) = v.as_bool() {
            return b.to_string();
        }
        String::new()
    }

    fn is_safe_skill_directory_name(name: &str) -> bool {
        let windows_stem = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
        let windows_reserved = matches!(windows_stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || (windows_stem.len() == 4
                && (windows_stem.starts_with("COM") || windows_stem.starts_with("LPT"))
                && windows_stem
                    .chars()
                    .last()
                    .is_some_and(|c| matches!(c, '1'..='9')));
        !name.is_empty()
            && name.len() <= 255
            && !name.ends_with('.')
            && !windows_reserved
            && name
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_alphanumeric())
            && name
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    }

    pub(crate) fn safe_skill_name_or_fallback(name: &str, fallback: &str) -> String {
        if Self::is_safe_skill_directory_name(name) {
            name.to_string()
        } else if Self::is_safe_skill_directory_name(fallback) {
            fallback.to_string()
        } else {
            let trimmed = fallback.trim_matches(['.', '-']);
            let prefixed = format!("skill-{trimmed}");
            if Self::is_safe_skill_directory_name(&prefixed) {
                prefixed
            } else {
                "repo-skill".to_string()
            }
        }
    }

    pub(crate) fn normalized_repo_root_skill_name(
        content: &str,
        repo_name: &str,
    ) -> Option<String> {
        let frontmatter = Self::extract_frontmatter(content)?;
        let meta = serde_yaml::from_str::<serde_yaml::Value>(&frontmatter).ok()?;
        let name = meta.get("name")?.as_str()?.trim();
        let description = meta.get("description")?.as_str()?.trim();
        if name.is_empty() || description.is_empty() {
            return None;
        }
        Some(Self::safe_skill_name_or_fallback(name, repo_name))
    }

    pub(crate) fn has_valid_repo_root_skill(skill_md: &Path) -> bool {
        std::fs::read_to_string(skill_md)
            .ok()
            .and_then(|content| Self::normalized_repo_root_skill_name(&content, "repo-skill"))
            .is_some()
    }

    pub(crate) fn normalize_extracted_repo_root(
        root_dir: &Path,
        repo_name: &str,
    ) -> Result<PathBuf, AppError> {
        let Some(fallback_name) = root_dir.file_name().and_then(|n| n.to_str()) else {
            return Ok(root_dir.to_path_buf());
        };
        let skill_md = root_dir.join("SKILL.md");
        if !skill_md.is_file() {
            return Ok(root_dir.to_path_buf());
        }

        let Ok(content) = std::fs::read_to_string(&skill_md) else {
            return Ok(root_dir.to_path_buf());
        };
        let Some(normalized_name) = Self::normalized_repo_root_skill_name(&content, repo_name)
        else {
            return Ok(root_dir.to_path_buf());
        };
        if normalized_name == fallback_name {
            return Ok(root_dir.to_path_buf());
        }

        let Some(parent) = root_dir.parent() else {
            return Ok(root_dir.to_path_buf());
        };
        let normalized_root = parent.join(normalized_name);
        if std::fs::symlink_metadata(&normalized_root).is_ok() {
            return Err(AppError::Cli(format!(
                "Cannot normalize repository root because {} already exists",
                normalized_root.display()
            )));
        }

        std::fs::rename(root_dir, &normalized_root).map_err(AppError::Io)?;
        Ok(normalized_root)
    }

    pub async fn discover_from_repo(
        owner: &str,
        name: &str,
        branch: Option<&str>,
        force: bool,
        app_handle: Option<&tauri::AppHandle>,
    ) -> Result<Vec<DiscoverableSkill>, AppError> {
        let result: Result<Vec<DiscoverableSkill>, AppError> = async {
            let _ = app_handle.map(|h| {
                h.emit(
                    "repo-load-stage",
                    serde_json::json!({
                        "owner": owner, "repo": name, "stage": "downloading"
                    }),
                )
            });

            let zip_path =
                CliService::ensure_cached_zip_with_progress(owner, name, branch, force, app_handle)
                    .await?;

            let _ = app_handle.map(|h| {
                h.emit(
                    "repo-load-stage",
                    serde_json::json!({
                        "owner": owner, "repo": name, "stage": "extracting"
                    }),
                )
            });

            let file = std::fs::File::open(&zip_path)?;
            if let Ok(metadata) = file.metadata() {
                if metadata.len() > config::MAX_DOWNLOAD_BYTES {
                    return Err(AppError::BadRequest(format!(
                        "Repository ZIP exceeds {}MB limit",
                        config::MAX_DOWNLOAD_BYTES / (1024 * 1024)
                    )));
                }
            }

            let mut archive = zip::ZipArchive::new(file)?;
            let temp_dir = tempfile::tempdir()?;
            archive.extract(temp_dir.path())?;

            let _ = app_handle.map(|h| {
                h.emit(
                    "repo-load-stage",
                    serde_json::json!({
                        "owner": owner, "repo": name, "stage": "scanning"
                    }),
                )
            });

            let mut skills = Vec::new();
            let root_dir = std::fs::read_dir(temp_dir.path())?
                .flatten()
                .find(|e| e.path().is_dir())
                .map(|e| e.path());
            let Some(root_dir) = root_dir else {
                return Ok(skills);
            };
            let root_dir = Self::normalize_extracted_repo_root(&root_dir, name)?;
            Self::scan_for_skills(&root_dir, &root_dir, owner, name, 0, &mut skills)?;
            Ok(skills)
        }
        .await;

        // Notify frontend that loading is done, regardless of success or failure
        let _ = app_handle.map(|h| {
            h.emit(
                "repo-load-done",
                serde_json::json!({ "owner": owner, "repo": name }),
            )
        });

        result
    }

    fn scan_for_skills(
        dir: &PathBuf,
        base_path: &PathBuf,
        owner: &str,
        repo: &str,
        depth: usize,
        skills: &mut Vec<DiscoverableSkill>,
    ) -> Result<(), AppError> {
        if !dir.is_dir() || depth > Self::MAX_SCAN_DEPTH {
            return Ok(());
        }
        let skill_md = dir.join("SKILL.md");
        let is_repo_root = depth == 0 && dir == base_path;
        let valid_root_skill = is_repo_root && Self::has_valid_repo_root_skill(&skill_md);
        if skill_md.exists() && (!is_repo_root || valid_root_skill) {
            let dir_name = dir
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown");
            let (_, description) =
                Self::parse_skill_md(&skill_md).unwrap_or((dir_name.to_string(), None));
            let rel = dir.strip_prefix(base_path).unwrap_or(dir);
            // Normalize OS-native separators to forward slashes so the key is
            // identical on Windows/macOS/Linux. Without this, `to_string_lossy`
            // on Windows produces backslashes (e.g. "skills\self-learning"),
            // which then fail to match against forward-slash-locked paths in
            // `CliService::lock_skill_path`.
            let key = if rel.as_os_str().is_empty() {
                ".".to_string()
            } else {
                rel.to_string_lossy().replace('\\', "/")
            };
            skills.push(DiscoverableSkill {
                key,
                name: dir_name.to_string(),
                description,
                directory: dir_name.to_string(),
                repo_owner: owner.to_string(),
                repo_name: repo.to_string(),
                install_status: DiscoverableSkillInstallStatus::Available,
                installed_skill_id: None,
                installs: None,
            });
            if valid_root_skill {
                return Ok(());
            }
        }
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                    if crate::config::SKIP_DIRS.contains(&file_name) {
                        continue;
                    }
                    Self::scan_for_skills(&path, base_path, owner, repo, depth + 1, skills)?;
                }
            }
        }
        Ok(())
    }

    pub async fn discover_from_repo_capped(
        owner: &str,
        name: &str,
        branch: Option<&str>,
        max_skills: usize,
        force: bool,
        app_handle: Option<&tauri::AppHandle>,
    ) -> Result<(Vec<DiscoverableSkill>, usize), AppError> {
        let mut skills = Self::discover_from_repo(owner, name, branch, force, app_handle).await?;
        let total = skills.len();
        skills.truncate(max_skills);
        Ok((skills, total))
    }

    // ──────────────────────────────────────────────
    //  User data: starred / is_mine  (moved to MetadataStore)
    // ──────────────────────────────────────────────

    /// Find a skill by id in the cache (read-only).
    pub fn find_in_cache(
        cache: &RwLock<SkillCache>,
        skill_id: &str,
    ) -> Result<Option<SkillCacheEntry>, AppError> {
        let c = cache
            .read()
            .map_err(|e| AppError::Parse(format!("Cache lock: {e}")))?;
        Ok(c.find_by_id(skill_id).cloned())
    }

    pub fn classify_discoverable_skill(
        cache: &SkillCache,
        lock: &SkillLock,
        install_directory: &str,
        repo_skill_path: &str,
        repo_owner: &str,
        repo_name: &str,
        branch: Option<&str>,
    ) -> (DiscoverableSkillInstallStatus, Option<String>) {
        let mut matches: Vec<&SkillCacheEntry> = cache
            .skills()
            .iter()
            .filter(|entry| entry.directory == install_directory && entry.origin != "external")
            .collect();

        if matches.is_empty() && repo_skill_path == "." {
            matches = cache
                .skills()
                .iter()
                .filter(|entry| {
                    entry.origin == "ssot"
                        && entry
                            .repo_owner
                            .as_deref()
                            .is_some_and(|owner| owner.eq_ignore_ascii_case(repo_owner))
                        && entry
                            .repo_name
                            .as_deref()
                            .is_some_and(|name| name.eq_ignore_ascii_case(repo_name))
                        && lock
                            .skills
                            .get(&entry.directory)
                            .and_then(|lock_entry| lock_entry.skill_path.as_deref())
                            .map(Self::normalize_repo_skill_path)
                            .is_some_and(|path| path.is_empty())
                })
                .collect();
        }

        if matches.is_empty() {
            return (DiscoverableSkillInstallStatus::Available, None);
        }
        if matches.len() != 1 {
            return (DiscoverableSkillInstallStatus::Conflict, None);
        }

        let installed = matches[0];
        let lock_entry = lock
            .skills
            .get(&installed.directory)
            .or_else(|| lock.skills.get(install_directory));
        let same_repo = installed.origin == "ssot"
            && installed
                .repo_owner
                .as_deref()
                .is_some_and(|owner| owner.eq_ignore_ascii_case(repo_owner))
            && installed
                .repo_name
                .as_deref()
                .is_some_and(|name| name.eq_ignore_ascii_case(repo_name));
        let same_branch = branch.is_none_or(|expected| {
            lock_entry.and_then(|entry| entry.branch.as_deref()) == Some(expected)
        });
        let same_path = repo_skill_path == install_directory
            || lock_entry
                .and_then(|entry| entry.skill_path.as_deref())
                .map(Self::normalize_repo_skill_path)
                .as_deref()
                == Some(Self::normalize_repo_skill_path(repo_skill_path).as_str());

        if same_repo && same_branch && same_path {
            (
                DiscoverableSkillInstallStatus::Installed,
                Some(installed.id.clone()),
            )
        } else {
            (DiscoverableSkillInstallStatus::Conflict, None)
        }
    }

    fn normalize_repo_skill_path(path: &str) -> String {
        let normalized = path.replace('\\', "/");
        let normalized = normalized
            .strip_suffix("/SKILL.md")
            .unwrap_or(&normalized)
            .trim_matches('/')
            .to_string();
        if normalized == "." {
            String::new()
        } else {
            normalized
        }
    }

    /// Scan a single skill directory and return a cache entry for it.
    /// Used for incremental cache updates after install/update.
    /// Looks in SSOT first, then agent directories, to handle both origins.
    pub fn scan_single_skill(skill_dir: &str) -> Result<SkillCacheEntry, AppError> {
        let origin = Self::detect_origin(skill_dir);
        let home_path = Self::detect_home_path(skill_dir, origin);

        let skill_md = home_path
            .as_ref()
            .map(|p| std::path::PathBuf::from(p).join("SKILL.md"))
            .unwrap_or_else(|| {
                config::get_agents_skills_dir()
                    .join(skill_dir)
                    .join("SKILL.md")
            });

        if !skill_md.exists() {
            return Err(AppError::NotFound(format!(
                "SKILL.md not found for skill: {skill_dir}"
            )));
        }

        let lock_data: Option<SkillLock> = SkillLock::read().ok();
        let lock_entry = lock_data
            .as_ref()
            .and_then(|lock| lock.skills.get(skill_dir));

        let (repo_owner, repo_name, source_url) = lock_entry
            .map(|e| e.to_repo_info())
            .unwrap_or((None, None, None));

        let (parsed_name, description) =
            Self::parse_skill_md(&skill_md).unwrap_or((skill_dir.to_string(), None));
        // Use Path::file_name for platform-agnostic leaf extraction
        // (backslashes on Windows would defeat a simple rsplit on '/').
        let name = std::path::Path::new(skill_dir)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(skill_dir)
            .to_string();
        let yaml_name = if parsed_name == name {
            None
        } else {
            Some(parsed_name)
        };

        let content_hash = home_path
            .as_ref()
            .and_then(|p| Self::compute_content_hash(p));
        let home_agent = Self::detect_home_agent(&home_path, origin);
        let now = chrono::Utc::now().timestamp();
        let (installed_at, updated_at) =
            Self::resolve_timestamps(lock_entry, home_path.as_deref().unwrap_or(skill_dir), now);
        let id = Self::make_skill_id(
            origin,
            skill_dir,
            &repo_owner,
            &repo_name,
            home_agent.as_deref(),
        );
        let apps = Self::detect_agents(skill_dir, &home_path);

        Ok(SkillCacheEntry {
            id,
            name,
            yaml_name,
            description,
            directory: skill_dir.to_string(),
            repo_owner,
            repo_name,
            source_url,
            origin: origin.to_string(),
            home_path,
            content_hash,
            home_agent,
            apps,
            installed_at,
            updated_at,
        })
    }

    /// Scan concrete skill roots without guessing by directory name.
    ///
    /// Used by the filesystem watcher for incremental refresh. Each tuple is
    /// `(skill_root, scan_root, agent_id)`, where `agent_id=None` means SSOT.
    pub fn scan_skill_roots_batch(
        skill_roots: &[(PathBuf, PathBuf, Option<String>)],
    ) -> Result<Vec<SkillCacheEntry>, AppError> {
        let mut entries = Vec::with_capacity(skill_roots.len());
        for (skill_root, scan_root, agent_id) in skill_roots {
            entries.push(Self::scan_skill_root(
                skill_root,
                scan_root,
                agent_id.as_deref(),
            )?);
        }
        Ok(entries)
    }

    pub fn scan_external_import(import: &ExternalImportEntry) -> Result<SkillCacheEntry, AppError> {
        let skill_root = PathBuf::from(&import.source_path);
        if external_source_under_known_skill_root(&skill_root) {
            return Err(AppError::BadRequest(
                "External import source is inside a Skill Zoo-managed skill directory.".to_string(),
            ));
        }
        let skill_md = skill_root.join("SKILL.md");
        if !skill_md.exists() {
            return Err(AppError::NotFound(format!(
                "SKILL.md not found for external import: {}",
                skill_root.display()
            )));
        }

        let dir_name = skill_root
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| {
                AppError::Parse(format!(
                    "Invalid external skill root: {}",
                    skill_root.display()
                ))
            })?;
        let (parsed_name, description) =
            Self::parse_skill_md(&skill_md).unwrap_or((dir_name.to_string(), None));
        let yaml_name = if parsed_name == dir_name {
            None
        } else {
            Some(parsed_name)
        };
        let home_path = Some(import.source_path.clone());
        let content_hash = Self::compute_content_hash(&import.source_path);
        let apps = Self::detect_agents(&import.directory, &home_path);

        Ok(SkillCacheEntry {
            id: import.id.clone(),
            name: dir_name.to_string(),
            yaml_name,
            description,
            directory: import.directory.clone(),
            repo_owner: None,
            repo_name: None,
            source_url: None,
            origin: "external".to_string(),
            home_path,
            content_hash,
            home_agent: None,
            apps,
            installed_at: import.imported_at,
            updated_at: import.updated_at,
        })
    }

    pub fn scan_skill_root(
        skill_root: &Path,
        scan_root: &Path,
        agent_id: Option<&str>,
    ) -> Result<SkillCacheEntry, AppError> {
        let skill_md = skill_root.join("SKILL.md");
        if !skill_md.exists() {
            return Err(AppError::NotFound(format!(
                "SKILL.md not found for skill root: {}",
                skill_root.display()
            )));
        }

        let dir_name = skill_root
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| {
                AppError::Parse(format!("Invalid skill root: {}", skill_root.display()))
            })?;
        let relative_dir = skill_root
            .strip_prefix(scan_root)
            .unwrap_or(skill_root)
            .to_str()
            .ok_or_else(|| {
                AppError::Parse(format!("Invalid skill path: {}", skill_root.display()))
            })?
            .to_string();
        // Normalize to forward slashes for cross-platform consistency.
        let relative_dir = relative_dir.replace('\\', "/");

        let lock_data: Option<SkillLock> = SkillLock::read().ok();
        let lock_entry = lock_data.as_ref().and_then(|lock| {
            lock.skills
                .get(&relative_dir)
                .or_else(|| lock.skills.get(dir_name))
        });

        let (repo_owner, repo_name, source_url) = lock_entry
            .map(|e| e.to_repo_info())
            .unwrap_or((None, None, None));

        let (parsed_name, description) =
            Self::parse_skill_md(&skill_md).unwrap_or((dir_name.to_string(), None));
        let yaml_name = if parsed_name == dir_name {
            None
        } else {
            Some(parsed_name)
        };

        let origin = if agent_id.is_some() { "agent" } else { "ssot" };
        let id = Self::make_skill_id(origin, &relative_dir, &repo_owner, &repo_name, agent_id);
        let home_path = skill_root
            .to_str()
            .map(crate::persistence::normalize_path_separators);
        let content_hash = home_path
            .as_ref()
            .and_then(|p| Self::compute_content_hash(p));
        let home_agent = if origin == "agent" {
            agent_id
                .map(str::to_string)
                .or_else(|| Self::detect_home_agent(&home_path, origin))
        } else {
            None
        };
        let apps = Self::detect_agents(&relative_dir, &home_path);
        let now = chrono::Utc::now().timestamp();
        let (installed_at, updated_at) = Self::resolve_timestamps(
            lock_entry,
            home_path.as_deref().unwrap_or(&relative_dir),
            now,
        );

        Ok(SkillCacheEntry {
            id,
            name: dir_name.to_string(),
            yaml_name,
            description,
            directory: relative_dir,
            repo_owner,
            repo_name,
            source_url,
            origin: origin.to_string(),
            home_path,
            content_hash,
            home_agent,
            apps,
            installed_at,
            updated_at,
        })
    }

    #[cfg(feature = "test-helpers")]
    pub fn scan_skill_root_for_test(
        skill_root: &Path,
        scan_root: &Path,
        agent_id: Option<&str>,
    ) -> Result<SkillCacheEntry, AppError> {
        Self::scan_skill_root(skill_root, scan_root, agent_id)
    }

    /// Insert or replace a cache entry and persist.
    pub fn upsert_cache_entry(
        cache: &RwLock<SkillCache>,
        entry: SkillCacheEntry,
    ) -> Result<(), AppError> {
        let mut c = cache
            .write()
            .map_err(|e| AppError::Parse(format!("Cache lock: {e}")))?;
        c.upsert(entry);
        c.save()
    }

    /// Remove a cache entry by skill_id and persist.
    pub fn remove_cache_entry(cache: &RwLock<SkillCache>, skill_id: &str) -> Result<(), AppError> {
        let mut c = cache
            .write()
            .map_err(|e| AppError::Parse(format!("Cache lock: {e}")))?;
        c.remove(skill_id);
        c.save()
    }

    /// Returns (entries, failed_dirs) — caller decides how to handle failures.
    pub fn scan_skills_batch(skill_dirs: &[String]) -> (Vec<SkillCacheEntry>, Vec<String>) {
        let mut entries = Vec::with_capacity(skill_dirs.len());
        let mut failed = Vec::new();
        for dir in skill_dirs {
            match Self::scan_single_skill(dir) {
                Ok(entry) => entries.push(entry),
                Err(_) => failed.push(dir.clone()),
            }
        }
        (entries, failed)
    }

    // ──────────────────────────────────────────────
    //  Visible agents / settings
    // ──────────────────────────────────────────────

    pub fn get_visible_agents(settings: &Settings) -> HashMap<String, bool> {
        let mut map: HashMap<String, bool> = config::AGENTS
            .iter()
            .map(|a| (a.id.to_string(), config::default_visibility(a.id)))
            .collect();
        if let Some(json) = settings.get("visible_agents") {
            if let Ok(parsed) = serde_json::from_str::<HashMap<String, bool>>(json) {
                for (k, v) in parsed {
                    map.insert(k, v);
                }
            }
        }
        map
    }

    pub fn is_visible_local_skill(
        skill: &SkillCacheEntry,
        visible_agents: &HashMap<String, bool>,
        include_external: bool,
    ) -> bool {
        match skill.origin.as_str() {
            "ssot" => true,
            "external" => include_external,
            "agent" => skill.home_agent.as_deref().is_some_and(|agent| {
                visible_agents
                    .get(agent)
                    .copied()
                    .unwrap_or_else(|| config::default_visibility(agent))
            }),
            _ => false,
        }
    }

    // ──────────────────────────────────────────────
    //  Symlink status
    // ──────────────────────────────────────────────

    pub fn get_symlink_status(cache: &SkillCache, settings: &Settings) -> Vec<SymlinkStatus> {
        let agents_dir = config::get_agents_skills_dir();
        let visible_agents = Self::get_visible_agents(settings);
        let mut statuses = Vec::new();

        for skill in cache.skills() {
            let target_path = if let Some(ref hp) = skill.home_path {
                std::path::PathBuf::from(hp)
            } else {
                agents_dir.join(&skill.directory)
            };
            let target_path = std::fs::canonicalize(&target_path).unwrap_or(target_path);
            for agent in config::AGENTS {
                if !visible_agents
                    .get(agent.id)
                    .copied()
                    .unwrap_or_else(|| config::default_visibility(agent.id))
                {
                    continue;
                }
                if let Some(agent_dir) = config::get_agent_skills_dir(agent.id) {
                    let symlink_path = agent_dir.join(Self::agent_link_name(&skill.directory));
                    let exists = symlink_path.exists();
                    let is_valid = if exists {
                        symlink_target_matches(&symlink_path, &target_path)
                    } else {
                        false
                    };
                    statuses.push(SymlinkStatus {
                        skill_id: skill.id.clone(),
                        skill_name: skill.name.clone(),
                        agent: agent.id.to_string(),
                        symlink_path: symlink_path.display().to_string(),
                        target_path: target_path.display().to_string(),
                        exists,
                        is_valid,
                    });
                }
            }
        }
        statuses
    }

    // ──────────────────────────────────────────────
    //  Symlink toggle
    // ──────────────────────────────────────────────

    pub(crate) fn safe_remove(path: &std::path::Path) -> Result<(), AppError> {
        if is_symlink_or_junction(path) {
            // On Unix: symlinks are files, remove_file works.
            // On Windows: junctions are directories, remove_file fails — must use remove_dir.
            // Both remove_file and remove_dir only delete the link itself, never the target.
            #[cfg(unix)]
            {
                std::fs::remove_file(path).map_err(|e| error::io(path, e))
            }
            #[cfg(windows)]
            {
                std::fs::remove_dir(path).map_err(|e| error::io(path, e))
            }
        } else if path.is_dir() {
            std::fs::remove_dir_all(path).map_err(|e| error::io(path, e))
        } else if path.exists() {
            std::fs::remove_file(path).map_err(|e| error::io(path, e))
        } else {
            Ok(())
        }
    }

    fn create_link_to_target(
        target_path: &std::path::Path,
        symlink_path: &std::path::Path,
    ) -> Result<(), AppError> {
        let parent = symlink_path.parent().ok_or_else(|| {
            AppError::BadRequest(format!(
                "Cannot create link without a parent directory: {}",
                symlink_path.display()
            ))
        })?;
        std::fs::create_dir_all(parent).map_err(|e| error::io(parent, e))?;

        #[cfg(unix)]
        std::os::unix::fs::symlink(target_path, symlink_path)
            .map_err(|e| error::io(symlink_path, e))?;
        #[cfg(windows)]
        {
            if target_path.is_dir() {
                // Junction points do not require admin privileges or Developer Mode.
                junction::create(target_path, symlink_path)
                    .map_err(|e| error::io(symlink_path, e))?;
            } else {
                std::os::windows::fs::symlink_file(target_path, symlink_path)
                    .map_err(|e| error::io(symlink_path, e))?;
            }
        }

        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn create_link_to_target_for_test(
        target_path: &std::path::Path,
        symlink_path: &std::path::Path,
    ) -> Result<(), AppError> {
        Self::create_link_to_target(target_path, symlink_path)
    }

    pub fn remove_agent_links_for_target(
        skill_name: &str,
        target_path: &std::path::Path,
    ) -> Result<usize, AppError> {
        let mut removed = 0;
        for agent in config::AGENTS {
            if let Some(agent_dir) = config::get_agent_skills_dir(agent.id) {
                let symlink_path = agent_dir.join(Self::agent_link_name(skill_name));
                if is_symlink_or_junction(&symlink_path)
                    && (symlink_target_matches(&symlink_path, target_path)
                        || raw_symlink_target_matches(&symlink_path, target_path))
                {
                    Self::safe_remove(&symlink_path)?;
                    removed += 1;
                }
            }
        }
        Ok(removed)
    }

    pub fn toggle_symlink(
        skill_dir: &str,
        home_path: &str,
        agent: &str,
        enabled: bool,
    ) -> Result<(), AppError> {
        let target_path = std::path::PathBuf::from(home_path);
        let agent_skills_dir = config::get_agent_skills_dir(agent)
            .ok_or_else(|| AppError::NotFound(format!("Unknown agent: {agent}")))?;
        let symlink_path = agent_skills_dir.join(Self::agent_link_name(skill_dir));

        if enabled {
            if !target_path.exists() {
                return Err(AppError::NotFound(format!(
                    "Target path does not exist: {}",
                    target_path.display()
                )));
            }
            if is_symlink_or_junction(&symlink_path) {
                match symlink_target_state(&symlink_path, &target_path) {
                    LinkTargetState::Matches => return Ok(()),
                    LinkTargetState::Different | LinkTargetState::Unknown => {
                        return Err(AppError::BadRequest(format!(
                            "Cannot create link: {} already points to a different or unknown target.",
                            symlink_path.display()
                        )));
                    }
                }
            } else if symlink_path.exists() {
                if canonical_paths_eq(&symlink_path, &target_path) {
                    return Ok(());
                }
                return Err(AppError::BadRequest(format!(
                    "Cannot create link: {} already exists and is not a symlink.",
                    symlink_path.display()
                )));
            }
            Self::safe_remove(&symlink_path)?;
            Self::create_link_to_target(&target_path, &symlink_path)?;
        } else if is_symlink_or_junction(&symlink_path) {
            if symlink_target_state(&symlink_path, &target_path) == LinkTargetState::Matches {
                Self::safe_remove(&symlink_path)?;
            }
        } else if symlink_path.exists() {
            return Err(AppError::BadRequest(format!(
                "Cannot remove: {} is a real directory, not a symlink.",
                symlink_path.display()
            )));
        }
        Ok(())
    }

    /// Remove a skill's physical directory and all symlinks pointing to it
    /// across agent directories. This is the shared deletion logic used by
    /// both the "remove skill" command and the dedup merge.
    ///
    /// - Deletes the entity directory at `home_path` (must not be a symlink).
    /// - Removes symlinks in all agent directories that reference this skill name.
    /// - Does NOT delete real (non-symlink) directories in agent dirs — those
    ///   are user data that requires explicit consent.
    pub fn remove_skill_dir(skill_name: &str, home_path: &str) -> Result<(), AppError> {
        let home = std::path::Path::new(home_path);

        // Clean up symlinks while the entity directory still exists, so target
        // matching can canonicalize the link target reliably.
        for agent in config::AGENTS {
            if let Some(agent_dir) = config::get_agent_skills_dir(agent.id) {
                let symlink_path = agent_dir.join(Self::agent_link_name(skill_name));
                if is_symlink_or_junction(&symlink_path)
                    && symlink_target_state(&symlink_path, home) == LinkTargetState::Matches
                {
                    let _ = Self::safe_remove(&symlink_path);
                }
            }
        }

        // Delete the entity directory
        if home.exists() && !is_symlink_or_junction(home) {
            std::fs::remove_dir_all(home).map_err(|e| crate::error::io(home, e))?;
        }

        Ok(())
    }

    pub(crate) fn stage_agent_symlink_removal(
        agents: &[&str],
    ) -> Result<StagedAgentSymlinkRemoval, AppError> {
        let mut agent_dirs = Vec::with_capacity(agents.len());
        for agent in agents {
            agent_dirs.push(
                config::get_agent_skills_dir(agent)
                    .ok_or_else(|| AppError::NotFound(format!("Unknown agent: {agent}")))?,
            );
        }
        Self::stage_agent_symlink_removal_in_dirs(&agent_dirs)
    }

    fn stage_agent_symlink_removal_in_dirs(
        agent_dirs: &[PathBuf],
    ) -> Result<StagedAgentSymlinkRemoval, AppError> {
        Self::stage_agent_symlink_removal_in_dirs_with(agent_dirs, |source, destination| {
            std::fs::rename(source, destination)
        })
    }

    fn stage_agent_symlink_removal_in_dirs_with(
        agent_dirs: &[PathBuf],
        mut rename_link: impl FnMut(&Path, &Path) -> std::io::Result<()>,
    ) -> Result<StagedAgentSymlinkRemoval, AppError> {
        let mut link_groups = Vec::new();
        for agent_dir in agent_dirs {
            if !agent_dir.exists() {
                continue;
            }
            let entries = std::fs::read_dir(agent_dir).map_err(|e| error::io(agent_dir, e))?;
            let mut links = Vec::new();
            for entry in entries {
                let entry = entry.map_err(|e| error::io(agent_dir, e))?;
                let path = entry.path();
                if is_symlink_or_junction(&path) {
                    links.push(path);
                }
            }
            if !links.is_empty() {
                link_groups.push((agent_dir.clone(), links));
            }
        }

        let mut staged = StagedAgentSymlinkRemoval {
            moved_links: Vec::new(),
            staging_dirs: Vec::new(),
        };
        let mut moves_to_make = Vec::new();
        for (agent_dir, links) in link_groups {
            let parent = agent_dir.parent().ok_or_else(|| {
                AppError::BadRequest(format!(
                    "Agent skills directory has no parent: {}",
                    agent_dir.display()
                ))
            })?;
            let staging_dir = tempfile::Builder::new()
                .prefix(".skill-zoo-hide-")
                .tempdir_in(parent)
                .map_err(|e| error::io(parent, e))?;
            let staging_path = staging_dir.path().to_path_buf();
            staged.staging_dirs.push(staging_dir);
            for original in links {
                let file_name = original.file_name().ok_or_else(|| {
                    AppError::BadRequest(format!(
                        "Agent link has no file name: {}",
                        original.display()
                    ))
                })?;
                let destination = staging_path.join(file_name);
                moves_to_make.push((original, destination));
            }
        }

        for (original, destination) in moves_to_make {
            if let Err(error) = rename_link(&original, &destination) {
                let original_error = error::io(&original, error);
                return match staged.rollback() {
                    Ok(()) => Err(original_error),
                    Err(rollback_error) => Err(AppError::Cli(format!(
                        "{original_error}. Recovery incomplete: {rollback_error}"
                    ))),
                };
            }
            staged.moved_links.push((original, destination));
        }
        Ok(staged)
    }

    #[cfg(test)]
    pub(crate) fn stage_agent_symlink_removal_in_dirs_for_test(
        agent_dirs: &[PathBuf],
    ) -> Result<StagedAgentSymlinkRemoval, AppError> {
        Self::stage_agent_symlink_removal_in_dirs(agent_dirs)
    }

    // ──────────────────────────────────────────────
    //  Merge
    // ──────────────────────────────────────────────

    /// Merge all duplicates of a skill name into SSOT.
    /// Copies first skill's files to SSOT, creates symlinks only for agents
    /// that already had the skill, removes original non-SSOT directories,
    /// and migrates metadata from old IDs to the new merged ID.
    /// IMPORTANT: Caller must get user confirmation before calling this.
    /// Returns an error if the duplicates have different content (cannot auto-merge).
    pub fn merge_duplicates_to_ssot(
        skill_name: &str,
        cache: &RwLock<SkillCache>,
        metadata: &RwLock<MetadataStore>,
    ) -> Result<(), AppError> {
        // NOTE: This function reads cache, performs filesystem ops, then
        // rewrites cache. If the filesystem watcher fires between the read
        // and the write, the debounced rebuild could restore stale entries.
        // The watcher's debounce window makes this unlikely in practice. If
        // it becomes a problem, hold the write lock for the entire operation
        // and make the filesystem calls lock-free.
        let entries: Vec<SkillCacheEntry> = {
            let c = cache
                .read()
                .map_err(|e| AppError::Parse(format!("Cache lock: {e}")))?;
            c.skills()
                .iter()
                .filter(|s| s.name == skill_name)
                .cloned()
                .collect()
        };

        if entries.is_empty() {
            return Err(AppError::NotFound(format!(
                "No skills found with name: {skill_name}"
            )));
        }

        // Filter out external imports — they can't be merged into SSOT
        // because their source files are owned by the user elsewhere.
        let entries: Vec<SkillCacheEntry> = entries
            .into_iter()
            .filter(|entry| entry.origin != "external")
            .collect();

        if entries.is_empty() {
            return Err(AppError::NotFound(format!(
                "No mergeable skills found with name: {skill_name}"
            )));
        }

        // Refuse to merge if content differs (safety check — frontend should
        // already prevent this, but backend must enforce it too).
        if !Self::duplicates_have_verified_matching_content(&entries) {
            return Err(AppError::BadRequest(format!(
                "Cannot merge: skills named '{skill_name}' do not all have verified matching content. Please resolve manually."
            )));
        }

        // Collect old IDs before any mutation (for metadata migration later)
        let old_ids: Vec<String> = entries.iter().map(|e| e.id.clone()).collect();

        // Collect agents that have a real (non-SSOT) entity being deleted.
        // These are the only agents that need a new symlink after merge.
        let agents_needing_symlink: Vec<String> = entries
            .iter()
            .filter(|e| e.origin == "agent")
            .filter_map(|e| e.home_agent.clone())
            .collect::<std::collections::HashSet<_>>()
            .into_iter()
            .collect();

        // Use the first entry's home_path as source
        let source_path = entries[0]
            .home_path
            .as_ref()
            .ok_or_else(|| AppError::NotFound(format!("No home path for skill: {skill_name}")))?;

        let ssot_dir = config::get_agents_skills_dir();
        let dest_dir = ssot_dir.join(skill_name);

        // Copy to SSOT if not already there
        if !dest_dir.exists() {
            std::fs::create_dir_all(&ssot_dir).map_err(|e| crate::error::io(&ssot_dir, e))?;
            Self::copy_dir_recursive(std::path::Path::new(source_path), &dest_dir)?;
        }

        // Phase 1: Remove original non-SSOT directories + their symlinks
        // Must happen before symlink creation, because the entity dir occupies the path.
        for entry in &entries {
            if entry.origin == "ssot" {
                continue;
            }
            if let Some(ref home) = entry.home_path {
                Self::remove_skill_dir(skill_name, home)?;
            }
        }

        // Phase 2: Create symlinks for agents whose entity was deleted
        for agent_id in &agents_needing_symlink {
            if let Some(agent_dir) = config::get_agent_skills_dir(agent_id) {
                let symlink_path = agent_dir.join(skill_name);
                if agent_dir.exists() && !symlink_path.exists() {
                    if let Err(e) = Self::toggle_symlink(
                        skill_name,
                        &dest_dir.to_string_lossy(),
                        agent_id,
                        true,
                    ) {
                        eprintln!(
                            "Failed to create symlink after merging '{}' (agent {}): {e}",
                            skill_name, agent_id
                        );
                    }
                }
            }
        }

        // Phase 3: Update cache — remove all old entries, then re-scan
        {
            let mut c = cache
                .write()
                .map_err(|e| AppError::Parse(format!("Cache lock: {e}")))?;
            c.remove_where(|s| s.name == skill_name);
            c.save()?;
        }
        let entry = Self::scan_single_skill(skill_name)?;
        let new_id = entry.id.clone();
        Self::upsert_cache_entry(cache, entry)?;

        // Phase 4: Migrate metadata from old IDs to the new merged ID
        {
            let mut m = metadata
                .write()
                .map_err(|e| AppError::Parse(format!("Metadata lock: {e}")))?;
            // Accumulate any user metadata across all old entries
            let merged = SkillMetadata {
                starred: old_ids.iter().any(|id| m.get(id).starred),
                is_mine: old_ids.iter().any(|id| m.get(id).is_mine),
            };
            // Remove old IDs and insert the new one (only if non-default)
            if merged.starred || merged.is_mine {
                m.entries.insert(new_id, merged);
            }
            for old_id in &old_ids {
                m.remove(old_id);
            }
            m.save()?;
        }

        Ok(())
    }

    fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> Result<(), AppError> {
        if !dst.exists() {
            std::fs::create_dir_all(dst).map_err(|e| crate::error::io(dst, e))?;
        }
        for entry in std::fs::read_dir(src).map_err(|e| crate::error::io(src, e))? {
            let entry = entry.map_err(|e| crate::error::io(src, e))?;
            let src_path = entry.path();
            let dst_path = dst.join(entry.file_name());
            if is_symlink_or_junction(&src_path) {
                continue;
            }
            if src_path.is_dir() {
                Self::copy_dir_recursive(&src_path, &dst_path)?;
            } else {
                std::fs::copy(&src_path, &dst_path).map_err(|e| crate::error::io(&src_path, e))?;
            }
        }
        Ok(())
    }

    // ────────────── File tree listing ──────────────

    /// List one directory level for a concrete skill directory.
    pub fn list_skill_file_children_at(
        skill_dir: &std::path::Path,
        parent_path: Option<&str>,
    ) -> Result<Vec<SkillFileNode>, AppError> {
        let target_dir = if let Some(parent_path) = parent_path {
            let relative = ManagedSkill::relative_path(parent_path)?;
            let target = skill_dir.join(relative);
            let target_real = target
                .canonicalize()
                .map_err(|e| crate::error::io(&target, e))?;
            if target_real != skill_dir && !target_real.starts_with(skill_dir) {
                return Err(AppError::BadRequest(
                    "Path escapes the requested skill directory".into(),
                ));
            }
            if !target_real.is_dir() || is_symlink_or_junction(&target) {
                return Err(AppError::BadRequest("Path is not a directory".into()));
            }
            target_real
        } else {
            skill_dir.to_path_buf()
        };

        let mut nodes = Vec::new();
        Self::build_file_tree_level(skill_dir, &target_dir, &mut nodes)?;
        Self::sort_nodes(&mut nodes);
        Ok(nodes)
    }

    fn build_file_tree_level(
        root: &std::path::Path,
        dir: &std::path::Path,
        nodes: &mut Vec<SkillFileNode>,
    ) -> Result<(), AppError> {
        let entries = std::fs::read_dir(dir).map_err(|e| crate::error::io(dir, e))?;

        for entry in entries.flatten() {
            let path = entry.path();

            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if crate::config::SKIP_DIRS.contains(&name) {
                    continue;
                }
            }

            if path.is_dir() && !is_symlink_or_junction(&path) {
                nodes.push(SkillFileNode {
                    name: path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("")
                        .to_string(),
                    path: path
                        .strip_prefix(root)
                        .unwrap_or(&path)
                        .to_string_lossy()
                        .to_string(),
                    is_dir: true,
                    is_skill_md: false,
                    children: None,
                });
            } else if path.is_file() || (is_symlink_or_junction(&path) && path.is_file()) {
                let file_name = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();

                nodes.push(SkillFileNode {
                    is_skill_md: file_name == "SKILL.md",
                    name: file_name,
                    path: path
                        .strip_prefix(root)
                        .unwrap_or(&path)
                        .to_string_lossy()
                        .to_string(),
                    is_dir: false,
                    children: None,
                });
            }
        }

        Ok(())
    }

    #[cfg(feature = "test-helpers")]
    pub fn build_file_tree_level_for_test(
        dir: &std::path::Path,
    ) -> Result<Vec<SkillFileNode>, AppError> {
        let mut nodes = Vec::new();
        Self::build_file_tree_level(dir, dir, &mut nodes)?;
        Self::sort_nodes(&mut nodes);
        Ok(nodes)
    }

    fn sort_nodes(nodes: &mut [SkillFileNode]) {
        nodes.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::lock::SUPPORTED_LOCK_VERSION;

    #[test]
    fn repo_root_normalization_uses_safe_skill_name() {
        let repo = tempfile::tempdir().expect("tempdir");
        let repo_root = repo.path().join("identity-skill-deadbeef");
        std::fs::create_dir_all(&repo_root).expect("create repo root");
        std::fs::write(
            repo_root.join("SKILL.md"),
            "---\nname: identity-skill\ndescription: Demo\n---\n",
        )
        .expect("write skill");
        let nested = repo_root.join("skills").join("child");
        std::fs::create_dir_all(&nested).expect("create nested skill");
        std::fs::write(
            nested.join("SKILL.md"),
            "---\nname: child\ndescription: Demo\n---\n",
        )
        .expect("write nested skill");

        let normalized = SkillService::normalize_extracted_repo_root(&repo_root, "identity-skill")
            .expect("normalize repo root");

        assert_eq!(
            normalized.file_name().and_then(|n| n.to_str()),
            Some("identity-skill")
        );
        assert!(!repo_root.exists());
    }

    #[test]
    fn repo_root_normalization_uses_repo_name_for_unsafe_skill_name() {
        let repo = tempfile::tempdir().expect("tempdir");
        let repo_root = repo.path().join("identity-skill-deadbeef");
        std::fs::create_dir_all(&repo_root).expect("create repo root");
        std::fs::write(
            repo_root.join("SKILL.md"),
            "---\nname: My Skill\ndescription: Demo\n---\n",
        )
        .expect("write skill");

        let normalized = SkillService::normalize_extracted_repo_root(&repo_root, "identity-skill")
            .expect("normalize repo root");

        assert_eq!(
            normalized.file_name().and_then(|n| n.to_str()),
            Some("identity-skill")
        );
        assert!(!repo_root.exists());
    }

    #[test]
    fn repo_discovery_scans_nested_skills_when_root_metadata_is_invalid() {
        let repo = tempfile::tempdir().expect("tempdir");
        let repo_root = repo.path().join("skills-repo-deadbeef");
        let nested = repo_root.join("skills").join("child");
        std::fs::create_dir_all(&nested).expect("create nested skill");
        std::fs::write(repo_root.join("SKILL.md"), "---\nname: root-only\n---\n")
            .expect("write invalid root skill");
        std::fs::write(
            nested.join("SKILL.md"),
            "---\nname: child\ndescription: Demo\n---\n",
        )
        .expect("write nested skill");

        let mut skills = Vec::new();
        SkillService::scan_for_skills(&repo_root, &repo_root, "owner", "repo", 0, &mut skills)
            .expect("scan skills");

        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].key, "skills/child");
    }

    #[test]
    fn repo_discovery_uses_directory_name_as_root_skill_key() {
        let repo = tempfile::tempdir().expect("tempdir");
        let repo_root = repo.path().join("identity-skill-deadbeef");
        std::fs::create_dir_all(&repo_root).expect("create repo root");
        std::fs::write(
            repo_root.join("SKILL.md"),
            "---\nname: identity-skill\ndescription: Demo\n---\n",
        )
        .expect("write skill");

        let repo_root = SkillService::normalize_extracted_repo_root(&repo_root, "identity-skill")
            .expect("normalize repo root");

        let mut skills = Vec::new();
        SkillService::scan_for_skills(
            &repo_root,
            &repo_root,
            "Sac-Y",
            "identity-skill",
            0,
            &mut skills,
        )
        .expect("scan skills");

        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].key, ".");
    }

    #[test]
    fn agent_link_name_uses_directory_leaf() {
        assert_eq!(
            SkillService::agent_link_name(".system/openai-docs"),
            "openai-docs"
        );
        assert_eq!(SkillService::agent_link_name("openai-docs"), "openai-docs");
    }

    #[test]
    fn create_link_to_target_uses_flat_agent_link_name_for_nested_skill() {
        let dir = tempfile::tempdir().expect("tempdir");
        let target_path = dir
            .path()
            .join("openai")
            .join("skills")
            .join(".system")
            .join("openai-docs");
        std::fs::create_dir_all(&target_path).expect("create target");

        let symlink_path = dir
            .path()
            .join(".opencode")
            .join("skills")
            .join(SkillService::agent_link_name(".system/openai-docs"));

        SkillService::create_link_to_target(&target_path, &symlink_path).expect("create link");

        assert!(symlink_path.parent().expect("parent").is_dir());
        assert_eq!(
            symlink_path.file_name().and_then(|name| name.to_str()),
            Some("openai-docs")
        );
        assert!(!dir
            .path()
            .join(".opencode")
            .join("skills")
            .join(".system")
            .exists());
        assert!(is_symlink_or_junction(&symlink_path));
        assert!(symlink_target_matches(&symlink_path, &target_path));
    }

    #[test]
    fn staged_agent_link_removal_rolls_back_all_agents_and_ignores_real_directories() {
        let root = tempfile::tempdir().expect("tempdir");
        let first_agent = root.path().join("first-agent/skills");
        let second_agent = root.path().join("second-agent/skills");
        let first_target = root.path().join("targets/first");
        let second_target = root.path().join("targets/second");
        std::fs::create_dir_all(&first_target).unwrap();
        std::fs::create_dir_all(&second_target).unwrap();
        std::fs::create_dir_all(first_agent.join("local-skill")).unwrap();
        let first_link = first_agent.join("first");
        let second_link = second_agent.join("second");
        SkillService::create_link_to_target(&first_target, &first_link).unwrap();
        SkillService::create_link_to_target(&second_target, &second_link).unwrap();

        let staged = SkillService::stage_agent_symlink_removal_in_dirs_for_test(&[
            first_agent.clone(),
            second_agent,
        ])
        .unwrap();

        assert!(std::fs::symlink_metadata(&first_link).is_err());
        assert!(std::fs::symlink_metadata(&second_link).is_err());
        assert!(first_agent.join("local-skill").is_dir());

        staged.rollback().unwrap();

        assert!(symlink_target_matches(&first_link, &first_target));
        assert!(symlink_target_matches(&second_link, &second_target));
        assert!(first_agent.join("local-skill").is_dir());
    }

    #[test]
    fn staged_agent_link_removal_restores_earlier_links_when_a_later_move_fails() {
        let root = tempfile::tempdir().expect("tempdir");
        let first_agent = root.path().join("first-agent/skills");
        let second_agent = root.path().join("second-agent/skills");
        let first_target = root.path().join("targets/first");
        let second_target = root.path().join("targets/second");
        std::fs::create_dir_all(&first_target).unwrap();
        std::fs::create_dir_all(&second_target).unwrap();
        let first_link = first_agent.join("first");
        let second_link = second_agent.join("second");
        SkillService::create_link_to_target(&first_target, &first_link).unwrap();
        SkillService::create_link_to_target(&second_target, &second_link).unwrap();
        let mut moves = 0;

        let result = SkillService::stage_agent_symlink_removal_in_dirs_with(
            &[first_agent, second_agent],
            |source, destination| {
                moves += 1;
                if moves == 2 {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::PermissionDenied,
                        "injected move failure",
                    ));
                }
                std::fs::rename(source, destination)
            },
        );

        assert!(result.is_err());
        assert!(symlink_target_matches(&first_link, &first_target));
        assert!(symlink_target_matches(&second_link, &second_target));
    }

    #[test]
    fn staged_agent_link_removal_reports_a_missing_backup() {
        let root = tempfile::tempdir().expect("tempdir");
        let agent_dir = root.path().join("agent/skills");
        let target = root.path().join("target");
        std::fs::create_dir_all(&target).unwrap();
        let link = agent_dir.join("demo");
        SkillService::create_link_to_target(&target, &link).unwrap();
        let staged =
            SkillService::stage_agent_symlink_removal_in_dirs_for_test(&[agent_dir]).unwrap();
        let backup = staged.moved_links[0].1.clone();
        SkillService::safe_remove(&backup).unwrap();

        let error = staged.rollback().unwrap_err().to_string();

        assert!(error.contains("staged backup is missing"));
        assert!(error.contains("Backups retained at"));
        assert!(std::fs::symlink_metadata(&link).is_err());
        assert!(target.is_dir());
    }

    #[test]
    fn committed_agent_link_removal_deletes_links_without_deleting_targets() {
        let root = tempfile::tempdir().expect("tempdir");
        let agent_dir = root.path().join("agent/skills");
        let target = root.path().join("target");
        std::fs::create_dir_all(&target).unwrap();
        let link = agent_dir.join("demo");
        SkillService::create_link_to_target(&target, &link).unwrap();

        let staged =
            SkillService::stage_agent_symlink_removal_in_dirs_for_test(&[agent_dir]).unwrap();
        staged.commit();

        assert!(std::fs::symlink_metadata(&link).is_err());
        assert!(target.is_dir());
    }

    #[test]
    #[cfg(unix)]
    fn symlink_target_state_treats_dangling_link_as_unknown() {
        let dir = tempfile::tempdir().expect("tempdir");
        let link_path = dir.path().join("imagegen");
        let missing_target = dir.path().join("missing-target");
        let expected_target = dir.path().join("expected-target");

        std::os::unix::fs::symlink(&missing_target, &link_path).expect("create dangling symlink");

        assert_eq!(
            symlink_target_state(&link_path, &expected_target),
            LinkTargetState::Unknown
        );
    }

    #[test]
    #[cfg(unix)]
    fn toggle_symlink_does_not_remove_dangling_unknown_link() {
        let dir = tempfile::tempdir().expect("tempdir");
        let link_path = dir.path().join("imagegen");
        let missing_target = dir.path().join("missing-target");
        let expected_target = dir.path().join("expected-target");

        std::os::unix::fs::symlink(&missing_target, &link_path).expect("create dangling symlink");

        if symlink_target_state(&link_path, &expected_target) == LinkTargetState::Matches {
            SkillService::safe_remove(&link_path).expect("remove link");
        }

        assert!(is_symlink_or_junction(&link_path));
    }

    #[test]
    fn discoverable_classification_reports_available_when_cache_is_empty() {
        let cache = SkillCache::empty();
        let lock = SkillLock {
            version: SUPPORTED_LOCK_VERSION,
            skills: Default::default(),
            dismissed: serde_json::json!({}),
        };

        let (status, installed_id) = SkillService::classify_discoverable_skill(
            &cache,
            &lock,
            "recap",
            ".codex/skills/recap",
            "anthropics",
            "skills",
            None,
        );

        assert_eq!(status, DiscoverableSkillInstallStatus::Available);
        assert_eq!(installed_id, None);
    }

    #[test]
    fn discoverable_classification_uses_repo_path_for_installed_match() {
        let cache = SkillCache::from_entries(vec![test_cache_entry(
            "repo:anthropics/skills:recap",
            "recap",
            "anthropics",
            "skills",
        )]);
        let mut lock = SkillLock {
            version: SUPPORTED_LOCK_VERSION,
            skills: Default::default(),
            dismissed: serde_json::json!({}),
        };
        lock.skills.insert(
            "recap".to_string(),
            test_lock_entry("anthropics/skills", ".claude/skills/recap"),
        );

        let (installed_status, installed_id) = SkillService::classify_discoverable_skill(
            &cache,
            &lock,
            "recap",
            ".claude/skills/recap",
            "anthropics",
            "skills",
            None,
        );
        let (conflict_status, conflict_id) = SkillService::classify_discoverable_skill(
            &cache,
            &lock,
            "recap",
            ".codex/skills/recap",
            "anthropics",
            "skills",
            None,
        );

        assert_eq!(installed_status, DiscoverableSkillInstallStatus::Installed);
        assert_eq!(
            installed_id.as_deref(),
            Some("repo:anthropics/skills:recap")
        );
        assert_eq!(conflict_status, DiscoverableSkillInstallStatus::Conflict);
        assert_eq!(conflict_id, None);
    }

    #[test]
    fn discoverable_classification_matches_legacy_root_install_by_empty_lock_path() {
        let cache = SkillCache::from_entries(vec![test_cache_entry(
            "repo:owner/repo:legacy-root",
            "repo-deadbeef",
            "owner",
            "repo",
        )]);
        let mut lock = SkillLock {
            version: SUPPORTED_LOCK_VERSION,
            skills: Default::default(),
            dismissed: serde_json::json!({}),
        };
        lock.skills.insert(
            "repo-deadbeef".to_string(),
            test_lock_entry("owner/repo", ""),
        );

        let (status, installed_id) = SkillService::classify_discoverable_skill(
            &cache, &lock, "repo", ".", "owner", "repo", None,
        );

        assert_eq!(status, DiscoverableSkillInstallStatus::Installed);
        assert_eq!(installed_id.as_deref(), Some("repo:owner/repo:legacy-root"));
    }

    #[test]
    fn discoverable_classification_ignores_external_imports() {
        let mut external = test_cache_entry("external:demo", "demo", "owner", "repo");
        external.origin = "external".to_string();
        let cache = SkillCache::from_entries(vec![external]);
        let lock = SkillLock {
            version: SUPPORTED_LOCK_VERSION,
            skills: Default::default(),
            dismissed: serde_json::json!({}),
        };

        let (status, installed_id) = SkillService::classify_discoverable_skill(
            &cache, &lock, "demo", "demo", "owner", "repo", None,
        );

        assert_eq!(status, DiscoverableSkillInstallStatus::Available);
        assert_eq!(installed_id, None);
    }

    #[test]
    fn visible_local_scope_includes_ssot_external_and_visible_agent_home() {
        let mut visible_agents = std::collections::HashMap::new();
        visible_agents.insert("claude-code".to_string(), true);
        visible_agents.insert("codex".to_string(), false);

        let ssot = test_cache_entry("ssot:demo", "demo", "owner", "repo");
        let mut visible_agent = test_cache_entry("agent:claude-code:demo", "demo", "owner", "repo");
        visible_agent.origin = "agent".to_string();
        visible_agent.home_agent = Some("claude-code".to_string());
        let mut hidden_agent = test_cache_entry("agent:codex:demo", "demo", "owner", "repo");
        hidden_agent.origin = "agent".to_string();
        hidden_agent.home_agent = Some("codex".to_string());
        let mut external = test_cache_entry("external:demo", "demo", "owner", "repo");
        external.origin = "external".to_string();

        assert!(SkillService::is_visible_local_skill(
            &ssot,
            &visible_agents,
            false
        ));
        assert!(SkillService::is_visible_local_skill(
            &visible_agent,
            &visible_agents,
            false
        ));
        assert!(!SkillService::is_visible_local_skill(
            &hidden_agent,
            &visible_agents,
            false
        ));
        assert!(!SkillService::is_visible_local_skill(
            &external,
            &visible_agents,
            false
        ));
        assert!(SkillService::is_visible_local_skill(
            &external,
            &visible_agents,
            true
        ));
    }

    fn test_cache_entry(
        id: &str,
        directory: &str,
        repo_owner: &str,
        repo_name: &str,
    ) -> SkillCacheEntry {
        SkillCacheEntry {
            id: id.to_string(),
            name: directory.to_string(),
            yaml_name: None,
            description: None,
            directory: directory.to_string(),
            repo_owner: Some(repo_owner.to_string()),
            repo_name: Some(repo_name.to_string()),
            source_url: Some(format!("https://github.com/{repo_owner}/{repo_name}")),
            origin: "ssot".to_string(),
            home_path: None,
            content_hash: None,
            home_agent: None,
            apps: Default::default(),
            installed_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn cache_batch_commit_restores_memory_when_persistence_fails() {
        let original = test_cache_entry("ssot:original", "original", "owner", "repo");
        let added = test_cache_entry("ssot:added", "added", "owner", "repo");
        let mut cache = SkillCache::from_entries(vec![original]);

        let result = commit_cache_entries(&mut cache, vec![added], |_| {
            Err(AppError::Cli("save failed".to_string()))
        });

        assert!(result.is_err());
        assert!(cache.find_by_id("ssot:original").is_some());
        assert!(cache.find_by_id("ssot:added").is_none());
    }

    #[test]
    fn cache_batch_commit_persists_all_entries_once() {
        let mut cache = SkillCache::empty();
        let entries = vec![
            test_cache_entry("ssot:first", "first", "owner", "repo"),
            test_cache_entry("ssot:second", "second", "owner", "repo"),
        ];
        let mut saves = 0;

        commit_cache_entries(&mut cache, entries, |_| {
            saves += 1;
            Ok(())
        })
        .unwrap();

        assert_eq!(saves, 1);
        assert!(cache.find_by_id("ssot:first").is_some());
        assert!(cache.find_by_id("ssot:second").is_some());
    }

    #[tokio::test]
    async fn installed_skill_refresh_waits_for_an_active_cache_refresh() {
        let cache = RwLock::new(SkillCache::empty());
        let metadata = RwLock::new(MetadataStore {
            entries: HashMap::new(),
        });
        let refresh_lock = tokio::sync::Mutex::new(());
        let guard = refresh_lock.lock().await;

        let blocked = tokio::time::timeout(
            std::time::Duration::from_millis(20),
            SkillService::refresh_installed_skills(
                &cache,
                &metadata,
                &refresh_lock,
                vec!["missing-skill-for-refresh-lock-test".to_string()],
            ),
        )
        .await;
        assert!(blocked.is_err());

        drop(guard);
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            SkillService::refresh_installed_skills(
                &cache,
                &metadata,
                &refresh_lock,
                vec!["missing-skill-for-refresh-lock-test".to_string()],
            ),
        )
        .await
        .expect("refresh should proceed after the lock is released");
        assert!(result.is_err());
    }

    fn test_lock_entry(source: &str, skill_path: &str) -> SkillLockEntry {
        SkillLockEntry {
            source: Some(source.to_string()),
            source_type: Some("github".to_string()),
            source_url: Some(format!("https://github.com/{source}")),
            branch: None,
            skill_path: Some(skill_path.to_string()),
            skill_folder_hash: None,
            installed_at: None,
            updated_at: None,
            commit_sha: None,
        }
    }

    fn managed_skill(root: &Path, origin: &str) -> ManagedSkill {
        let mut entry = test_cache_entry("skill-1", "skill-1", "owner", "repo");
        entry.origin = origin.to_string();
        entry.home_path = Some(root.to_string_lossy().to_string());
        let cache = SkillCache::from_entries(vec![entry]);
        ManagedSkill::resolve(&cache, "skill-1", false).expect("resolve managed skill")
    }

    #[test]
    fn managed_skill_rejects_untrusted_relative_paths() {
        let dir = tempfile::tempdir().expect("tempdir");
        let skill = managed_skill(dir.path(), "ssot");

        for path in ["../secret", "/tmp/secret", "C:\\secret", "a\\b", "a\0b"] {
            assert!(skill.existing_path(path).is_err(), "accepted {path:?}");
        }
    }

    #[test]
    fn managed_skill_allows_paths_inside_root() {
        let dir = tempfile::tempdir().expect("tempdir");
        let nested = dir.path().join("references");
        std::fs::create_dir(&nested).expect("create nested");
        std::fs::write(nested.join("guide.md"), "guide").expect("write guide");
        let skill = managed_skill(dir.path(), "ssot");

        assert_eq!(
            skill.existing_path("references/guide.md").unwrap(),
            nested.join("guide.md").canonicalize().unwrap()
        );
        assert_eq!(
            skill.writable_path("references/new.md").unwrap(),
            dir.path().canonicalize().unwrap().join("references/new.md")
        );
    }

    #[test]
    fn external_managed_skill_is_read_only() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut entry = test_cache_entry("skill-1", "skill-1", "owner", "repo");
        entry.origin = "external".to_string();
        entry.home_path = Some(dir.path().to_string_lossy().to_string());
        let cache = SkillCache::from_entries(vec![entry]);

        assert!(ManagedSkill::resolve(&cache, "skill-1", false).is_ok());
        assert!(ManagedSkill::resolve(&cache, "skill-1", true).is_err());
    }

    #[test]
    #[cfg(unix)]
    fn managed_skill_rejects_symlink_escape() {
        let skill_dir = tempfile::tempdir().expect("skill tempdir");
        let outside = tempfile::tempdir().expect("outside tempdir");
        let secret = outside.path().join("secret.txt");
        std::fs::write(&secret, "secret").expect("write secret");
        std::os::unix::fs::symlink(&secret, skill_dir.path().join("secret.txt"))
            .expect("create symlink");
        let skill = managed_skill(skill_dir.path(), "ssot");

        assert!(skill.existing_path("secret.txt").is_err());
        assert!(skill.writable_path("secret.txt").is_err());
    }
}

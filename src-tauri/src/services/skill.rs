use crate::config;
use crate::error::{self, AppError};
use crate::persistence::metadata::SkillMetadata;
use crate::persistence::{MetadataStore, Settings, SkillCache, SkillCacheEntry};
use crate::services::cli::CliService;
use crate::services::lock::{SkillLock, SkillLockEntry};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::RwLock;
use tauri::Emitter;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverableSkill {
    pub key: String,
    pub name: String,
    pub description: Option<String>,
    pub directory: String,
    pub repo_owner: String,
    pub repo_name: String,
    pub installed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installs: Option<u64>,
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
            apps: HashMap::new(),
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
        .map_or(false, |(a, b)| a == b)
}

/// Check whether a symlink/junction at `link_path` resolves to `expected_target`.
///
/// Resolves relative targets against the symlink's parent directory. Falls back
/// to canonicalized path comparison when `read_link` fails (Windows junctions).
fn symlink_target_matches(link_path: &std::path::Path, expected_target: &std::path::Path) -> bool {
    match std::fs::read_link(link_path) {
        Ok(target) => {
            let resolved = if target.is_relative() {
                link_path.parent().unwrap_or(std::path::Path::new(".")).join(&target)
            } else {
                target
            };
            canonical_paths_eq(&resolved, expected_target)
        }
        Err(_) => canonical_paths_eq(link_path, expected_target),
    }
}

pub struct SkillService;

impl SkillService {
    /// Check which agents can access this skill:
    /// - If the skill's homePath is under an agent directory (origin=agent),
    ///   that agent is marked as available directly.
    /// - For all other agents, only a symlink pointing to this skill's
    ///   homePath counts — a same-named real directory is a separate skill.
    pub fn detect_agents(skill_dir: &str, home_path: &Option<String>) -> HashMap<String, bool> {
        let mut enabled = HashMap::new();
        let home = home_path.as_ref().map(std::path::Path::new);
        let all_agents = config::all_agents();
        for agent in &all_agents {
            let agent_dir = &agent.skills_dir;
            // If homePath is directly under this agent dir, it's natively available
            if let Some(h) = home {
                if h.starts_with(agent_dir) {
                    enabled.insert(agent.id.clone(), true);
                    continue;
                }
            }
            // Otherwise, only count if there's a symlink pointing to homePath
            let symlink_path = agent_dir.join(skill_dir);
            if is_symlink_or_junction(&symlink_path) {
                let matched = home.map_or(false, |h| symlink_target_matches(&symlink_path, h));
                enabled.insert(agent.id.clone(), matched);
            } else {
                enabled.insert(agent.id.clone(), false);
            }
        }
        enabled
    }

    /// Determine which agent a scan root directory belongs to.
    /// Returns None for the SSOT directory.
    fn detect_agent_for_path(scan_root: &PathBuf) -> Option<String> {
        for agent in config::all_agents() {
            if scan_root == &agent.skills_dir {
                return Some(agent.id);
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
                return Some(ssot_path.to_str()?.to_string());
            }
        }
        for agent in config::all_agents() {
            let path = agent.skills_dir.join(skill_dir);
            if path.exists() && !is_symlink_or_junction(&path) {
                return Some(path.to_str()?.to_string());
            }
        }
        let ssot_path = agents_dir.join(skill_dir);
        if ssot_path.exists() {
            return Some(ssot_path.to_str()?.to_string());
        }
        None
    }

    /// Determine which agent a skill's home_path belongs to.
    fn detect_home_agent(home_path: &Option<String>, origin: &str) -> Option<String> {
        if origin == "ssot" {
            return None;
        }
        let hp = std::path::Path::new(home_path.as_deref()?);
        for agent in config::all_agents() {
            if hp.starts_with(&agent.skills_dir) {
                return Some(agent.id);
            }
        }
        None
    }

    /// Construct the canonical skill ID string used across cache and duplicate detection.
    /// Must match the logic in `scan_single_skill_with_cache`.
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

    fn get_dir_latest_mtime(path: &str) -> Option<i64> {
        let root = std::path::Path::new(path);
        let mut latest: Option<std::time::SystemTime> = None;
        fn walk(dir: &std::path::Path, latest: &mut Option<std::time::SystemTime>) {
            let Ok(entries) = std::fs::read_dir(dir) else {
                return;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if crate::config::SKIP_DIRS.contains(&name) {
                        continue;
                    }
                }
                if is_symlink_or_junction(&path) && path.is_dir() {
                    continue;
                }
                if let Ok(meta) = std::fs::metadata(&path) {
                    if let Ok(mtime) = meta.modified() {
                        if latest.is_none_or(|l| mtime > l) {
                            *latest = Some(mtime);
                        }
                    }
                }
                if path.is_dir() {
                    walk(&path, latest);
                }
            }
        }
        walk(root, &mut latest);
        latest.and_then(|m| {
            m.duration_since(std::time::UNIX_EPOCH)
                .ok()
                .map(|d| d.as_millis() as i64)
        })
    }

    fn hash_cache_path() -> PathBuf {
        crate::config::get_app_config_dir().join("hash-cache.json")
    }

    fn load_hash_cache() -> HashMap<String, (i64, String)> {
        let path = Self::hash_cache_path();
        if !path.exists() {
            return HashMap::new();
        }
        let content = std::fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_default()
    }

    fn save_hash_cache(cache: &HashMap<String, (i64, String)>) {
        let path = Self::hash_cache_path();
        if let Ok(json) = serde_json::to_string_pretty(cache) {
            let _ = crate::persistence::atomic_write(&path, json);
        }
    }

    fn compute_content_hash_cached(
        home_path: &str,
        cache: &mut HashMap<String, (i64, String)>,
    ) -> Option<String> {
        let current_mtime = Self::get_dir_latest_mtime(home_path)?;
        if let Some((cached_mtime, cached_hash)) = cache.get(home_path) {
            if current_mtime == *cached_mtime {
                return Some(cached_hash.clone());
            }
        }
        let new_hash = Self::compute_content_hash(home_path)?;
        cache.insert(home_path.to_string(), (current_mtime, new_hash.clone()));
        Some(new_hash)
    }

    // ──────────────────────────────────────────────
    //  Read path: return cached skills + live symlinks
    // ──────────────────────────────────────────────

    /// Return installed skills from the JSON cache with metadata merged.
    /// Does NOT detect agents (filesystem I/O) — caller must do that outside any lock.
    pub fn get_cached_skills(
        cache: &SkillCache,
        metadata: &MetadataStore,
    ) -> Result<Vec<InstalledSkill>, AppError> {
        let mut skills = Vec::with_capacity(cache.skills.len());
        for entry in &cache.skills {
            let mut skill: InstalledSkill = entry.clone().into();
            let meta = metadata.get(&entry.id);
            skill.starred = meta.starred;
            skill.is_mine = meta.is_mine;
            skills.push(skill);
        }
        Ok(skills)
    }

    /// Read cache + metadata, merge into InstalledSkill list, fill detect_agents.
    pub fn read_all_skills(
        skill_cache: &RwLock<SkillCache>,
        metadata: &RwLock<MetadataStore>,
    ) -> Result<Vec<InstalledSkill>, AppError> {
        let mut skills = {
            let cache = skill_cache
                .read()
                .map_err(|e: std::sync::PoisonError<_>| AppError::Cli(e.to_string()))?;
            let meta = metadata
                .read()
                .map_err(|e: std::sync::PoisonError<_>| AppError::Cli(e.to_string()))?;
            Self::get_cached_skills(&cache, &meta)?
        };
        Self::fill_detect_agents(&mut skills);
        Ok(skills)
    }

    /// Fill in the `apps` field for each skill by detecting agent symlinks.
    /// Must be called outside any lock — does filesystem I/O.
    pub fn fill_detect_agents(skills: &mut [InstalledSkill]) {
        for skill in skills.iter_mut() {
            skill.apps = Self::detect_agents(&skill.directory, &skill.home_path);
        }
    }

    // ──────────────────────────────────────────────
    //  Write path: rebuild cache from filesystem truth
    // ──────────────────────────────────────────────

    /// Rebuild the skill cache from filesystem + CLI + lock file.
    /// Returns skills with metadata merged. Caller should call fill_detect_agents()
    /// on the result (outside any lock) to populate the `apps` field.
    pub async fn rebuild_cache(
        cache: &RwLock<SkillCache>,
        metadata: &RwLock<MetadataStore>,
        sync_flag: &std::sync::atomic::AtomicBool,
    ) -> Result<Vec<InstalledSkill>, AppError> {
        if sync_flag.swap(true, std::sync::atomic::Ordering::AcqRel) {
            let c = cache
                .read()
                .map_err(|e| AppError::Parse(format!("Cache lock: {e}")))?;
            let m = metadata
                .read()
                .map_err(|e| AppError::Parse(format!("Metadata lock: {e}")))?;
            return Self::get_cached_skills(&c, &m);
        }

        struct SyncGuard<'a>(&'a std::sync::atomic::AtomicBool);
        impl<'a> Drop for SyncGuard<'a> {
            fn drop(&mut self) {
                self.0.store(false, std::sync::atomic::Ordering::Release);
            }
        }
        let _guard = SyncGuard(sync_flag);

        let mut entries: Vec<SkillCacheEntry> = Vec::new();
        let mut hash_cache = Self::load_hash_cache();

        Self::scan_filesystem_into(&mut entries, &mut hash_cache);

        Self::save_hash_cache(&hash_cache);

        let mut new_cache = cache
            .write()
            .map_err(|e| AppError::Parse(format!("Cache lock: {e}")))?;

        new_cache.skills = entries;
        new_cache.save()?;

        let m = metadata
            .read()
            .map_err(|e| AppError::Parse(format!("Metadata lock: {e}")))?;
        Self::get_cached_skills(&new_cache, &m)
    }

    /// Scan filesystem for skill directories and push into entries.
    fn scan_filesystem_into(
        entries: &mut Vec<SkillCacheEntry>,
        hash_cache: &mut HashMap<String, (i64, String)>,
    ) {
        let mut scan_dirs: Vec<PathBuf> = Vec::new();
        let agents_dir = config::get_agents_skills_dir();
        if agents_dir.exists() {
            scan_dirs.push(agents_dir);
        }
        for agent in config::all_agents() {
            if agent.skills_dir.exists() {
                scan_dirs.push(agent.skills_dir);
            }
        }
        if scan_dirs.is_empty() {
            return;
        }
        let lock_data: Option<SkillLock> = SkillLock::read().ok();
        let mut seen_ids: HashSet<String> = HashSet::new();
        for scan_dir in &scan_dirs {
            Self::scan_dir_recursive_into(
                scan_dir,
                entries,
                &mut seen_ids,
                &lock_data,
                scan_dir,
                hash_cache,
                0,
            );
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
        lock_data: &Option<SkillLock>,
        scan_root: &PathBuf,
        hash_cache: &mut HashMap<String, (i64, String)>,
        depth: usize,
    ) {
        if depth > Self::MAX_LOCAL_SCAN_DEPTH {
            return;
        }
        let Ok(dir_entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in dir_entries.flatten() {
            let path = entry.path();
            if is_symlink_or_junction(&path) {
                // Clean up broken symlinks/junctions whose target no longer exists.
                if !path.exists() {
                    let _ = Self::safe_remove(&path);
                }
                // In agent directories, symlinks point to SSOT — already scanned there.
                // In SSOT, symlinks shouldn't exist but skip them anyway.
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
            let skill_md = path.join("SKILL.md");
            if skill_md.exists() {
                let relative_dir = path
                    .strip_prefix(scan_root)
                    .unwrap_or(&path)
                    .to_str()
                    .unwrap_or(dir_name)
                    .to_string();

                let lock_entry = lock_data.as_ref().and_then(|lock| {
                    lock.skills
                        .get(&relative_dir)
                        .or_else(|| lock.skills.get(dir_name))
                });

                let (repo_owner, repo_name, source_url) = lock_entry
                    .map(|e| e.to_repo_info())
                    .unwrap_or((None, None, None));

                let (yaml_name, description) =
                    Self::parse_skill_md(&skill_md).unwrap_or((dir_name.to_string(), None));
                let yaml_name = CliService::strip_ansi(&yaml_name);
                let yaml_name = if yaml_name == dir_name {
                    None
                } else {
                    Some(yaml_name)
                };

                let is_ssot = config::get_agents_skills_dir() == *scan_root;
                let origin = if is_ssot { "ssot" } else { "agent" };
                let agent_id = if !is_ssot {
                    Self::detect_agent_for_path(scan_root)
                } else {
                    None
                };
                let id =
                    Self::make_skill_id(origin, &relative_dir, &repo_owner, &repo_name, agent_id.as_deref());
                if !seen_ids.insert(id.clone()) {
                    continue; // Already seen this ID, skip
                }
                let home_path = if is_ssot {
                    let ssot_path = config::get_agents_skills_dir().join(&relative_dir);
                    ssot_path.to_str().map(|s| s.to_string())
                } else {
                    // Agent directory scan — the entity dir IS the home path
                    path.to_str().map(|s| s.to_string())
                };
                let content_hash = home_path
                    .as_ref()
                    .and_then(|p| Self::compute_content_hash_cached(p, hash_cache));
                let home_agent = Self::detect_home_agent(&home_path, origin);

                let now = chrono::Utc::now().timestamp();
                let (installed_at, updated_at) = Self::resolve_timestamps(
                    lock_entry,
                    home_path.as_deref().unwrap_or(&relative_dir),
                    now,
                );

                entries.push(SkillCacheEntry {
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
                    installed_at,
                    updated_at,
                });
            } else {
                Self::scan_dir_recursive_into(
                    &path, entries, seen_ids, lock_data, scan_root, hash_cache, depth + 1,
                );
            }
        }
    }

    pub fn parse_skill_md(path: &std::path::Path) -> Result<(String, Option<String>), AppError> {
        let content = std::fs::read_to_string(path).map_err(|e| error::io(path, e))?;
        let mut name = path
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();
        let mut description: Option<String> = None;
        if let Some(frontmatter) = Self::extract_frontmatter(&content) {
            if let Ok(meta) = serde_yaml::from_str::<serde_yaml::Value>(&frontmatter) {
                if let Some(n) = meta.get("name") {
                    let n_str = Self::yaml_value_to_string(n);
                    name = CliService::strip_ansi(&n_str);
                }
                if let Some(d) = meta.get("description") {
                    description = Some(Self::yaml_value_to_string(d));
                }
            }
        }
        Ok((name, description))
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
    const MAX_LOCAL_SCAN_DEPTH: usize = 10;

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

    pub async fn discover_from_repo(
        owner: &str,
        name: &str,
        branch: &str,
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
            Self::scan_for_skills(&root_dir, &root_dir, owner, name, branch, 0, &mut skills)?;
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
        _branch: &str,
        depth: usize,
        skills: &mut Vec<DiscoverableSkill>,
    ) -> Result<(), AppError> {
        if !dir.is_dir() || depth > Self::MAX_SCAN_DEPTH {
            return Ok(());
        }
        let skill_md = dir.join("SKILL.md");
        if skill_md.exists() {
            let dir_name = dir
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown");
            let (_, description) =
                Self::parse_skill_md(&skill_md).unwrap_or((dir_name.to_string(), None));
            let rel = dir.strip_prefix(base_path).unwrap_or(dir);
            let key = rel.to_string_lossy().to_string();
            skills.push(DiscoverableSkill {
                key,
                name: dir_name.to_string(),
                description,
                directory: dir_name.to_string(),
                repo_owner: owner.to_string(),
                repo_name: repo.to_string(),
                installed: false,
                installs: None,
            });
        }
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                    if crate::config::SKIP_DIRS.contains(&file_name) {
                        continue;
                    }
                    Self::scan_for_skills(
                        &path,
                        base_path,
                        owner,
                        repo,
                        _branch,
                        depth + 1,
                        skills,
                    )?;
                }
            }
        }
        Ok(())
    }

    pub async fn discover_from_repo_capped(
        owner: &str,
        name: &str,
        branch: &str,
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
        Ok(c.skills.iter().find(|s| s.id == skill_id).cloned())
    }

    /// Scan a single skill directory and return a cache entry for it.
    /// Used for incremental cache updates after install/update.
    /// Looks in SSOT first, then agent directories, to handle both origins.
    pub fn scan_single_skill(skill_dir: &str) -> Result<SkillCacheEntry, AppError> {
        let mut hash_cache = Self::load_hash_cache();
        let result = Self::scan_single_skill_with_cache(skill_dir, &mut hash_cache)?;
        Self::save_hash_cache(&hash_cache);
        Ok(result)
    }

    /// Core scan logic with shared hash cache for bulk operations.
    fn scan_single_skill_with_cache(
        skill_dir: &str,
        hash_cache: &mut HashMap<String, (i64, String)>,
    ) -> Result<SkillCacheEntry, AppError> {
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
        let name = skill_dir
            .rsplit('/')
            .next()
            .unwrap_or(skill_dir)
            .to_string();
        let parsed_name = CliService::strip_ansi(&parsed_name);
        let yaml_name = if parsed_name == name {
            None
        } else {
            Some(parsed_name)
        };

        let content_hash = home_path
            .as_ref()
            .and_then(|p| Self::compute_content_hash_cached(p, hash_cache));
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
            installed_at,
            updated_at,
        })
    }

    /// Insert or replace a cache entry and persist.
    pub fn upsert_cache_entry(
        cache: &RwLock<SkillCache>,
        entry: SkillCacheEntry,
    ) -> Result<(), AppError> {
        let mut c = cache
            .write()
            .map_err(|e| AppError::Parse(format!("Cache lock: {e}")))?;
        if let Some(existing) = c.skills.iter_mut().find(|s| s.id == entry.id) {
            let installed_at = existing.installed_at;
            *existing = entry;
            existing.installed_at = installed_at;
        } else {
            c.skills.push(entry);
        }
        c.save()
    }

    /// Remove a cache entry by skill_id and persist.
    pub fn remove_cache_entry(cache: &RwLock<SkillCache>, skill_id: &str) -> Result<(), AppError> {
        let mut c = cache
            .write()
            .map_err(|e| AppError::Parse(format!("Cache lock: {e}")))?;
        c.skills.retain(|s| s.id != skill_id);
        c.save()
    }

    /// Scan multiple skill directories with a shared hash cache for efficiency.
    /// Returns (entries, failed_dirs) — caller decides how to handle failures.
    pub fn scan_skills_batch(skill_dirs: &[String]) -> (Vec<SkillCacheEntry>, Vec<String>) {
        let mut hash_cache = Self::load_hash_cache();
        let mut entries = Vec::with_capacity(skill_dirs.len());
        let mut failed = Vec::new();
        for dir in skill_dirs {
            match Self::scan_single_skill_with_cache(dir, &mut hash_cache) {
                Ok(entry) => entries.push(entry),
                Err(_) => failed.push(dir.clone()),
            }
        }
        Self::save_hash_cache(&hash_cache);
        (entries, failed)
    }

    // ──────────────────────────────────────────────
    //  Visible agents / settings
    // ──────────────────────────────────────────────

    pub fn get_visible_agents(settings: &Settings) -> HashMap<String, bool> {
        let mut map: HashMap<String, bool> = config::all_agents()
            .iter()
            .map(|a| (a.id.clone(), config::default_visibility(&a.id)))
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

    // ──────────────────────────────────────────────
    //  Symlink status
    // ──────────────────────────────────────────────

    pub fn get_symlink_status(cache: &SkillCache, settings: &Settings) -> Vec<SymlinkStatus> {
        let agents_dir = config::get_agents_skills_dir();
        let visible_agents = Self::get_visible_agents(settings);
        let mut statuses = Vec::new();

        for skill in &cache.skills {
            let target_path = if let Some(ref hp) = skill.home_path {
                std::path::PathBuf::from(hp)
            } else {
                agents_dir.join(&skill.directory)
            };
            let target_path = std::fs::canonicalize(&target_path).unwrap_or(target_path);
            for agent in config::all_agents() {
                if !visible_agents
                    .get(&agent.id)
                    .copied()
                    .unwrap_or_else(|| config::default_visibility(&agent.id))
                {
                    continue;
                }
                let symlink_path = agent.skills_dir.join(&skill.directory);
                let exists = symlink_path.exists();
                let is_valid = if exists {
                    symlink_target_matches(&symlink_path, &target_path)
                } else {
                    false
                };
                statuses.push(SymlinkStatus {
                    skill_id: skill.id.clone(),
                    skill_name: skill.name.clone(),
                    agent: agent.id.clone(),
                    symlink_path: symlink_path.display().to_string(),
                    target_path: target_path.display().to_string(),
                    exists,
                    is_valid,
                });
            }
        }
        statuses
    }

    // ──────────────────────────────────────────────
    //  Symlink toggle
    // ──────────────────────────────────────────────

    fn safe_remove(path: &std::path::Path) -> Result<(), AppError> {
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

    pub fn toggle_symlink(
        skill_dir: &str,
        home_path: &str,
        agent: &str,
        enabled: bool,
    ) -> Result<(), AppError> {
        let target_path = std::path::PathBuf::from(home_path);
        let agent_skills_dir = config::get_agent_skills_dir(agent)
            .ok_or_else(|| AppError::NotFound(format!("Unknown agent: {agent}")))?;
        let symlink_path = agent_skills_dir.join(skill_dir);

        if enabled {
            if !target_path.exists() {
                return Err(AppError::NotFound(format!(
                    "Target path does not exist: {}",
                    target_path.display()
                )));
            }
            if symlink_path.exists() && !is_symlink_or_junction(&symlink_path) {
                return Ok(());
            }
            Self::safe_remove(&symlink_path)?;
            std::fs::create_dir_all(&agent_skills_dir)
                .map_err(|e| error::io(&agent_skills_dir, e))?;
            #[cfg(unix)]
            std::os::unix::fs::symlink(&target_path, &symlink_path)
                .map_err(|e| error::io(&symlink_path, e))?;
            #[cfg(windows)]
            {
                if target_path.is_dir() {
                    // Junction points do not require admin privileges or Developer Mode.
                    junction::create(&target_path, &symlink_path)
                        .map_err(|e| error::io(&symlink_path, e))?;
                } else {
                    std::os::windows::fs::symlink_file(&target_path, &symlink_path)
                        .map_err(|e| error::io(&symlink_path, e))?;
                }
            }
        } else {
            if symlink_path.exists() && !is_symlink_or_junction(&symlink_path) {
                return Err(AppError::BadRequest(format!(
                    "Cannot remove: {} is a real directory, not a symlink.",
                    symlink_path.display()
                )));
            }
            Self::safe_remove(&symlink_path)?;
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

        // Delete the entity directory
        if home.exists() && !is_symlink_or_junction(home) {
            std::fs::remove_dir_all(home).map_err(|e| crate::error::io(home, e))?;
        }

        // Clean up symlinks in all agent directories
        for agent in config::all_agents() {
            let symlink_path = agent.skills_dir.join(skill_name);
            if is_symlink_or_junction(&symlink_path) {
                let _ = Self::safe_remove(&symlink_path);
            }
        }

        Ok(())
    }

    pub fn remove_agent_symlinks(agent: &str) -> Result<(), AppError> {
        let agent_skills_dir = config::get_agent_skills_dir(agent)
            .ok_or_else(|| AppError::NotFound(format!("Unknown agent: {agent}")))?;
        if !agent_skills_dir.exists() {
            return Ok(());
        }
        let entries =
            std::fs::read_dir(&agent_skills_dir).map_err(|e| error::io(&agent_skills_dir, e))?;
        for entry in entries.flatten() {
            let path = entry.path();
            if is_symlink_or_junction(&path) && Self::safe_remove(&path).is_err() {
                // Intentionally ignore removal failures for orphaned symlinks
            }
        }
        Ok(())
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
            c.skills
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

        // Refuse to merge if content differs (safety check — frontend should
        // already prevent this, but backend must enforce it too).
        let hashes: Vec<&str> = entries
            .iter()
            .filter_map(|e| e.content_hash.as_deref())
            .collect();
        if !hashes.is_empty() && !hashes.iter().all(|h| *h == hashes[0]) {
            return Err(AppError::BadRequest(format!(
                "Cannot merge: skills named '{skill_name}' have different content. Please resolve manually."
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
                    let _ = Self::toggle_symlink(
                        skill_name,
                        &dest_dir.to_string_lossy(),
                        agent_id,
                        true,
                    );
                }
            }
        }

        // Phase 3: Update cache — remove all old entries, then re-scan
        {
            let mut c = cache
                .write()
                .map_err(|e| AppError::Parse(format!("Cache lock: {e}")))?;
            c.skills.retain(|s| s.name != skill_name);
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

    /// Build a file tree for a skill directory, returning the root nodes.
    /// Searches SSOT first, then agent directories (same fallback as read_skill_md).
    pub fn list_skill_files(directory: &str) -> Result<Vec<SkillFileNode>, AppError> {
        crate::commands::skill::validate_skill_directory(directory)
            .map_err(AppError::BadRequest)?;

        // Build candidate directories — SSOT first, then agent dirs
        let mut candidates: Vec<std::path::PathBuf> = Vec::new();
        let agents_dir = config::get_agents_skills_dir();
        candidates.push(agents_dir.join(directory));
        for agent in config::all_agents() {
            candidates.push(agent.skills_dir.join(directory));
        }

        for skill_dir in &candidates {
            if skill_dir.is_dir() {
                let mut nodes = Vec::new();
                Self::build_file_tree(skill_dir, &mut nodes);
                Self::sort_nodes(&mut nodes);
                return Ok(nodes);
            }
        }

        Err(AppError::NotFound(format!(
            "Skill directory not found for: {}",
            directory
        )))
    }

    fn build_file_tree(dir: &std::path::Path, nodes: &mut Vec<SkillFileNode>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };

        for entry in entries.flatten() {
            let path = entry.path();

            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if crate::config::SKIP_DIRS.contains(&name) {
                    continue;
                }
            }

            if path.is_dir() && !is_symlink_or_junction(&path) {
                let mut children = Vec::new();
                Self::build_file_tree(&path, &mut children);
                Self::sort_nodes(&mut children);

                nodes.push(SkillFileNode {
                    name: path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("")
                        .to_string(),
                    path: path.to_str().unwrap_or("").to_string(),
                    is_dir: true,
                    is_skill_md: false,
                    children: Some(children),
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
                    path: path.to_str().unwrap_or("").to_string(),
                    is_dir: false,
                    children: None,
                });
            }
        }
    }

    fn sort_nodes(nodes: &mut [SkillFileNode]) {
        nodes.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        });
    }
}

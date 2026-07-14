//! Native Rust reimplementation of the `skills` CLI add / remove / update
//! subcommands that Skill Zoo previously shelled out to via `npx`.
//! Based on <https://github.com/vercel-labs/skills> v1.5.3 (MIT).

use crate::config;
use crate::error::{classify_download_error, AppError};
use crate::services::github;
use crate::services::lock::{SkillLock, SkillLockEntry};
use crate::services::skill::is_symlink_or_junction;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::Emitter;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TreeEntry {
    path: String,
    #[serde(rename = "type")]
    entry_type: String,
    sha: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoTreeResponse {
    sha: String,
    tree: Vec<TreeEntry>,
}

pub struct UpdateResult {
    pub success_count: usize,
    pub fail_count: usize,
    pub errors: Vec<String>,
    pub updated: Vec<String>,
}

#[derive(Clone)]
pub struct KnownSkillUpdate {
    pub name: String,
    pub entry: SkillLockEntry,
    pub latest_sha: String,
}

struct RepoZipRequest {
    owner: String,
    repo: String,
    branch: Option<String>,
    force: bool,
}

struct KnownUpdateRepoGroup {
    owner: String,
    repo: String,
    branch: Option<String>,
    skills: Vec<KnownSkillUpdate>,
}

type RepoUpdateKey = (String, String, Option<String>);
type RepoLockEntries = Vec<(String, SkillLockEntry)>;

pub struct CliService;

impl CliService {
    // ─── Add / Install ──────────────────────────────────────────────

    /// Install skills from a GitHub repository.
    ///
    /// Downloads the repo as ZIP, discovers skills, copies them into
    /// `~/.agents/skills/<name>/`, and updates the lock file.
    pub async fn add_skills(
        repo_url: &str,
        skills: &[String],
        preflight_agent_dirs: &[PathBuf],
    ) -> Result<Vec<String>, AppError> {
        let install_all = skills.is_empty() || skills.iter().any(|s| s == "*");

        let repo_ref = github::parse_repo_ref(repo_url)?;
        let (owner, repo, branch) = (repo_ref.owner, repo_ref.name, repo_ref.branch);

        let (_temp_dir, clone_path) =
            Self::download_repo_zip(&owner, &repo, branch.as_deref(), false).await?;

        // Discover skills in the cloned tree
        let discovered = Self::discover_skills_in_tree(&clone_path);
        if discovered.is_empty() {
            return Err(AppError::Cli("No skills found in the repository.".into()));
        }

        // Filter by requested names
        let to_install =
            Self::select_discovered_skills(&clone_path, &discovered, skills, install_all);

        if to_install.is_empty() {
            return Err(AppError::Cli(format!(
                "No matching skills found. Available: {}",
                discovered
                    .iter()
                    .map(|(n, _, _)| n.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            )));
        }

        let ssot_dir = config::get_agents_skills_dir();
        Self::ensure_install_destinations_available(
            &to_install
                .iter()
                .map(|(name, _, _)| name.as_str())
                .collect::<Vec<_>>(),
            &ssot_dir,
            preflight_agent_dirs,
        )?;
        std::fs::create_dir_all(&ssot_dir).map_err(AppError::Io)?;

        let mut installed_skills: Vec<(String, String)> = Vec::new();
        let mut errors: Vec<String> = Vec::new();

        for (skill_name, _description, skill_path) in &to_install {
            let dest_dir = ssot_dir.join(skill_name);
            let tmp = match Self::create_temp_dir(&ssot_dir, skill_name, "install") {
                Ok(tmp) => tmp,
                Err(error) => {
                    errors.push(format!("{skill_name}: {error}"));
                    continue;
                }
            };
            let tmp_dir = tmp.path().to_path_buf();

            match Self::copy_dir_contents(skill_path, &tmp_dir) {
                Ok(_) => {
                    if std::fs::symlink_metadata(&dest_dir).is_ok() {
                        errors.push(format!(
                            "{skill_name}: destination appeared during installation"
                        ));
                        continue;
                    }
                    if let Err(error) = std::fs::rename(&tmp_dir, &dest_dir) {
                        errors.push(format!("{skill_name}: {error}"));
                        continue;
                    }
                    let _ = tmp.keep();
                    let lock_skill_path = Self::lock_skill_path(&clone_path, skill_path)
                        .unwrap_or_else(|| format!("skills/{skill_name}"));
                    installed_skills.push((skill_name.clone(), lock_skill_path));
                }
                Err(e) => {
                    errors.push(format!("{skill_name}: {e}"));
                }
            }
        }

        if !errors.is_empty() {
            for (skill_name, _) in &installed_skills {
                let _ = std::fs::remove_dir_all(ssot_dir.join(skill_name));
            }
            return Err(AppError::Cli(format!(
                "Installation failed: {}",
                errors.join(", ")
            )));
        }

        // Persist metadata to lock file, including folder SHAs so future
        // update checks can detect changes even after a fresh install.
        //
        // Fetch the repo tree to get the per-folder SHA. If that fails,
        // commit_sha stays None and check_skill_updates will
        // auto-baseline on the next successful check (one-cycle degradation).
        let folder_shas: std::collections::HashMap<String, Option<String>> =
            match Self::fetch_repo_tree(&owner, &repo, branch.as_deref()).await {
                Ok(Some(tree)) => installed_skills
                    .iter()
                    .map(|(name, skill_path)| {
                        (
                            name.clone(),
                            Self::get_folder_sha_from_tree(&tree, skill_path),
                        )
                    })
                    .collect(),
                Ok(None) => {
                    eprintln!(
                        "install: tree not found for {}, \
                         update detection will auto-baseline on next check",
                        Self::repo_ref_label(&owner, &repo, branch.as_deref())
                    );
                    std::collections::HashMap::new()
                }
                Err(e) => {
                    eprintln!(
                        "install: tree fetch failed for {}: {e}, \
                         update detection will auto-baseline on next check",
                        Self::repo_ref_label(&owner, &repo, branch.as_deref())
                    );
                    std::collections::HashMap::new()
                }
            };
        if let Err(error) = Self::update_lock_after_install(
            &installed_skills,
            &owner,
            &repo,
            branch.as_deref(),
            &folder_shas,
        ) {
            for (skill_name, _) in &installed_skills {
                let _ = std::fs::remove_dir_all(ssot_dir.join(skill_name));
            }
            return Err(error);
        }

        Ok(installed_skills
            .iter()
            .map(|(name, _)| name.clone())
            .collect())
    }

    fn ensure_install_destinations_available(
        skill_names: &[&str],
        ssot_dir: &std::path::Path,
        agent_dirs: &[PathBuf],
    ) -> Result<(), AppError> {
        let mut seen = std::collections::BTreeSet::new();
        let mut duplicates = std::collections::BTreeSet::new();
        for name in skill_names.iter().copied() {
            if !seen.insert(name) {
                duplicates.insert(name);
            }
        }

        if !duplicates.is_empty() {
            return Err(AppError::BadRequest(format!(
                "Cannot install because multiple selected skills target the same destination: {}",
                duplicates.into_iter().collect::<Vec<_>>().join(", ")
            )));
        }

        let conflicts: Vec<&str> = skill_names
            .iter()
            .copied()
            .filter(|name| {
                std::fs::symlink_metadata(ssot_dir.join(name)).is_ok()
                    || agent_dirs
                        .iter()
                        .any(|dir| std::fs::symlink_metadata(dir.join(name)).is_ok())
            })
            .collect();

        if conflicts.is_empty() {
            Ok(())
        } else {
            Err(AppError::BadRequest(format!(
                "Cannot install because skill destination already exists: {}. Remove, rename, or archive the existing skill first.",
                conflicts.join(", ")
            )))
        }
    }

    fn create_temp_dir(
        parent: &std::path::Path,
        name: &str,
        action: &str,
    ) -> Result<tempfile::TempDir, AppError> {
        let leaf = Path::new(name)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("skill");
        tempfile::Builder::new()
            .prefix(&format!(".{leaf}.{action}."))
            .tempdir_in(parent)
            .map_err(AppError::Io)
    }

    // ─── Update ─────────────────────────────────────────────────────

    /// Update a pre-filtered set of installed skills.
    ///
    /// Used by the command layer when it needs filesystem/cache context, for
    /// example excluding agent-origin skills from "update all".
    pub async fn update_skill_names(skill_names: &[String]) -> Result<UpdateResult, AppError> {
        let lock = SkillLock::read()?;
        let to_update: Vec<(String, SkillLockEntry)> = skill_names
            .iter()
            .filter_map(|name| {
                lock.skills
                    .get(name)
                    .cloned()
                    .map(|entry| (name.clone(), entry))
            })
            .collect();

        Self::update_skill_entries(to_update).await
    }

    async fn update_skill_entries(
        to_update: Vec<(String, SkillLockEntry)>,
    ) -> Result<UpdateResult, AppError> {
        if to_update.is_empty() {
            return Ok(UpdateResult {
                success_count: 0,
                fail_count: 0,
                errors: vec![],
                updated: vec![],
            });
        }

        let mut errors: Vec<String> = Vec::new();
        let report_missing_baseline = to_update.len() == 1;

        // Group skills by (owner, repo, branch/default) so each repo is fetched only once
        let mut by_repo: std::collections::HashMap<RepoUpdateKey, RepoLockEntries> =
            std::collections::HashMap::new();
        for (name, entry) in &to_update {
            // Entries without a stored folder SHA cannot be safely compared.
            // The update loop already skips them after a successful tree fetch;
            // skipping them here also prevents stale legacy lock entries from
            // turning unrelated repo errors into "update all" failures.
            if entry.commit_sha.is_none() {
                if report_missing_baseline {
                    errors.push(format!(
                        "{name}: Missing update baseline. Check updates before updating this skill."
                    ));
                }
                continue;
            }
            if entry.effective_url().is_none() {
                continue;
            }
            let (owner, repo, branch) = match Self::update_repo_info(entry) {
                Ok(info) => info,
                Err(e) => {
                    errors.push(format!("{name}: {e}"));
                    continue;
                }
            };
            by_repo
                .entry((owner, repo, branch))
                .or_default()
                .push((name.clone(), entry.clone()));
        }

        let mut known_updates = Vec::new();

        for ((owner, repo, branch), skills) in &by_repo {
            let tree = match Self::fetch_repo_tree(owner, repo, branch.as_deref()).await {
                Ok(Some(t)) => t,
                Ok(None) => {
                    errors.extend(skills.iter().map(|(name, _)| {
                        format!(
                            "{name}: repository or branch not found for {}",
                            Self::repo_ref_label(owner, repo, branch.as_deref())
                        )
                    }));
                    continue;
                }
                Err(e) => {
                    errors.extend(skills.iter().map(|(name, _)| format!("{name}: {e}")));
                    continue;
                }
            };

            for (name, entry) in skills {
                match Self::known_update_from_tree(
                    name,
                    entry,
                    &tree,
                    owner,
                    repo,
                    branch.as_deref(),
                ) {
                    Ok(Some(update)) => known_updates.push(update),
                    Ok(None) => {}
                    Err(error) => errors.push(error),
                }
            }
        }

        let mut result = Self::update_known_skill_entries(known_updates).await?;
        result.errors.extend(errors);
        result.fail_count = result.errors.len();
        Ok(result)
    }

    fn known_update_from_tree(
        name: &str,
        entry: &SkillLockEntry,
        tree: &RepoTreeResponse,
        owner: &str,
        repo: &str,
        branch: Option<&str>,
    ) -> Result<Option<KnownSkillUpdate>, String> {
        let old_sha = entry.commit_sha.as_deref();
        let skill_path = entry.skill_path.as_deref().unwrap_or("");
        let Some(new_sha) = Self::get_folder_sha_from_tree(tree, skill_path) else {
            return Err(format!(
                "{name}: Skill path no longer exists in {}: {}",
                Self::repo_ref_label(owner, repo, branch),
                Self::normalize_skill_path(skill_path)
            ));
        };

        // Only reinstall when we can confirm the SHA actually changed
        match old_sha {
            Some(old) if old != new_sha => Ok(Some(KnownSkillUpdate {
                name: name.to_string(),
                entry: entry.clone(),
                latest_sha: new_sha,
            })),
            _ => Ok(None),
        }
    }

    pub async fn update_known_skill_entries(
        to_update: Vec<KnownSkillUpdate>,
    ) -> Result<UpdateResult, AppError> {
        if to_update.is_empty() {
            return Ok(UpdateResult {
                success_count: 0,
                fail_count: 0,
                errors: vec![],
                updated: vec![],
            });
        }

        let (groups, mut errors) = Self::group_known_updates_by_repo(to_update);
        let mut updated: Vec<String> = Vec::new();
        let mut updated_shas: Vec<(String, String)> = Vec::new();

        for group in &groups {
            let request =
                Self::update_download_request(&group.owner, &group.repo, group.branch.as_deref());
            let (_temp_dir, clone_path) = match Self::download_repo_zip(
                &request.owner,
                &request.repo,
                request.branch.as_deref(),
                request.force,
            )
            .await
            {
                Ok(download) => download,
                Err(e) => {
                    errors.extend(
                        group
                            .skills
                            .iter()
                            .map(|skill| format!("{}: {e}", skill.name)),
                    );
                    continue;
                }
            };

            let discovered = Self::discover_skills_in_tree(&clone_path);
            for skill in &group.skills {
                match Self::reinstall_skill_from_discovered(
                    &skill.name,
                    &group.owner,
                    &group.repo,
                    &clone_path,
                    skill.entry.skill_path.as_deref(),
                    &discovered,
                ) {
                    Ok(()) => {
                        updated.push(skill.name.clone());
                        updated_shas.push((skill.name.clone(), skill.latest_sha.clone()));
                    }
                    Err(e) => errors.push(format!("{}: {e}", skill.name)),
                }
            }
        }

        if !updated_shas.is_empty() {
            let now = chrono::Utc::now().to_rfc3339();
            SkillLock::update(|lock| {
                for (name, sha) in &updated_shas {
                    if let Some(entry) = lock.skills.get_mut(name) {
                        entry.updated_at = Some(now.clone());
                        entry.commit_sha = Some(sha.clone());
                    }
                }
                Ok(())
            })?;
        }

        Ok(UpdateResult {
            success_count: updated.len(),
            fail_count: errors.len(),
            errors,
            updated,
        })
    }

    fn group_known_updates_by_repo(
        to_update: Vec<KnownSkillUpdate>,
    ) -> (Vec<KnownUpdateRepoGroup>, Vec<String>) {
        let mut groups: Vec<KnownUpdateRepoGroup> = Vec::new();
        let mut errors = Vec::new();

        for update in to_update {
            let (owner, repo, branch) = match Self::update_repo_info(&update.entry) {
                Ok(info) => info,
                Err(e) => {
                    errors.push(format!("{}: {e}", update.name));
                    continue;
                }
            };

            if let Some(group) = groups
                .iter_mut()
                .find(|group| group.owner == owner && group.repo == repo && group.branch == branch)
            {
                group.skills.push(update);
            } else {
                groups.push(KnownUpdateRepoGroup {
                    owner,
                    repo,
                    branch,
                    skills: vec![update],
                });
            }
        }

        (groups, errors)
    }

    // ─── Update check ────────────────────────────────────────────────

    /// Fetch the repo tree from GitHub's Trees API.
    /// Returns the tree data (with all folder SHAs), or None on rate-limit/error.
    pub async fn fetch_repo_tree(
        owner: &str,
        repo: &str,
        branch: Option<&str>,
    ) -> Result<Option<RepoTreeResponse>, AppError> {
        let url = format!(
            "https://api.github.com/repos/{owner}/{repo}/git/trees/{}?recursive=1",
            urlencoding::encode(branch.unwrap_or("HEAD"))
        );
        let client = config::http_client();

        let resp = client
            .get(&url)
            .header("Accept", "application/vnd.github.v3+json")
            .timeout(std::time::Duration::from_secs(30))
            .send()
            .await
            .map_err(|e| classify_download_error(format!("{owner}/{repo}"), e))?;

        match resp.status().as_u16() {
            403 | 429 => Err(AppError::RateLimited(format!("{owner}/{repo}"))),
            200 => {
                let json: RepoTreeResponse = resp.json().await.map_err(|e| {
                    AppError::Parse(format!("Invalid tree response from GitHub: {e}"))
                })?;
                Ok(Some(json))
            }
            _ => Ok(None), // repo not found, branch not found, etc. — skip
        }
    }

    /// Get the folder SHA for a specific path from a repo tree.
    pub fn get_folder_sha_from_tree(tree: &RepoTreeResponse, path: &str) -> Option<String> {
        let normalized_path = Self::normalize_skill_path(path);

        // Root-level skill
        if normalized_path.is_empty() {
            return Some(tree.sha.clone());
        }

        // Find matching tree entry
        tree.tree
            .iter()
            .find(|e| e.entry_type == "tree" && e.path == normalized_path)
            .map(|e| e.sha.clone())
    }

    // ─── Internal helpers ───────────────────────────────────────────

    fn sanitize_branch(branch: &str) -> String {
        branch.replace(['/', '\\'], "--")
    }

    fn repo_ref_label(owner: &str, repo: &str, branch: Option<&str>) -> String {
        match branch {
            Some(branch) => format!("{owner}/{repo}@{branch}"),
            None => format!("{owner}/{repo}@default"),
        }
    }

    fn cache_ref_key(branch: Option<&str>) -> String {
        match branch {
            Some(branch) => format!("branch--{}", Self::sanitize_branch(branch)),
            None => "default".to_string(),
        }
    }

    fn archive_zip_url(owner: &str, repo: &str, branch: Option<&str>) -> String {
        match branch {
            Some(branch) => {
                format!("https://github.com/{owner}/{repo}/archive/refs/heads/{branch}.zip")
            }
            None => format!("https://github.com/{owner}/{repo}/archive/HEAD.zip"),
        }
    }

    pub fn update_repo_info(
        entry: &SkillLockEntry,
    ) -> Result<(String, String, Option<String>), AppError> {
        let source_url = entry.effective_url().ok_or_else(|| {
            AppError::BadRequest("Skill lock entry has no GitHub source URL".into())
        })?;
        let repo_ref = github::parse_repo_ref(&source_url)?;
        let branch = entry.branch.clone().or(repo_ref.branch);
        let (owner, repo) = (repo_ref.owner, repo_ref.name);
        Ok((owner, repo, branch))
    }

    fn update_download_request(owner: &str, repo: &str, branch: Option<&str>) -> RepoZipRequest {
        RepoZipRequest {
            owner: owner.to_string(),
            repo: repo.to_string(),
            branch: branch.map(str::to_string),
            force: true,
        }
    }

    fn normalize_skill_path(path: &str) -> String {
        // Normalize to forward slashes for cross-platform comparability.
        path.replace('\\', "/")
            .trim_end_matches("/SKILL.md")
            .trim_end_matches("SKILL.md")
            .trim_end_matches('/')
            .to_string()
    }

    fn lock_skill_path(repo_root: &Path, skill_path: &Path) -> Option<String> {
        let relative = skill_path.strip_prefix(repo_root).ok()?;
        let path = relative.to_string_lossy().replace('\\', "/");
        Some(Self::normalize_skill_path(&path))
    }

    fn select_discovered_skills<'a>(
        repo_root: &Path,
        discovered: &'a [(String, String, PathBuf)],
        requested: &[String],
        install_all: bool,
    ) -> Vec<&'a (String, String, PathBuf)> {
        if install_all {
            return discovered.iter().collect();
        }

        discovered
            .iter()
            .filter(|(name, _, path)| {
                requested
                    .iter()
                    .any(|selector| Self::matches_discovered_skill(repo_root, selector, name, path))
            })
            .collect()
    }

    fn matches_discovered_skill(
        repo_root: &Path,
        selector: &str,
        name: &str,
        skill_path: &Path,
    ) -> bool {
        let selector = Self::normalize_skill_path(selector);
        if selector.is_empty() {
            return false;
        }
        if selector.eq_ignore_ascii_case(name) {
            return true;
        }

        Self::lock_skill_path(repo_root, skill_path).as_deref() == Some(selector.as_str())
    }

    pub fn cache_zip_file_name(owner: &str, repo: &str, branch: Option<&str>) -> String {
        format!("{owner}--{repo}--{}.zip", Self::cache_ref_key(branch))
    }

    pub fn cache_zip_path(owner: &str, repo: &str, branch: Option<&str>) -> PathBuf {
        config::get_repo_zip_cache_dir().join(Self::cache_zip_file_name(owner, repo, branch))
    }

    pub async fn ensure_cached_zip(
        owner: &str,
        repo: &str,
        branch: Option<&str>,
        force: bool,
    ) -> Result<PathBuf, AppError> {
        Self::ensure_cached_zip_with_progress(owner, repo, branch, force, None).await
    }

    pub async fn ensure_cached_zip_with_progress(
        owner: &str,
        repo: &str,
        branch: Option<&str>,
        force: bool,
        app_handle: Option<&tauri::AppHandle>,
    ) -> Result<PathBuf, AppError> {
        let cache_path = Self::cache_zip_path(owner, repo, branch);

        if force {
            let _ = std::fs::remove_file(&cache_path);
        } else if let Ok(metadata) = std::fs::metadata(&cache_path) {
            if let Ok(modified) = metadata.modified() {
                if let Ok(elapsed) = modified.elapsed() {
                    if elapsed.as_secs() < 86400 {
                        return Ok(cache_path);
                    }
                }
            }
        }

        let cache_dir = config::get_repo_zip_cache_dir();
        std::fs::create_dir_all(&cache_dir).map_err(AppError::Io)?;

        let url = Self::archive_zip_url(owner, repo, branch);
        let repo_id = format!("{owner}/{repo}");
        let client = config::http_client();
        let response = client
            .get(&url)
            .send()
            .await
            .map_err(|e| classify_download_error(repo_id.clone(), e))?;

        if !response.status().is_success() {
            match response.status().as_u16() {
                403 | 429 => return Err(AppError::DownloadUnavailable(repo_id)),
                404 => return Err(AppError::RepoNotFound(repo_id)),
                _ => {}
            }
            return Err(AppError::Cli(format!(
                "Failed to download {owner}/{repo}: HTTP {}",
                response.status()
            )));
        }

        let total_size = response.content_length();
        let mut downloaded: u64 = 0;
        let tmp_path = cache_dir.join(format!(
            ".{owner}--{repo}--{}.zip.tmp",
            Self::cache_ref_key(branch)
        ));
        let mut file = std::fs::File::create(&tmp_path).map_err(AppError::Io)?;

        use futures::StreamExt;
        let mut stream = response.bytes_stream();
        let mut emit_threshold: u64 = 0;

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| classify_download_error(repo_id.clone(), e))?;
            downloaded += chunk.len() as u64;

            if downloaded > config::MAX_DOWNLOAD_BYTES {
                let _ = std::fs::remove_file(&tmp_path);
                return Err(AppError::RepoTooLarge {
                    repo: repo_id,
                    max_mb: config::MAX_DOWNLOAD_BYTES / (1024 * 1024),
                });
            }

            use std::io::Write;
            file.write_all(&chunk).map_err(AppError::Io)?;

            if let Some(handle) = app_handle {
                if downloaded >= emit_threshold {
                    let _ = handle.emit(
                        "repo-download-progress",
                        serde_json::json!({
                            "owner": owner,
                            "repo": repo,
                            "downloaded": downloaded,
                            "total": total_size,
                        }),
                    );
                    emit_threshold = downloaded + 256 * 1024; // emit every ~256KB
                }
            }
        }

        // Drop file handle before rename (required on Windows)
        drop(file);
        std::fs::rename(&tmp_path, &cache_path).map_err(AppError::Io)?;

        Ok(cache_path)
    }

    /// Download a GitHub repo as ZIP and extract to a temp directory.
    /// Returns (TempDir, root_path) — TempDir must stay alive while root_path is used.
    async fn download_repo_zip(
        owner: &str,
        repo: &str,
        branch: Option<&str>,
        force: bool,
    ) -> Result<(tempfile::TempDir, PathBuf), AppError> {
        let zip_path = Self::ensure_cached_zip(owner, repo, branch, force).await?;

        let file = std::fs::File::open(&zip_path).map_err(AppError::Io)?;
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|e| AppError::Cli(format!("Invalid archive: {e}")))?;

        let temp_dir = tempfile::tempdir()?;
        archive
            .extract(temp_dir.path())
            .map_err(|e| AppError::Cli(format!("Failed to extract archive: {e}")))?;

        let root_dir = std::fs::read_dir(temp_dir.path())
            .map_err(AppError::Io)?
            .flatten()
            .find(|e| e.path().is_dir())
            .map(|e| e.path())
            .ok_or_else(|| AppError::Cli("Archive has no root directory".into()))?;

        Ok((temp_dir, root_dir))
    }

    /// Walk a directory tree and find every directory containing a SKILL.md.
    fn discover_skills_in_tree(root: &PathBuf) -> Vec<(String, String, PathBuf)> {
        let mut skills = Vec::new();
        Self::scan_dir(root, root, &mut skills, 0);
        skills
    }

    fn scan_dir(
        dir: &PathBuf,
        _root: &PathBuf,
        skills: &mut Vec<(String, String, PathBuf)>,
        depth: usize,
    ) {
        if depth > 20 || !dir.is_dir() {
            return;
        }

        let skill_md = dir.join("SKILL.md");
        if skill_md.exists() {
            let name = dir
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string();
            skills.push((name, String::new(), dir.clone()));
        }

        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if crate::config::SKIP_DIRS.contains(&file_name) {
                continue;
            }
            Self::scan_dir(&path, _root, skills, depth + 1);
        }
    }

    /// Recursively copy directory contents, skipping hidden / VCS /
    /// Python cache directories and broken symlinks.
    fn copy_dir_contents(src: &PathBuf, dest: &PathBuf) -> Result<(), AppError> {
        std::fs::create_dir_all(dest).map_err(AppError::Io)?;

        let entries = std::fs::read_dir(src).map_err(AppError::Io)?;

        for entry in entries.flatten() {
            let path = entry.path();
            let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

            if crate::config::SKIP_DIRS.contains(&file_name) {
                continue;
            }

            let dest_path = dest.join(file_name);

            if path.is_dir() {
                Self::copy_dir_contents(&path, &dest_path)?;
            } else if is_symlink_or_junction(&path) {
                // Dereference symlinks — copy the target file instead.
                if let Ok(target) = std::fs::read_link(&path) {
                    if target.exists() {
                        std::fs::copy(&target, &dest_path).map_err(AppError::Io)?;
                    }
                }
            } else {
                std::fs::copy(&path, &dest_path).map_err(AppError::Io)?;
            }
        }

        Ok(())
    }

    // ─── Lock file helpers ──────────────────────────────────────────

    fn update_lock_after_install(
        skills: &[(String, String)],
        owner: &str,
        repo: &str,
        branch: Option<&str>,
        folder_shas: &std::collections::HashMap<String, Option<String>>,
    ) -> Result<(), AppError> {
        let now = chrono::Utc::now().to_rfc3339();
        let source = format!("{owner}/{repo}");
        let source_url = format!("https://github.com/{owner}/{repo}");

        SkillLock::update(|lock| {
            for (name, skill_path) in skills {
                let existing_installed_at =
                    lock.skills.get(name).and_then(|e| e.installed_at.clone());
                // Prefer freshly fetched folder SHA; fall back to existing lock entry
                let commit_sha = folder_shas
                    .get(name)
                    .and_then(|s| s.clone())
                    .or_else(|| lock.skills.get(name).and_then(|e| e.commit_sha.clone()));

                lock.skills.insert(
                    name.clone(),
                    SkillLockEntry {
                        source: Some(source.clone()),
                        source_type: Some("github".into()),
                        source_url: Some(source_url.clone()),
                        branch: branch.map(str::to_string),
                        skill_path: Some(skill_path.clone()),
                        skill_folder_hash: Some(String::new()),
                        installed_at: Some(existing_installed_at.unwrap_or_else(|| now.clone())),
                        updated_at: Some(now.clone()),
                        commit_sha,
                    },
                );
            }
            Ok(())
        })
    }

    fn reinstall_skill_from_discovered(
        name: &str,
        owner: &str,
        repo: &str,
        repo_root: &Path,
        lock_skill_path: Option<&str>,
        discovered: &[(String, String, PathBuf)],
    ) -> Result<(), AppError> {
        let skill_path =
            Self::find_discovered_skill_for_update(repo_root, name, lock_skill_path, discovered)
                .ok_or_else(|| {
                    let normalized_path = lock_skill_path
                        .map(Self::normalize_skill_path)
                        .unwrap_or_default();
                    if normalized_path.is_empty() {
                        AppError::NotFound(format!("Skill {name} not found in {owner}/{repo}"))
                    } else {
                        AppError::NotFound(format!(
                            "Skill {name} at {normalized_path} not found in {owner}/{repo}"
                        ))
                    }
                })?;

        let ssot_dir = config::get_agents_skills_dir();
        let dest = ssot_dir.join(name);
        let parent = dest.parent().ok_or_else(|| {
            AppError::BadRequest(format!("Invalid skill path: {}", dest.display()))
        })?;
        let tmp = Self::create_temp_dir(parent, name, "update")?;
        let tmp_path = tmp.path().to_path_buf();

        Self::copy_dir_contents(skill_path, &tmp_path)?;
        Self::replace_skill_dir_with_rollback(&dest, &tmp_path)
    }

    fn find_discovered_skill_for_update<'a>(
        repo_root: &Path,
        name: &str,
        lock_skill_path: Option<&str>,
        discovered: &'a [(String, String, PathBuf)],
    ) -> Option<&'a PathBuf> {
        let expected_path = lock_skill_path
            .map(Self::normalize_skill_path)
            .unwrap_or_default();
        if !expected_path.is_empty() {
            return discovered
                .iter()
                .find(|(_, _, path)| {
                    Self::lock_skill_path(repo_root, path).as_deref()
                        == Some(expected_path.as_str())
                })
                .map(|(_, _, path)| path);
        }

        discovered
            .iter()
            .find(|(discovered_name, _, _)| discovered_name == name)
            .map(|(_, _, path)| path)
    }

    fn replace_skill_dir_with_rollback(dest: &Path, tmp: &Path) -> Result<(), AppError> {
        if std::fs::symlink_metadata(dest).is_err() {
            return std::fs::rename(tmp, dest).map_err(AppError::Io);
        }

        let backup = Self::create_backup_path(dest)?;
        std::fs::rename(dest, &backup).map_err(AppError::Io)?;

        match std::fs::rename(tmp, dest) {
            Ok(()) => {
                let _ = std::fs::remove_dir_all(&backup);
                Ok(())
            }
            Err(rename_error) => match std::fs::rename(&backup, dest) {
                Ok(()) => Err(AppError::Io(rename_error)),
                Err(restore_error) => Err(AppError::Cli(format!(
                    "Failed to install updated skill at {}: {rename_error}. Original skill remains at {} and could not be restored automatically: {restore_error}",
                    dest.display(),
                    backup.display()
                ))),
            },
        }
    }

    fn create_backup_path(dest: &Path) -> Result<PathBuf, AppError> {
        Self::unique_backup_path(dest)
    }

    fn unique_backup_path(dest: &Path) -> Result<PathBuf, AppError> {
        let parent = dest.parent().ok_or_else(|| {
            AppError::BadRequest(format!("Invalid skill path: {}", dest.display()))
        })?;
        let leaf = dest
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("skill");
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let pid = std::process::id();

        for attempt in 0..1000 {
            let candidate = parent.join(format!(".{leaf}.backup.{pid}.{nanos}.{attempt}"));
            match std::fs::symlink_metadata(&candidate) {
                Ok(_) => continue,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(candidate),
                Err(e) => return Err(AppError::Io(e)),
            }
        }

        Err(AppError::Io(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            format!("Could not allocate backup path for {}", dest.display()),
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_preflight_rejects_existing_destination_before_writes() {
        let root = tempfile::tempdir().unwrap();
        let ssot = root.path().join("ssot");
        let agent = root.path().join("agent");
        std::fs::create_dir_all(agent.join("existing")).unwrap();

        let result = CliService::ensure_install_destinations_available(
            &["new", "existing"],
            &ssot,
            &[agent],
        );

        assert!(result.is_err());
        assert!(!ssot.exists());
    }

    #[test]
    fn install_preflight_accepts_unused_destinations() {
        let root = tempfile::tempdir().unwrap();
        let ssot = root.path().join("ssot");
        let agent = root.path().join("agent");

        let result =
            CliService::ensure_install_destinations_available(&["one", "two"], &ssot, &[agent]);

        assert!(result.is_ok());
    }

    #[test]
    fn install_preflight_ignores_agent_dirs_outside_requested_scope() {
        let root = tempfile::tempdir().unwrap();
        let ssot = root.path().join("ssot");
        let visible_agent = root.path().join("visible-agent");
        let hidden_agent = root.path().join("hidden-agent");
        std::fs::create_dir_all(hidden_agent.join("demo")).unwrap();

        let result =
            CliService::ensure_install_destinations_available(&["demo"], &ssot, &[visible_agent]);

        assert!(result.is_ok());
    }

    #[test]
    fn install_preflight_rejects_duplicate_destinations_in_selection() {
        let root = tempfile::tempdir().unwrap();
        let ssot = root.path().join("ssot");
        let agent = root.path().join("agent");

        let result =
            CliService::ensure_install_destinations_available(&["demo", "demo"], &ssot, &[agent]);

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("multiple selected skills target the same destination"));
    }

    #[test]
    fn create_install_temp_dir_uses_unique_paths_for_same_skill() {
        let root = tempfile::tempdir().unwrap();
        let ssot = root.path().join("ssot");
        std::fs::create_dir_all(&ssot).unwrap();

        let first = CliService::create_temp_dir(&ssot, "demo", "install").unwrap();
        let second = CliService::create_temp_dir(&ssot, "demo", "install").unwrap();

        assert_ne!(first.path(), second.path());
        assert!(first.path().exists());
        assert!(second.path().exists());
    }

    #[test]
    fn install_temp_dir_keep_preserves_renamed_destination() {
        let root = tempfile::tempdir().unwrap();
        let ssot = root.path().join("ssot");
        std::fs::create_dir_all(&ssot).unwrap();
        let dest = ssot.join("demo");

        let tmp = CliService::create_temp_dir(&ssot, "demo", "install").unwrap();
        std::fs::write(tmp.path().join("SKILL.md"), "# Demo").unwrap();
        std::fs::rename(tmp.path(), &dest).unwrap();
        let _ = tmp.keep();

        assert_eq!(
            std::fs::read_to_string(dest.join("SKILL.md")).unwrap(),
            "# Demo"
        );
    }

    #[test]
    fn update_repo_info_uses_effective_source_url_fallback() {
        let entry = SkillLockEntry {
            source: Some("owner/repo".to_string()),
            source_type: Some("github".to_string()),
            source_url: None,
            branch: Some("main".to_string()),
            skill_path: Some("skills/demo".to_string()),
            skill_folder_hash: None,
            installed_at: None,
            updated_at: None,
            commit_sha: Some("old".to_string()),
        };

        let (owner, repo, branch) = CliService::update_repo_info(&entry).unwrap();

        assert_eq!(
            (owner, repo, branch),
            (
                "owner".to_string(),
                "repo".to_string(),
                Some("main".to_string())
            )
        );
    }

    #[test]
    fn update_repo_info_preserves_missing_ref_as_default_branch() {
        let entry = SkillLockEntry {
            source: Some("owner/repo".to_string()),
            source_type: Some("github".to_string()),
            source_url: None,
            branch: None,
            skill_path: Some("skills/demo".to_string()),
            skill_folder_hash: None,
            installed_at: None,
            updated_at: None,
            commit_sha: Some("old".to_string()),
        };

        let (owner, repo, branch) = CliService::update_repo_info(&entry).unwrap();

        assert_eq!(
            (owner, repo, branch),
            ("owner".to_string(), "repo".to_string(), None)
        );
    }

    #[tokio::test]
    async fn single_update_without_commit_sha_returns_baseline_error() {
        let entry = test_lock_entry("owner/repo", Some("skills/demo"), None);

        let result = CliService::update_skill_entries(vec![("demo".to_string(), entry)])
            .await
            .expect("update result");

        assert_eq!(result.success_count, 0);
        assert_eq!(result.fail_count, 1);
        assert_eq!(
            result.errors,
            vec!["demo: Missing update baseline. Check updates before updating this skill."]
        );
    }

    #[test]
    fn known_update_from_tree_reports_missing_skill_path() {
        let entry = test_lock_entry("owner/repo", Some("skills/demo"), Some("old"));
        let tree = RepoTreeResponse {
            sha: "root".to_string(),
            tree: vec![TreeEntry {
                path: "skills/other".to_string(),
                entry_type: "tree".to_string(),
                sha: "new".to_string(),
            }],
        };

        let error = match CliService::known_update_from_tree(
            "demo",
            &entry,
            &tree,
            "owner",
            "repo",
            Some("main"),
        ) {
            Ok(_) => panic!("expected missing skill path error"),
            Err(error) => error,
        };

        assert_eq!(
            error,
            "demo: Skill path no longer exists in owner/repo@main: skills/demo"
        );
    }

    #[test]
    fn lock_skill_path_preserves_discovered_relative_directory() {
        let repo = tempfile::tempdir().unwrap();
        let skill_dir = repo.path().join("nested").join("demo");
        std::fs::create_dir_all(&skill_dir).unwrap();

        let path = CliService::lock_skill_path(repo.path(), &skill_dir).unwrap();

        assert_eq!(path, "nested/demo");
    }

    #[test]
    fn install_selection_uses_relative_path_to_disambiguate_duplicate_leaf_names() {
        let repo = tempfile::tempdir().unwrap();
        let claude = repo.path().join(".claude").join("skills").join("recap");
        let codex = repo.path().join(".codex").join("skills").join("recap");
        std::fs::create_dir_all(&claude).unwrap();
        std::fs::create_dir_all(&codex).unwrap();

        let discovered = vec![
            ("recap".to_string(), String::new(), claude.clone()),
            ("recap".to_string(), String::new(), codex.clone()),
        ];
        let requested = vec![".codex/skills/recap".to_string()];

        let selected =
            CliService::select_discovered_skills(repo.path(), &discovered, &requested, false);

        assert_eq!(selected.len(), 1);
        assert_eq!(&selected[0].2, &codex);
    }

    #[test]
    fn normalize_skill_path_converts_windows_backslashes_to_forward_slashes() {
        // Cross-platform contract: regardless of the host OS, a selector or
        // path passed through `normalize_skill_path` must end up with forward
        // slashes so it is comparable to `lock_skill_path` output (which always
        // uses '/'). This is the heart of the Windows install regression fix.
        assert_eq!(
            CliService::normalize_skill_path("skills\\self-learning"),
            "skills/self-learning"
        );
        assert_eq!(
            CliService::normalize_skill_path("skills\\self-learning\\SKILL.md"),
            "skills/self-learning"
        );
        assert_eq!(
            CliService::normalize_skill_path("skills/self-learning"),
            "skills/self-learning"
        );
        // Mixed separators should also collapse cleanly.
        assert_eq!(
            CliService::normalize_skill_path("skills\\sub\\dir/self-learning\\SKILL.md"),
            "skills/sub/dir/self-learning"
        );
        // Root-level skill stays empty.
        assert_eq!(CliService::normalize_skill_path("SKILL.md"), "");
        assert_eq!(CliService::normalize_skill_path(""), "");
    }

    #[test]
    fn install_selection_matches_windows_backslash_selector_for_nested_skill() {
        // Reproduces the original Windows-only bug: `scan_for_skills` produced a
        // key with OS-native separators (backslashes on Windows), and that key
        // was echoed back to `install_skills` as the selector. `lock_skill_path`
        // always emits forward slashes, so the comparison failed and the user
        // got "No matching skills found. Available: self-learning".
        // This test feeds a backslash selector directly to ensure the matching
        // layer tolerates it on every platform.
        let repo = tempfile::tempdir().unwrap();
        let nested = repo.path().join("skills").join("self-learning");
        std::fs::create_dir_all(&nested).unwrap();

        let discovered = vec![("self-learning".to_string(), String::new(), nested.clone())];
        let requested = vec!["skills\\self-learning".to_string()];

        let selected =
            CliService::select_discovered_skills(repo.path(), &discovered, &requested, false);

        assert_eq!(
            selected.len(),
            1,
            "backslash selector must match nested skill"
        );
        assert_eq!(&selected[0].2, &nested);

        // Sanity: forward-slash selector still matches (the non-Windows path).
        let requested_fwd = vec!["skills/self-learning".to_string()];
        let selected_fwd =
            CliService::select_discovered_skills(repo.path(), &discovered, &requested_fwd, false);
        assert_eq!(selected_fwd.len(), 1);
    }

    #[test]
    fn install_selection_keeps_true_duplicate_destinations_visible_to_preflight() {
        let repo = tempfile::tempdir().unwrap();
        let claude = repo.path().join(".claude").join("skills").join("recap");
        let codex = repo.path().join(".codex").join("skills").join("recap");
        std::fs::create_dir_all(&claude).unwrap();
        std::fs::create_dir_all(&codex).unwrap();

        let discovered = vec![
            ("recap".to_string(), String::new(), claude),
            ("recap".to_string(), String::new(), codex),
        ];
        let requested = vec![
            ".claude/skills/recap".to_string(),
            ".codex/skills/recap".to_string(),
        ];

        let selected =
            CliService::select_discovered_skills(repo.path(), &discovered, &requested, false);
        let destinations = selected
            .iter()
            .map(|(name, _, _)| name.as_str())
            .collect::<Vec<_>>();

        let result = CliService::ensure_install_destinations_available(
            &destinations,
            &repo.path().join("ssot"),
            &[],
        );

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("multiple selected skills target the same destination"));
    }

    #[test]
    fn update_download_request_forces_fresh_zip() {
        let request = CliService::update_download_request("owner", "repo", Some("main"));

        assert_eq!(request.owner, "owner");
        assert_eq!(request.repo, "repo");
        assert_eq!(request.branch.as_deref(), Some("main"));
        assert!(request.force);
    }

    #[test]
    fn default_branch_zip_uses_head_url_and_separate_cache_key() {
        assert_eq!(
            CliService::archive_zip_url("owner", "repo", None),
            "https://github.com/owner/repo/archive/HEAD.zip"
        );
        assert_eq!(
            CliService::archive_zip_url("owner", "repo", Some("main")),
            "https://github.com/owner/repo/archive/refs/heads/main.zip"
        );
        assert!(
            CliService::cache_zip_path("owner", "repo", None).ends_with("owner--repo--default.zip")
        );
        assert!(CliService::cache_zip_path("owner", "repo", Some("main"))
            .ends_with("owner--repo--branch--main.zip"));
    }

    #[test]
    fn groups_known_updates_by_repo_for_single_zip_download() {
        let (groups, errors) = CliService::group_known_updates_by_repo(vec![
            test_known_update("one", "owner/repo", "new-one"),
            test_known_update("two", "owner/repo", "new-two"),
        ]);

        assert!(errors.is_empty());
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].owner, "owner");
        assert_eq!(groups[0].repo, "repo");
        assert_eq!(groups[0].branch.as_deref(), Some("main"));
        assert_eq!(groups[0].skills.len(), 2);
    }

    #[test]
    fn find_discovered_skill_for_update_prefers_lock_skill_path_over_duplicate_leaf_name() {
        let repo = tempfile::tempdir().unwrap();
        let wrong = repo.path().join("other").join("demo");
        let expected = repo.path().join("skills").join("demo");
        std::fs::create_dir_all(&wrong).unwrap();
        std::fs::create_dir_all(&expected).unwrap();

        let discovered = vec![
            ("demo".to_string(), String::new(), wrong.clone()),
            ("demo".to_string(), String::new(), expected.clone()),
        ];

        let selected = CliService::find_discovered_skill_for_update(
            repo.path(),
            "demo",
            Some("skills/demo"),
            &discovered,
        )
        .expect("selected skill");

        assert_eq!(selected, &expected);
    }

    #[test]
    fn find_discovered_skill_for_update_accepts_legacy_skill_md_suffix() {
        let repo = tempfile::tempdir().unwrap();
        let expected = repo.path().join("skills").join("demo");
        std::fs::create_dir_all(&expected).unwrap();

        let discovered = vec![("demo".to_string(), String::new(), expected.clone())];

        let selected = CliService::find_discovered_skill_for_update(
            repo.path(),
            "demo",
            Some("skills/demo/SKILL.md"),
            &discovered,
        )
        .expect("selected skill");

        assert_eq!(selected, &expected);
    }

    #[test]
    fn find_discovered_skill_for_update_falls_back_to_name_without_lock_path() {
        let repo = tempfile::tempdir().unwrap();
        let expected = repo.path().join("skills").join("demo");
        std::fs::create_dir_all(&expected).unwrap();

        let discovered = vec![("demo".to_string(), String::new(), expected.clone())];

        let selected =
            CliService::find_discovered_skill_for_update(repo.path(), "demo", None, &discovered)
                .expect("selected skill");

        assert_eq!(selected, &expected);
    }

    #[test]
    fn create_update_temp_dir_uses_unique_paths_for_same_skill() {
        let root = tempfile::tempdir().unwrap();

        let first = CliService::create_temp_dir(root.path(), "demo", "update").unwrap();
        let second = CliService::create_temp_dir(root.path(), "demo", "update").unwrap();

        assert_ne!(first.path(), second.path());
        assert!(first.path().exists());
        assert!(second.path().exists());
    }

    #[test]
    fn replace_skill_dir_with_rollback_replaces_existing_dest() {
        let root = tempfile::tempdir().unwrap();
        let dest = root.path().join("demo");
        let tmp = root.path().join("demo.tmp");
        std::fs::create_dir_all(&dest).unwrap();
        std::fs::create_dir_all(&tmp).unwrap();
        std::fs::write(dest.join("SKILL.md"), "# Old").unwrap();
        std::fs::write(tmp.join("SKILL.md"), "# New").unwrap();

        CliService::replace_skill_dir_with_rollback(&dest, &tmp).unwrap();

        assert_eq!(
            std::fs::read_to_string(dest.join("SKILL.md")).unwrap(),
            "# New"
        );
        assert!(!tmp.exists());
    }

    #[test]
    fn replace_skill_dir_with_rollback_restores_dest_when_tmp_rename_fails() {
        let root = tempfile::tempdir().unwrap();
        let dest = root.path().join("demo");
        let missing_tmp = root.path().join("missing.tmp");
        std::fs::create_dir_all(&dest).unwrap();
        std::fs::write(dest.join("SKILL.md"), "# Old").unwrap();

        let result = CliService::replace_skill_dir_with_rollback(&dest, &missing_tmp);

        assert!(result.is_err());
        assert_eq!(
            std::fs::read_to_string(dest.join("SKILL.md")).unwrap(),
            "# Old"
        );
    }

    #[test]
    fn backup_path_candidate_is_unique_and_not_created() {
        let root = tempfile::tempdir().unwrap();
        let dest = root.path().join("demo");
        std::fs::create_dir_all(&dest).unwrap();

        let backup = CliService::unique_backup_path(&dest).unwrap();

        assert!(!backup.exists());
        assert_eq!(backup.parent(), dest.parent());
        assert!(backup
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap()
            .starts_with(".demo.backup."));
    }

    fn test_known_update(name: &str, source: &str, latest_sha: &str) -> KnownSkillUpdate {
        KnownSkillUpdate {
            name: name.to_string(),
            entry: test_lock_entry(source, Some(&format!("skills/{name}")), Some("old")),
            latest_sha: latest_sha.to_string(),
        }
    }

    fn test_lock_entry(
        source: &str,
        skill_path: Option<&str>,
        commit_sha: Option<&str>,
    ) -> SkillLockEntry {
        SkillLockEntry {
            source: Some(source.to_string()),
            source_type: Some("github".to_string()),
            source_url: Some(format!("https://github.com/{source}")),
            branch: Some("main".to_string()),
            skill_path: skill_path.map(str::to_string),
            skill_folder_hash: None,
            installed_at: None,
            updated_at: None,
            commit_sha: commit_sha.map(str::to_string),
        }
    }
}

//! Native Rust reimplementation of the `skills` CLI add / remove / update
//! subcommands that Skill Zoo previously shelled out to via `npx`.
//! Based on <https://github.com/vercel-labs/skills> v1.5.3 (MIT).

use crate::config;
use crate::error::{classify_download_error, AppError};
use crate::services::lock::{SkillLock, SkillLockEntry};
use crate::services::skill::{is_symlink_or_junction, SkillService};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
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
}

pub struct CliService;

impl CliService {
    // ─── Add / Install ──────────────────────────────────────────────

    /// Install skills from a GitHub repository.
    ///
    /// Downloads the repo as ZIP, discovers skills, copies them into
    /// `~/.agents/skills/<name>/`, and updates the lock file.
    /// The `agent` parameter is retained for API compatibility;
    /// agent-specific symlinks are handled by the command layer.
    pub async fn add_skills(
        repo_url: &str,
        skills: &[String],
        _agent: &str,
    ) -> Result<(), AppError> {
        let install_all = skills.is_empty() || skills.iter().any(|s| s == "*");

        let (owner, repo, branch) = Self::parse_github_url(repo_url)?;

        let (_temp_dir, clone_path) = Self::download_repo_zip(&owner, &repo, &branch).await?;

        // Discover skills in the cloned tree
        let discovered = Self::discover_skills_in_tree(&clone_path);
        if discovered.is_empty() {
            return Err(AppError::Cli("No skills found in the repository.".into()));
        }

        // Filter by requested names
        let to_install: Vec<&(String, String, PathBuf)> = if install_all {
            discovered.iter().collect()
        } else {
            discovered
                .iter()
                .filter(|(name, _, _)| {
                    skills
                        .iter()
                        .any(|s| s.to_lowercase() == name.to_lowercase())
                })
                .collect()
        };

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
        let agent_dirs: Vec<PathBuf> = config::AGENTS
            .iter()
            .filter_map(|agent| config::get_agent_skills_dir(agent.id))
            .collect();
        Self::ensure_install_destinations_available(
            &to_install
                .iter()
                .map(|(name, _, _)| name.as_str())
                .collect::<Vec<_>>(),
            &ssot_dir,
            &agent_dirs,
        )?;
        std::fs::create_dir_all(&ssot_dir).map_err(AppError::Io)?;

        let mut installed_names: Vec<String> = Vec::new();
        let mut errors: Vec<String> = Vec::new();

        for (skill_name, _description, skill_path) in &to_install {
            let dest_dir = ssot_dir.join(skill_name);
            let tmp_dir = ssot_dir.join(format!(".{skill_name}.tmp"));

            // Clean up leftover temp directory from a previous failed install
            if tmp_dir.exists() {
                let _ = std::fs::remove_dir_all(&tmp_dir);
            }

            match Self::copy_dir_contents(skill_path, &tmp_dir) {
                Ok(_) => {
                    if std::fs::symlink_metadata(&dest_dir).is_ok() {
                        let _ = std::fs::remove_dir_all(&tmp_dir);
                        errors.push(format!(
                            "{skill_name}: destination appeared during installation"
                        ));
                        continue;
                    }
                    std::fs::rename(&tmp_dir, &dest_dir).map_err(AppError::Io)?;
                    installed_names.push(skill_name.clone());
                }
                Err(e) => {
                    let _ = std::fs::remove_dir_all(&tmp_dir);
                    errors.push(format!("{skill_name}: {e}"));
                }
            }
        }

        // Persist metadata to lock file (best-effort)
        let _ = Self::update_lock_after_install(&installed_names, &owner, &repo, &branch);

        if !errors.is_empty() {
            return Err(AppError::Cli(format!(
                "Installed {} skill(s), {} failed: {}",
                installed_names.len(),
                errors.len(),
                errors.join(", ")
            )));
        }

        Ok(())
    }

    fn ensure_install_destinations_available(
        skill_names: &[&str],
        ssot_dir: &std::path::Path,
        agent_dirs: &[PathBuf],
    ) -> Result<(), AppError> {
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

    // ─── Update ─────────────────────────────────────────────────────

    /// Update one or all installed skills by re-downloading and overwriting.
    pub async fn update_skills(skill_name: Option<&str>) -> Result<UpdateResult, AppError> {
        let lock = SkillLock::read()?;

        let to_update: Vec<(String, SkillLockEntry)> = if let Some(name) = skill_name {
            let entry = lock.skills.get(name).cloned().ok_or_else(|| {
                AppError::NotFound(format!("Skill not found in lock file: {name}"))
            })?;
            vec![(name.to_string(), entry)]
        } else {
            lock.skills
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect()
        };

        if to_update.is_empty() {
            return Ok(UpdateResult {
                success_count: 0,
                fail_count: 0,
                errors: vec![],
            });
        }

        let mut updated: Vec<String> = Vec::new();
        let mut errors: Vec<String> = Vec::new();

        // Group skills by (owner, repo, branch) so each repo is fetched only once
        let mut by_repo: std::collections::HashMap<
            (String, String, String),
            Vec<(String, SkillLockEntry)>,
        > = std::collections::HashMap::new();
        for (name, entry) in &to_update {
            // Entries without a stored folder SHA cannot be safely compared.
            // The update loop already skips them after a successful tree fetch;
            // skipping them here also prevents stale legacy lock entries from
            // turning unrelated repo errors into "update all" failures.
            if entry.commit_sha.is_none() {
                continue;
            }
            let source_url = entry.source_url.as_deref().unwrap_or("");
            if source_url.is_empty() {
                continue;
            }
            let (owner, repo) = match Self::parse_github_url(source_url) {
                Ok((o, r, _)) => (o, r),
                Err(e) => {
                    errors.push(format!("{name}: {e}"));
                    continue;
                }
            };
            let branch = entry.branch.clone().unwrap_or_else(|| "main".to_string());
            by_repo
                .entry((owner, repo, branch))
                .or_default()
                .push((name.clone(), entry.clone()));
        }

        for ((owner, repo, branch), skills) in &by_repo {
            let tree = match Self::fetch_repo_tree(owner, repo, branch).await {
                Ok(Some(t)) => t,
                Ok(None) => {
                    errors.extend(skills.iter().map(|(name, _)| {
                        format!(
                            "{name}: repository or branch not found for {owner}/{repo}@{branch}"
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
                let old_sha = entry.commit_sha.as_deref();
                let skill_path = entry.skill_path.as_deref().unwrap_or("");
                let new_sha = Self::get_folder_sha_from_tree(&tree, skill_path);

                // Only reinstall when we can confirm the SHA actually changed
                match (old_sha, new_sha.as_deref()) {
                    (Some(old), Some(new)) if old != new => {}
                    _ => continue,
                }

                match Self::reinstall_single_skill(name, owner, repo, branch).await {
                    Ok(_) => updated.push(name.clone()),
                    Err(e) => errors.push(format!("{name}: {e}")),
                }
            }
        }

        // Bump updatedAt timestamps
        if !updated.is_empty() {
            let mut lock = SkillLock::read()?;
            let now = chrono::Utc::now().to_rfc3339();
            for name in &updated {
                if let Some(entry) = lock.skills.get_mut(name) {
                    entry.updated_at = Some(now.clone());
                }
            }
            lock.write()?;
        }

        Ok(UpdateResult {
            success_count: updated.len(),
            fail_count: errors.len(),
            errors,
        })
    }

    // ─── Remove ─────────────────────────────────────────────────────

    /// Remove a globally installed skill: delete canonical directory,
    /// clean up agent symlinks, and remove from lock file.
    pub async fn remove_skill(name: &str) -> Result<(), AppError> {
        let ssot_dir = config::get_agents_skills_dir();
        let skill_dir = ssot_dir.join(name);

        if skill_dir.exists() && !is_symlink_or_junction(&skill_dir) {
            // Skill exists in SSOT — delete entity + clean all symlinks
            SkillService::remove_skill_dir(name, &skill_dir.to_string_lossy())?;
        } else {
            // Not in SSOT — look for entity in agent directories
            let mut found = false;
            let agent_link_name = SkillService::agent_link_name(name);
            for agent in config::AGENTS {
                if let Some(agent_dir) = config::get_agent_skills_dir(agent.id) {
                    for agent_skill in [agent_dir.join(name), agent_dir.join(agent_link_name)] {
                        if agent_skill.exists() && !is_symlink_or_junction(&agent_skill) {
                            SkillService::remove_skill_dir(name, &agent_skill.to_string_lossy())?;
                            found = true;
                            break;
                        }
                    }
                    if found {
                        break;
                    }
                }
            }
            if !found {
                return Err(AppError::NotFound(format!("Skill not found: {name}")));
            }
        }

        // Remove from lock file
        let _ = Self::remove_from_lock(name);

        Ok(())
    }

    // ─── ANSI stripping (kept for API compatibility) ────────────────

    /// Names produced by the native implementation never contain ANSI
    /// escapes, so this is an identity function.
    pub fn strip_ansi(s: &str) -> String {
        s.to_string()
    }

    // ─── Update check ────────────────────────────────────────────────

    /// Fetch the repo tree from GitHub's Trees API.
    /// Returns the tree data (with all folder SHAs), or None on rate-limit/error.
    pub async fn fetch_repo_tree(
        owner: &str,
        repo: &str,
        branch: &str,
    ) -> Result<Option<RepoTreeResponse>, AppError> {
        let url = format!(
            "https://api.github.com/repos/{owner}/{repo}/git/trees/{}?recursive=1",
            urlencoding::encode(branch)
        );
        let client = config::http_client();

        let resp = client
            .get(&url)
            .header("Accept", "application/vnd.github.v3+json")
            .timeout(std::time::Duration::from_secs(30))
            .send()
            .await
            .map_err(|e| AppError::Cli(format!("Failed to fetch tree for {owner}/{repo}: {e}")))?;

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
        // Normalize path (remove SKILL.md suffix)
        let normalized_path = path
            .trim_end_matches("/SKILL.md")
            .trim_end_matches("SKILL.md")
            .trim_end_matches('/');

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

    fn parse_github_url(url: &str) -> Result<(String, String, String), AppError> {
        let url = url.trim();

        if url.starts_with("http://") || url.starts_with("https://") {
            let parsed = url::Url::parse(url)
                .map_err(|e| AppError::BadRequest(format!("Invalid URL: {e}")))?;

            match parsed.host_str() {
                Some("github.com") => {}
                Some(host) => {
                    return Err(AppError::BadRequest(format!(
                        "Expected github.com URL, got host: {host}"
                    )));
                }
                None => {
                    return Err(AppError::BadRequest("Invalid GitHub URL: no host".into()));
                }
            }

            let segments: Vec<&str> = parsed
                .path_segments()
                .ok_or(AppError::BadRequest(
                    "Invalid GitHub URL: no path segments".into(),
                ))?
                .collect();

            if segments.len() < 2 {
                return Err(AppError::BadRequest(
                    "GitHub URL must include owner/name".into(),
                ));
            }

            let owner = segments[0].to_string();
            let name = segments[1].trim_end_matches(".git").to_string();
            let branch = if segments.len() >= 4 && segments[2] == "tree" {
                segments[3].to_string()
            } else {
                "main".to_string()
            };

            Ok((owner, name, branch))
        } else {
            let parts: Vec<&str> = url.splitn(2, '/').collect();
            if parts.len() != 2 {
                return Err(AppError::BadRequest(
                    "Expected 'owner/name' format or GitHub URL".into(),
                ));
            }
            Ok((
                parts[0].to_string(),
                parts[1].trim_end_matches(".git").to_string(),
                "main".to_string(),
            ))
        }
    }

    fn sanitize_branch(branch: &str) -> String {
        branch.replace(['/', '\\'], "--")
    }

    pub fn cache_zip_path(owner: &str, repo: &str, branch: &str) -> PathBuf {
        config::get_repo_zip_cache_dir().join(format!(
            "{owner}--{repo}--{}.zip",
            Self::sanitize_branch(branch)
        ))
    }

    pub async fn ensure_cached_zip(
        owner: &str,
        repo: &str,
        branch: &str,
        force: bool,
    ) -> Result<PathBuf, AppError> {
        Self::ensure_cached_zip_with_progress(owner, repo, branch, force, None).await
    }

    pub async fn ensure_cached_zip_with_progress(
        owner: &str,
        repo: &str,
        branch: &str,
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

        let url = format!("https://github.com/{owner}/{repo}/archive/refs/heads/{branch}.zip");
        let repo_id = format!("{owner}/{repo}");
        let client = config::http_client();
        let response = client
            .get(&url)
            .send()
            .await
            .map_err(|e| classify_download_error(repo_id.clone(), e))?;

        if !response.status().is_success() {
            match response.status().as_u16() {
                403 | 429 => return Err(AppError::RateLimited(repo_id)),
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
            Self::sanitize_branch(branch)
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
        branch: &str,
    ) -> Result<(tempfile::TempDir, PathBuf), AppError> {
        let zip_path = Self::ensure_cached_zip(owner, repo, branch, false).await?;

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
        skill_names: &[String],
        owner: &str,
        repo: &str,
        branch: &str,
    ) -> Result<(), AppError> {
        let mut lock = SkillLock::read()?;
        let now = chrono::Utc::now().to_rfc3339();
        let source = format!("{owner}/{repo}");
        let source_url = format!("https://github.com/{owner}/{repo}");

        for name in skill_names {
            let existing_installed_at = lock.skills.get(name).and_then(|e| e.installed_at.clone());

            lock.skills.insert(
                name.clone(),
                SkillLockEntry {
                    source: Some(source.clone()),
                    source_type: Some("github".into()),
                    source_url: Some(source_url.clone()),
                    branch: Some(branch.into()),
                    skill_path: Some(format!("skills/{name}/SKILL.md")),
                    skill_folder_hash: Some(String::new()),
                    installed_at: Some(existing_installed_at.unwrap_or_else(|| now.clone())),
                    updated_at: Some(now.clone()),
                    commit_sha: lock.skills.get(name).and_then(|e| e.commit_sha.clone()),
                },
            );
        }

        lock.write()
    }

    fn remove_from_lock(name: &str) -> Result<(), AppError> {
        let mut lock = SkillLock::read()?;
        lock.skills.remove(name);
        lock.write()
    }

    async fn reinstall_single_skill(
        name: &str,
        owner: &str,
        repo: &str,
        branch: &str,
    ) -> Result<(), AppError> {
        let (_temp_dir, clone_path) = Self::download_repo_zip(owner, repo, branch).await?;

        let discovered = Self::discover_skills_in_tree(&clone_path);
        let (_display_name, _desc, skill_path) = discovered
            .iter()
            .find(|(n, _, _)| n == name)
            .ok_or_else(|| {
                AppError::NotFound(format!("Skill {name} not found in {owner}/{repo}"))
            })?;

        let ssot_dir = config::get_agents_skills_dir();
        let dest = ssot_dir.join(name);
        let tmp = ssot_dir.join(format!(".{name}.tmp"));

        if tmp.exists() {
            let _ = std::fs::remove_dir_all(&tmp);
        }

        Self::copy_dir_contents(skill_path, &tmp)?;

        if dest.exists() {
            std::fs::remove_dir_all(&dest).map_err(AppError::Io)?;
        }
        std::fs::rename(&tmp, &dest).map_err(AppError::Io)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_github_url_short() {
        let (owner, repo, branch) = CliService::parse_github_url("vercel-labs/skills").unwrap();
        assert_eq!(owner, "vercel-labs");
        assert_eq!(repo, "skills");
        assert_eq!(branch, "main");
    }

    #[test]
    fn test_parse_github_url_full() {
        let (owner, repo, branch) =
            CliService::parse_github_url("https://github.com/anthropics/skills").unwrap();
        assert_eq!(owner, "anthropics");
        assert_eq!(repo, "skills");
        assert_eq!(branch, "main");
    }

    #[test]
    fn test_parse_github_url_tree() {
        let (owner, repo, branch) =
            CliService::parse_github_url("https://github.com/anthropics/skills/tree/main").unwrap();
        assert_eq!(owner, "anthropics");
        assert_eq!(repo, "skills");
        assert_eq!(branch, "main");
    }

    #[test]
    fn test_parse_github_url_strips_dot_git_full() {
        let (owner, repo, branch) =
            CliService::parse_github_url("https://github.com/anthropics/skills.git").unwrap();
        assert_eq!(owner, "anthropics");
        assert_eq!(repo, "skills");
        assert_eq!(branch, "main");
    }

    #[test]
    fn test_parse_github_url_strips_dot_git_short() {
        let (owner, repo, branch) = CliService::parse_github_url("anthropics/skills.git").unwrap();
        assert_eq!(owner, "anthropics");
        assert_eq!(repo, "skills");
        assert_eq!(branch, "main");
    }

    #[test]
    fn test_parse_github_url_rejects_non_github() {
        assert!(CliService::parse_github_url("https://gitlab.com/foo/bar").is_err());
    }

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
}

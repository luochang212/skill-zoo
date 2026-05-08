//! Native Rust reimplementation of the `skills` CLI add / remove / update
//! subcommands that Skill Zoo previously shelled out to via `npx`.
//! Based on <https://github.com/vercel-labs/skills> v1.5.3 (MIT).

use crate::config;
use crate::error::AppError;
use crate::services::lock::{SkillLock, SkillLockEntry};
use crate::services::skill::{is_symlink_or_junction, SkillService};
use std::path::PathBuf;

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
                    if dest_dir.exists() {
                        std::fs::remove_dir_all(&dest_dir).map_err(AppError::Io)?;
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

    // ─── Update ─────────────────────────────────────────────────────

    /// Update one or all installed skills by re-downloading and overwriting.
    pub async fn update_skills(skill_name: Option<&str>) -> Result<(), AppError> {
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
            return Ok(());
        }

        let mut updated: Vec<String> = Vec::new();
        let mut errors: Vec<String> = Vec::new();

        for (name, entry) in &to_update {
            let source_url = entry.source_url.as_deref().unwrap_or("");
            let branch = entry.branch.as_deref().unwrap_or("main");

            if source_url.is_empty() {
                // Local skills can't be updated from remote
                continue;
            }

            match Self::parse_github_url(source_url) {
                Ok((owner, repo, _parsed_branch)) => {
                    let effective_branch = branch;
                    match Self::reinstall_single_skill(name, &owner, &repo, effective_branch).await
                    {
                        Ok(_) => updated.push(name.clone()),
                        Err(e) => errors.push(format!("{name}: {e}")),
                    }
                }
                Err(e) => errors.push(format!("{name}: {e}")),
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

        if !errors.is_empty() {
            return Err(AppError::Cli(format!(
                "{} skill(s) failed: {}",
                errors.len(),
                errors.join("; ")
            )));
        }

        Ok(())
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
            for agent in config::AGENTS {
                if let Some(agent_dir) = config::get_agent_skills_dir(agent.id) {
                    let agent_skill = agent_dir.join(name);
                    if agent_skill.exists() && !is_symlink_or_junction(&agent_skill) {
                        SkillService::remove_skill_dir(name, &agent_skill.to_string_lossy())?;
                        found = true;
                        break;
                    }
                }
            }
            if !found {
                // Last resort: clean up any dangling symlinks
                for agent in config::AGENTS {
                    if let Some(agent_dir) = config::get_agent_skills_dir(agent.id) {
                        let agent_skill = agent_dir.join(name);
                        if is_symlink_or_junction(&agent_skill) {
                            let _ = std::fs::remove_file(&agent_skill);
                        }
                    }
                }
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
            let name = segments[1].to_string();
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
                parts[1].to_string(),
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
        let response = reqwest::get(&url)
            .await
            .map_err(|e| AppError::Cli(format!("Failed to download {owner}/{repo}: {e}")))?;

        if !response.status().is_success() {
            return Err(AppError::Cli(format!(
                "Failed to download {owner}/{repo}: HTTP {}",
                response.status()
            )));
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|e| AppError::Cli(format!("Failed to read response: {e}")))?;

        const MAX_SIZE: usize = 50 * 1024 * 1024;
        if bytes.len() > MAX_SIZE {
            return Err(AppError::Cli(format!(
                "Repository archive exceeds {}MB",
                MAX_SIZE / (1024 * 1024)
            )));
        }

        let tmp_path = cache_dir.join(format!(
            ".{owner}--{repo}--{}.zip.tmp",
            Self::sanitize_branch(branch)
        ));
        std::fs::write(&tmp_path, &bytes).map_err(AppError::Io)?;
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
            if file_name.starts_with('.') || file_name == "node_modules" {
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

            if file_name.starts_with('.')
                || file_name == "__pycache__"
                || file_name == "__pypackages__"
            {
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
    fn test_parse_github_url_rejects_non_github() {
        assert!(CliService::parse_github_url("https://gitlab.com/foo/bar").is_err());
    }
}

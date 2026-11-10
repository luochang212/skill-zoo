use crate::config;
use crate::error::{classify_download_error, AppError};
use crate::services::github;
use crate::services::lock::{SkillLock, SkillLockEntry};
use crate::services::skill::{is_symlink_or_junction, normalize_repo_skill_path, SkillService};
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
    pub skipped_drifted: Vec<String>,
}

#[derive(Clone)]
pub struct KnownSkillUpdate {
    pub name: String,
    pub entry: SkillLockEntry,
    pub latest_sha: String,
    pub force: bool,
}

#[derive(Debug, PartialEq)]
enum ReinstallOutcome {
    Updated,
    SkippedDrifted,
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
    pub async fn add_skills(
        repo_url: &str,
        skills: &[String],
        preflight_agent_dirs: &[PathBuf],
    ) -> Result<Vec<String>, AppError> {
        let install_all = skills.is_empty() || skills.iter().any(|s| s == "*");

        let repo_ref = github::parse_repo_ref(repo_url)?;
        let (owner, repo, branch) = (repo_ref.owner, repo_ref.name, repo_ref.branch);

        let (_temp_dir, clone_path, archive_commit) =
            Self::download_repo_zip(&owner, &repo, branch.as_deref(), false).await?;

        let discovered = Self::discover_skills_in_tree(&clone_path);
        if discovered.is_empty() {
            return Err(AppError::Cli("No skills found in the repository.".into()));
        }

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

        let folder_shas: std::collections::HashMap<String, Option<String>> =
            match if let Some(commit) = archive_commit.as_deref() {
                Self::fetch_repo_tree(&owner, &repo, Some(commit)).await
            } else {
                Ok(None)
            } {
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
                         update baseline remains unknown",
                        Self::repo_ref_label(&owner, &repo, branch.as_deref())
                    );
                    std::collections::HashMap::new()
                }
                Err(e) => {
                    eprintln!(
                        "install: tree fetch failed for {}: {e}, \
                         update baseline remains unknown",
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
        mut to_update: Vec<(String, SkillLockEntry)>,
    ) -> Result<UpdateResult, AppError> {
        let ssot_dir = config::get_agents_skills_dir();
        let mut skipped_drifted = Vec::new();
        to_update.retain(|(name, entry)| {
            if crate::services::lock::skill_folder_drifted(&ssot_dir.join(name), entry) {
                skipped_drifted.push(name.clone());
                false
            } else {
                true
            }
        });

        if to_update.is_empty() {
            return Ok(UpdateResult {
                success_count: 0,
                fail_count: 0,
                errors: vec![],
                updated: vec![],
                skipped_drifted,
            });
        }

        let mut errors: Vec<String> = Vec::new();
        let report_missing_baseline = to_update.len() == 1;

        let mut by_repo: std::collections::HashMap<RepoUpdateKey, RepoLockEntries> =
            std::collections::HashMap::new();
        for (name, entry) in &to_update {
            if entry.commit_sha.is_none() {
                if report_missing_baseline {
                    errors.push(format!(
                        "{name}: Missing update baseline. Open this skill and update it to establish a baseline."
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
                    let message = crate::error::CommandError::from(e).to_json();
                    errors.extend(skills.iter().map(|(name, _)| format!("{name}: {message}")));
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
        result.skipped_drifted.extend(skipped_drifted);
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
                normalize_repo_skill_path(skill_path)
            ));
        };

        match old_sha {
            Some(old) if old != new_sha => Ok(Some(KnownSkillUpdate {
                name: name.to_string(),
                entry: entry.clone(),
                latest_sha: new_sha,
                force: false,
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
                skipped_drifted: vec![],
            });
        }

        let (groups, mut errors) = Self::group_known_updates_by_repo(to_update);
        let mut updated: Vec<String> = Vec::new();
        let mut skipped_drifted = Vec::new();

        for group in &groups {
            let request =
                Self::update_download_request(&group.owner, &group.repo, group.branch.as_deref());
            let (_temp_dir, clone_path, archive_commit) = match Self::download_repo_zip(
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

            let tree = match archive_commit {
                Some(commit) => {
                    Self::fetch_repo_tree(&group.owner, &group.repo, Some(&commit)).await
                }
                None => Err(AppError::BadRequest(
                    "Downloaded archive has no commit identity; refusing to update.".into(),
                )),
            };
            let tree = match tree {
                Ok(Some(tree)) => tree,
                result => {
                    let message = match result {
                        Err(error) => error.to_string(),
                        _ => "Downloaded archive commit no longer exists.".into(),
                    };
                    errors.extend(
                        group
                            .skills
                            .iter()
                            .map(|skill| format!("{}: {message}", skill.name)),
                    );
                    continue;
                }
            };
            let discovered = Self::discover_skills_in_tree(&clone_path);
            for skill in &group.skills {
                match Self::reinstall_skill_from_discovered(
                    skill,
                    &group.owner,
                    &group.repo,
                    &clone_path,
                    &discovered,
                    &tree,
                ) {
                    Ok(ReinstallOutcome::Updated) => {
                        updated.push(skill.name.clone());
                    }
                    Ok(ReinstallOutcome::SkippedDrifted) => {
                        skipped_drifted.push(skill.name.clone())
                    }
                    Err(e) => errors.push(format!("{}: {e}", skill.name)),
                }
            }
        }

        Ok(UpdateResult {
            success_count: updated.len(),
            fail_count: errors.len(),
            errors,
            updated,
            skipped_drifted,
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

        let resp = crate::services::github::github_get(client, &url)
            .header("Accept", "application/vnd.github.v3+json")
            .timeout(std::time::Duration::from_secs(30))
            .send()
            .await
            .map_err(|e| classify_download_error(format!("{owner}/{repo}"), e))?;

        Self::parse_repo_tree_response(resp, &format!("{owner}/{repo}")).await
    }

    async fn parse_repo_tree_response(
        resp: reqwest::Response,
        repo: &str,
    ) -> Result<Option<RepoTreeResponse>, AppError> {
        if resp.status().as_u16() != 404 {
            if let Some(error) = crate::services::github::response_error(&resp, repo) {
                return Err(error);
            }
        }
        match resp.status().as_u16() {
            200 => {
                let json: RepoTreeResponse = resp.json().await.map_err(|e| {
                    AppError::Parse(format!("Invalid tree response from GitHub: {e}"))
                })?;
                Ok(Some(json))
            }
            _ => Ok(None),
        }
    }

    pub fn get_folder_sha_from_tree(tree: &RepoTreeResponse, path: &str) -> Option<String> {
        let normalized_path = normalize_repo_skill_path(path);

        if normalized_path.is_empty() {
            return Some(tree.sha.clone());
        }

        tree.tree
            .iter()
            .find(|e| e.entry_type == "tree" && e.path == normalized_path)
            .map(|e| e.sha.clone())
    }

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

    fn lock_skill_path(repo_root: &Path, skill_path: &Path) -> Option<String> {
        let relative = skill_path.strip_prefix(repo_root).ok()?;
        let path = relative.to_string_lossy().replace('\\', "/");
        Some(normalize_repo_skill_path(&path))
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
        if selector.trim() == "." {
            return skill_path == repo_root && repo_root.join("SKILL.md").is_file();
        }
        let selector = normalize_repo_skill_path(selector);
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
        let url = Self::archive_zip_url(owner, repo, branch);
        Self::ensure_cached_zip_from_url(owner, repo, branch, force, app_handle, &url).await
    }

    async fn ensure_cached_zip_from_url(
        owner: &str,
        repo: &str,
        branch: Option<&str>,
        force: bool,
        app_handle: Option<&tauri::AppHandle>,
        url: &str,
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

        let repo_id = format!("{owner}/{repo}");
        let client = config::http_client();
        let response = client
            .get(url)
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
        let mut file = tempfile::Builder::new()
            .prefix(".repo-")
            .suffix(".zip.tmp")
            .tempfile_in(&cache_dir)
            .map_err(AppError::Io)?;

        use futures::StreamExt;
        let mut stream = response.bytes_stream();
        let mut emit_threshold: u64 = 0;

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| classify_download_error(repo_id.clone(), e))?;
            downloaded += chunk.len() as u64;

            if downloaded > config::MAX_DOWNLOAD_BYTES {
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
                            "branch": branch,
                            "downloaded": downloaded,
                            "total": total_size,
                        }),
                    );
                    emit_threshold = downloaded + 256 * 1024;
                }
            }
        }

        file.into_temp_path()
            .persist(&cache_path)
            .map_err(|e| AppError::Io(e.error))?;

        Ok(cache_path)
    }

    pub(crate) fn validate_archive_scale<R: std::io::Read + std::io::Seek>(
        archive: &mut zip::ZipArchive<R>,
        zip_len: u64,
        max_ratio: u64,
        min_bytes: u64,
        max_files: usize,
    ) -> Result<(), AppError> {
        let mut total_bytes: u64 = 0;
        for i in 0..archive.len() {
            let entry = archive
                .by_index_raw(i)
                .map_err(|e| AppError::Cli(format!("Invalid archive: {e}")))?;
            total_bytes = total_bytes.saturating_add(entry.size());
        }
        Self::check_archive_limits(
            zip_len,
            total_bytes,
            archive.len(),
            max_ratio,
            min_bytes,
            max_files,
        )
    }

    fn check_archive_limits(
        zip_len: u64,
        total_bytes: u64,
        entry_count: usize,
        max_ratio: u64,
        min_bytes: u64,
        max_files: usize,
    ) -> Result<(), AppError> {
        if entry_count > max_files {
            return Err(AppError::Cli(format!(
                "Archive contains {entry_count} entries, exceeding the limit of {max_files}"
            )));
        }
        let limit = zip_len.saturating_mul(max_ratio).max(min_bytes);
        if total_bytes > limit {
            return Err(AppError::Cli(format!(
                "Archive decompresses to {total_bytes} bytes, exceeding the limit of {limit} bytes"
            )));
        }
        Ok(())
    }

    async fn download_repo_zip(
        owner: &str,
        repo: &str,
        branch: Option<&str>,
        force: bool,
    ) -> Result<(tempfile::TempDir, PathBuf, Option<String>), AppError> {
        let zip_path = Self::ensure_cached_zip(owner, repo, branch, force).await?;
        Self::extract_repo_zip(&zip_path, repo)
    }

    fn extract_repo_zip(
        zip_path: &Path,
        repo: &str,
    ) -> Result<(tempfile::TempDir, PathBuf, Option<String>), AppError> {
        let file = std::fs::File::open(zip_path).map_err(AppError::Io)?;
        let zip_len = file.metadata().map_err(AppError::Io)?.len();
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|e| AppError::Cli(format!("Invalid archive: {e}")))?;
        Self::validate_archive_scale(
            &mut archive,
            zip_len,
            config::MAX_EXTRACT_RATIO,
            config::MIN_EXTRACT_LIMIT_BYTES,
            config::MAX_EXTRACT_FILES,
        )?;

        let archive_commit = std::str::from_utf8(archive.comment())
            .ok()
            .filter(|sha| sha.len() == 40 && sha.bytes().all(|b| b.is_ascii_hexdigit()))
            .map(str::to_owned);
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
        let root_dir = SkillService::normalize_extracted_repo_root(&root_dir, repo)?;

        Ok((temp_dir, root_dir, archive_commit))
    }

    fn discover_skills_in_tree(root: &Path) -> Vec<(String, String, PathBuf)> {
        SkillService::repo_skill_roots(root)
            .into_iter()
            .map(|path| {
                let name = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("unknown")
                    .to_string();
                (name, String::new(), path)
            })
            .collect()
    }

    fn copy_dir_contents(src: &PathBuf, dest: &PathBuf) -> Result<(), AppError> {
        Self::copy_dir_contents_at_depth(src, dest, 0)
    }

    const MAX_COPY_DEPTH: usize = 20;

    fn copy_dir_contents_at_depth(
        src: &PathBuf,
        dest: &PathBuf,
        depth: usize,
    ) -> Result<(), AppError> {
        if depth > Self::MAX_COPY_DEPTH {
            return Err(AppError::Cli(format!(
                "Skill directory is nested deeper than {} levels; refusing to copy",
                Self::MAX_COPY_DEPTH
            )));
        }

        std::fs::create_dir_all(dest).map_err(AppError::Io)?;

        let entries = std::fs::read_dir(src).map_err(AppError::Io)?;

        for entry in entries.flatten() {
            let path = entry.path();
            let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

            if crate::config::SKIP_DIRS.contains(&file_name) {
                continue;
            }

            let dest_path = dest.join(file_name);

            if is_symlink_or_junction(&path) {
                let Ok(target) = std::fs::read_link(&path) else {
                    continue;
                };
                let resolved = if target.is_absolute() {
                    target
                } else {
                    path.parent().unwrap_or(Path::new(".")).join(&target)
                };
                if std::fs::symlink_metadata(&resolved)
                    .map(|m| m.is_file())
                    .unwrap_or(false)
                {
                    std::fs::copy(&resolved, &dest_path).map_err(AppError::Io)?;
                }
            } else if path.is_dir() {
                Self::copy_dir_contents_at_depth(&path, &dest_path, depth + 1)?;
            } else {
                std::fs::copy(&path, &dest_path).map_err(AppError::Io)?;
            }
        }

        Ok(())
    }

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
        let ssot_dir = config::get_agents_skills_dir();
        let folder_hashes: std::collections::HashMap<String, Option<String>> = skills
            .iter()
            .map(|(name, _)| {
                (
                    name.clone(),
                    crate::services::lock::compute_skill_folder_hash(&ssot_dir.join(name)).ok(),
                )
            })
            .collect();

        SkillLock::update(|lock| {
            for (name, skill_path) in skills {
                let existing_installed_at =
                    lock.skills.get(name).and_then(|e| e.installed_at.clone());
                let extra = lock
                    .skills
                    .get(name)
                    .map(|e| e.extra.clone())
                    .unwrap_or_default();
                let commit_sha = folder_shas.get(name).cloned().flatten();

                lock.skills.insert(
                    name.clone(),
                    SkillLockEntry {
                        extra,
                        source: Some(source.clone()),
                        source_type: Some("github".into()),
                        source_url: Some(source_url.clone()),
                        branch: branch.map(str::to_string),
                        skill_path: Some(skill_path.clone()),
                        skill_folder_hash: folder_hashes.get(name).cloned().flatten(),
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
        skill: &KnownSkillUpdate,
        owner: &str,
        repo: &str,
        repo_root: &Path,
        discovered: &[(String, String, PathBuf)],
        tree: &RepoTreeResponse,
    ) -> Result<ReinstallOutcome, AppError> {
        let name = &skill.name;
        let lock_skill_path = skill.entry.skill_path.as_deref();
        let actual_sha = Self::get_folder_sha_from_tree(tree, lock_skill_path.unwrap_or(""));
        if actual_sha.as_deref() != Some(&skill.latest_sha) {
            return Err(AppError::BadRequest(format!(
                "{name}: Remote skill changed since checking. Check updates again."
            )));
        }
        let skill_path =
            Self::find_discovered_skill_for_update(repo_root, name, lock_skill_path, discovered)
                .ok_or_else(|| {
                    let normalized_path = lock_skill_path
                        .map(normalize_repo_skill_path)
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
        let fresh_hash = crate::services::lock::compute_skill_folder_hash(&tmp_path)?;
        if !skill.force && crate::services::lock::skill_folder_drifted(&dest, &skill.entry) {
            return Ok(ReinstallOutcome::SkippedDrifted);
        }
        Self::replace_skill_dir_with_rollback(&dest, &tmp_path, || {
            SkillLock::update(|lock| {
                let entry = lock.skills.get_mut(name).ok_or_else(|| {
                    AppError::NotFound(format!("Skill {name} no longer exists in the lock file"))
                })?;
                if entry != &skill.entry {
                    return Err(AppError::BadRequest(format!(
                        "{name}: Update state changed. Check updates again."
                    )));
                }
                entry.updated_at = Some(chrono::Utc::now().to_rfc3339());
                entry.commit_sha = Some(skill.latest_sha.clone());
                entry.skill_folder_hash = Some(fresh_hash);
                Ok(())
            })
        })?;
        Ok(ReinstallOutcome::Updated)
    }

    fn find_discovered_skill_for_update<'a>(
        repo_root: &Path,
        name: &str,
        lock_skill_path: Option<&str>,
        discovered: &'a [(String, String, PathBuf)],
    ) -> Option<&'a PathBuf> {
        let expected_path = lock_skill_path
            .map(normalize_repo_skill_path)
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

        if lock_skill_path.is_some() {
            return discovered
                .iter()
                .find(|(_, _, path)| path == repo_root)
                .map(|(_, _, path)| path);
        }

        discovered
            .iter()
            .find(|(discovered_name, _, _)| discovered_name == name)
            .map(|(_, _, path)| path)
    }

    fn replace_skill_dir_with_rollback(
        dest: &Path,
        tmp: &Path,
        commit: impl FnOnce() -> Result<(), AppError>,
    ) -> Result<(), AppError> {
        let backup = if std::fs::symlink_metadata(dest).is_ok() {
            let backup = Self::create_backup_path(dest)?;
            std::fs::rename(dest, &backup).map_err(AppError::Io)?;
            Some(backup)
        } else {
            None
        };
        let replacement = std::fs::rename(tmp, dest).map_err(AppError::Io);
        let replaced = replacement.is_ok();
        let result = replacement.and_then(|()| commit());
        match result {
            Ok(()) => {
                if let Some(backup) = backup {
                    let _ = std::fs::remove_dir_all(backup);
                }
                Ok(())
            }
            Err(error) => {
                if replaced {
                    std::fs::rename(dest, tmp).map_err(|restore_error| AppError::Cli(format!(
                        "Update failed: {error}. Could not remove replacement at {}: {restore_error}. Original remains at {}", dest.display(), backup.as_deref().unwrap_or(dest).display()
                    )))?;
                }
                if let Some(backup) = backup {
                    std::fs::rename(&backup, dest).map_err(|restore_error| AppError::Cli(format!(
                        "Update failed: {error}. Original skill remains at {} and could not be restored automatically: {restore_error}", backup.display()
                    )))?;
                }
                Err(error)
            }
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

    async fn wait_for_partial_downloads(cache_dir: &Path, expected: usize) {
        loop {
            if std::fs::read_dir(cache_dir).is_ok_and(|entries| {
                entries
                    .flatten()
                    .filter(|entry| entry.metadata().is_ok_and(|m| m.len() > 0))
                    .count()
                    == expected
            }) {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    }

    fn consume_request(socket: &mut std::net::TcpStream) -> bool {
        use std::io::Read;
        let mut seen = Vec::new();
        let mut chunk = [0u8; 1024];
        while !seen.windows(4).any(|window| window == b"\r\n\r\n") {
            match socket.read(&mut chunk) {
                Ok(0) | Err(_) => return false,
                Ok(n) => seen.extend_from_slice(&chunk[..n]),
            }
        }
        true
    }

    #[test]
    fn zip_download_cleans_partial_responses_and_cancelled_downloads() {
        use std::io::Write;
        for cancel in [false, true] {
            let home = tempfile::tempdir().unwrap();
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            listener.set_nonblocking(true).unwrap();
            let url = format!("http://{}", listener.local_addr().unwrap());
            let (finish, wait) = std::sync::mpsc::channel();
            let server = std::thread::spawn(move || {
                let mut sockets = Vec::new();
                loop {
                    match wait.try_recv() {
                        Ok(()) | Err(std::sync::mpsc::TryRecvError::Disconnected) => break,
                        Err(std::sync::mpsc::TryRecvError::Empty) => {}
                    }
                    match listener.accept() {
                        Ok((mut socket, _)) => {
                            let _ = socket.set_nonblocking(false);
                            let _ = socket
                                .set_read_timeout(Some(std::time::Duration::from_millis(500)));
                            if !consume_request(&mut socket) {
                                continue;
                            }
                            let _ = socket.write_all(
                                b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\nConnection: close\r\n\r\npartial",
                            );
                            let _ = socket.flush();
                            sockets.push(socket);
                        }
                        Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                        Err(_) => break,
                    }
                    std::thread::sleep(std::time::Duration::from_millis(2));
                }
            });
            config::with_test_home(home.path(), || {
                let rt = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .unwrap();
                rt.block_on(async {
                    tokio::time::timeout(std::time::Duration::from_secs(15), async {
                        let cache_dir = config::get_repo_zip_cache_dir();
                        let mut attempts = 0;
                        let mut download;
                        loop {
                            attempts += 1;
                            download = Box::pin(CliService::ensure_cached_zip_from_url(
                                "owner", "repo", None, false, None, &url,
                            ));
                            tokio::select! {
                                result = &mut download => {
                                    assert!(
                                        attempts < 20,
                                        "download ended before partial data was written: {result:?}"
                                    );
                                }
                                _ = wait_for_partial_downloads(&cache_dir, 1) => break,
                                _ = tokio::time::sleep(std::time::Duration::from_secs(3)) => {}
                            }
                        }
                        if cancel {
                            drop(download);
                            finish.send(()).unwrap();
                        } else {
                            finish.send(()).unwrap();
                            assert!(download.await.is_err());
                        }
                        assert_eq!(
                            std::fs::read_dir(cache_dir).unwrap().count(),
                            0,
                            "cancel={cancel}"
                        );
                    })
                    .await
                    .unwrap();
                });
            });
            server.join().unwrap();
        }
    }

    #[test]
    fn zip_downloads_keep_concurrent_files_isolated_and_publish_complete_archives() {
        use std::io::Write;
        let mut archive = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        archive
            .start_file("repo/SKILL.md", zip::write::SimpleFileOptions::default())
            .unwrap();
        archive.write_all(b"# skill").unwrap();
        let bytes = archive.finish().unwrap().into_inner();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let (finish, wait) = std::sync::mpsc::channel();
        let server = std::thread::spawn(move || {
            let mut sockets = Vec::new();
            while sockets.len() < 2 {
                let (mut socket, _) = listener.accept().unwrap();
                if !consume_request(&mut socket) {
                    continue;
                }
                write!(
                    socket,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    bytes.len()
                )
                .unwrap();
                socket.write_all(&bytes[..1]).unwrap();
                socket.flush().unwrap();
                sockets.push(socket);
            }
            wait.recv_timeout(std::time::Duration::from_secs(10))
                .unwrap();
            for mut socket in sockets {
                socket.write_all(&bytes[1..]).unwrap();
            }
        });
        let home = tempfile::tempdir().unwrap();
        config::with_test_home(home.path(), || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();
            rt.block_on(async {
                tokio::time::timeout(std::time::Duration::from_secs(10), async {
                    let cache_dir = config::get_repo_zip_cache_dir();
                    let downloads = async {
                        tokio::join!(
                            CliService::ensure_cached_zip_from_url(
                                "owner", "repo", None, false, None, &url
                            ),
                            CliService::ensure_cached_zip_from_url(
                                "owner", "repo", None, false, None, &url
                            ),
                        )
                    };
                    let release = async {
                        wait_for_partial_downloads(&cache_dir, 2).await;
                        finish.send(()).unwrap();
                    };
                    let ((first, second), ()) = tokio::join!(downloads, release);
                    let path = first.unwrap();
                    assert_eq!(second.unwrap(), path);
                    let file = std::fs::File::open(path).unwrap();
                    let mut zip = zip::ZipArchive::new(file).unwrap();
                    let mut content = String::new();
                    std::io::Read::read_to_string(&mut zip.by_index(0).unwrap(), &mut content)
                        .unwrap();
                    assert_eq!(content, "# skill");
                    assert_eq!(std::fs::read_dir(cache_dir).unwrap().count(), 1);
                })
                .await
                .unwrap();
            });
        });
        server.join().unwrap();
    }

    #[test]
    fn zip_download_cleans_failed_publication_and_replaces_complete_cache() {
        let mut server = mockito::Server::new();
        let response = server
            .mock("GET", "/archive")
            .with_body(b"complete archive")
            .expect(3)
            .create();
        let home = tempfile::tempdir().unwrap();
        config::with_test_home(home.path(), || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();
            rt.block_on(async {
                let url = format!("{}/archive", server.url());
                let path = CliService::cache_zip_path("owner", "repo", None);
                std::fs::create_dir_all(&path).unwrap();
                assert!(CliService::ensure_cached_zip_from_url(
                    "owner", "repo", None, true, None, &url
                )
                .await
                .is_err());
                assert_eq!(
                    std::fs::read_dir(path.parent().unwrap()).unwrap().count(),
                    1
                );
                std::fs::remove_dir(&path).unwrap();
                for _ in 0..2 {
                    let result = CliService::ensure_cached_zip_from_url(
                        "owner", "repo", None, true, None, &url,
                    )
                    .await
                    .unwrap();
                    assert_eq!(std::fs::read(result).unwrap(), b"complete archive");
                    assert_eq!(
                        std::fs::read_dir(path.parent().unwrap()).unwrap().count(),
                        1
                    );
                }
            });
        });
        response.assert();
    }

    #[test]
    fn install_lock_update_preserves_fixture_optional_fields() {
        let tmp = tempfile::tempdir().unwrap();
        config::with_test_home(tmp.path(), || {
            let path = config::get_agent_lock_file();
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            let fixture = include_str!("../../../fixtures/local-protocol/lock-v3-full.json");
            std::fs::write(&path, fixture).unwrap();
            CliService::update_lock_after_install(
                &[("demo".into(), "skills/new-demo".into())],
                "new-owner",
                "new-repo",
                Some("release"),
                &Default::default(),
            )
            .unwrap();
            let updated = SkillLock::read().unwrap();
            assert_eq!(updated.extra.get("futureTop").unwrap(), "keep-me");
            assert_eq!(
                updated.skills["demo"].extra.get("futureOptional").unwrap(),
                "keep-me"
            );
            assert_eq!(
                updated.skills["demo"].skill_path.as_deref(),
                Some("skills/new-demo")
            );
            assert_eq!(
                updated.skills["demo"].source.as_deref(),
                Some("new-owner/new-repo")
            );
            assert_eq!(updated.skills["demo"].commit_sha, None);
        });
    }

    #[test]
    fn install_lock_update_writes_real_content_baseline() {
        let tmp = tempfile::tempdir().unwrap();
        config::with_test_home(tmp.path(), || {
            let skill_dir = config::get_agents_skills_dir().join("demo");
            std::fs::create_dir_all(&skill_dir).unwrap();
            std::fs::write(skill_dir.join("SKILL.md"), "# demo\n").unwrap();

            CliService::update_lock_after_install(
                &[("demo".into(), "skills/demo".into())],
                "owner",
                "repo",
                None::<&str>,
                &Default::default(),
            )
            .unwrap();

            let entry = SkillLock::read().unwrap().skills["demo"].clone();
            let baseline = entry
                .content_baseline()
                .expect("baseline written on install");

            assert!(!crate::services::lock::skill_folder_drifted(
                &skill_dir, &entry
            ));

            std::fs::write(skill_dir.join("SKILL.md"), "# demo edited\n").unwrap();
            assert!(crate::services::lock::skill_folder_drifted(
                &skill_dir, &entry
            ));
            assert_ne!(
                crate::services::lock::compute_skill_folder_hash(&skill_dir).unwrap(),
                baseline
            );
        });
    }

    #[tokio::test]
    async fn tree_forbidden_responses_only_stop_batches_when_quota_is_zero() {
        let mut server = mockito::Server::new_async().await;
        let client = reqwest::Client::new();
        for (status, remaining, rate_limited) in [
            (403, Some("0"), true),
            (403, Some("42"), false),
            (403, None, false),
            (429, None, true),
            (429, Some("42"), true),
        ] {
            let mut mock = server.mock("GET", "/tree").with_status(status);
            if let Some(remaining) = remaining {
                mock = mock.with_header("x-ratelimit-remaining", remaining);
            }
            let mock = mock.create_async().await;
            let response = client
                .get(format!("{}/tree", server.url()))
                .send()
                .await
                .unwrap();
            let result = CliService::parse_repo_tree_response(response, "owner/repo").await;
            if rate_limited {
                assert!(matches!(result, Err(AppError::RateLimited { .. })));
            } else {
                assert!(matches!(result, Err(AppError::DownloadUnavailable(_))));
            }
            mock.assert_async().await;
            mock.remove_async().await;
        }
        let mock = server
            .mock("GET", "/tree")
            .with_status(200)
            .with_body(r#"{"sha":"new-sha","tree":[]}"#)
            .create_async()
            .await;
        let response = client
            .get(format!("{}/tree", server.url()))
            .send()
            .await
            .unwrap();
        assert_eq!(
            CliService::parse_repo_tree_response(response, "next/repo")
                .await
                .unwrap()
                .unwrap()
                .sha,
            "new-sha"
        );
        mock.assert_async().await;
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
            extra: Default::default(),
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
            extra: Default::default(),
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
            vec!["demo: Missing update baseline. Open this skill and update it to establish a baseline."]
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
    fn install_selection_matches_root_skill_directory_key() {
        let repo = tempfile::tempdir().unwrap();
        let repo_root = repo.path().join("identity-skill");
        std::fs::create_dir_all(&repo_root).unwrap();
        std::fs::write(
            repo_root.join("SKILL.md"),
            "---\nname: identity-skill\ndescription: Demo\n---\n",
        )
        .unwrap();

        let discovered = vec![(
            "identity-skill".to_string(),
            String::new(),
            repo_root.clone(),
        )];
        let requested = vec![".".to_string()];

        let selected =
            CliService::select_discovered_skills(&repo_root, &discovered, &requested, false);

        assert_eq!(selected.len(), 1);
        assert_eq!(&selected[0].2, &repo_root);
    }

    #[test]
    fn cli_discovery_ignores_invalid_root_and_scans_nested_skills() {
        let repo = tempfile::tempdir().unwrap();
        let repo_root = repo.path().join("skills-repo");
        let nested = repo_root.join("skills").join("child");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(repo_root.join("SKILL.md"), "---\nname: root-only\n---\n").unwrap();
        std::fs::write(
            nested.join("SKILL.md"),
            "---\nname: child\ndescription: Demo\n---\n",
        )
        .unwrap();

        let discovered = CliService::discover_skills_in_tree(&repo_root);

        assert_eq!(discovered.len(), 1);
        assert_eq!(discovered[0].0, "child");
    }

    #[test]
    #[cfg(unix)]
    fn copy_dir_contents_skips_directory_symlink_to_external_dir() {
        let root = tempfile::tempdir().unwrap();
        let outside = root.path().join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("secret.txt"), "private data").unwrap();

        let src = root.path().join("demo");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(src.join("SKILL.md"), "# Demo").unwrap();
        std::os::unix::fs::symlink(&outside, src.join("outside")).unwrap();

        let dest = root.path().join("dest");
        CliService::copy_dir_contents(&src, &dest).unwrap();

        assert!(dest.join("SKILL.md").is_file());
        assert!(
            !dest.join("outside").join("secret.txt").exists(),
            "external directory must not be copied through a directory symlink"
        );
    }

    #[test]
    #[cfg(unix)]
    fn copy_dir_contents_skips_loop_directory_symlink() {
        let root = tempfile::tempdir().unwrap();
        let src = root.path().join("demo");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(src.join("SKILL.md"), "# Demo").unwrap();
        std::os::unix::fs::symlink(".", src.join("loop")).unwrap();

        let dest = root.path().join("dest");
        CliService::copy_dir_contents(&src, &dest).unwrap();

        assert!(dest.join("SKILL.md").is_file());
        assert!(
            !dest.join("loop").exists(),
            "loop directory symlink must be skipped, not recursed into"
        );
    }

    #[test]
    #[cfg(unix)]
    fn copy_dir_contents_copies_file_symlink_target_relative_to_link_dir() {
        let root = tempfile::tempdir().unwrap();
        let repo = root.path().join("repo");
        let docs = repo.join("docs");
        std::fs::create_dir_all(&docs).unwrap();
        std::fs::write(docs.join("notes.md"), "correct notes").unwrap();

        let src = repo.join("skills").join("demo");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(src.join("SKILL.md"), "# Demo").unwrap();
        std::os::unix::fs::symlink("../../docs/notes.md", src.join("notes.md")).unwrap();
        assert!(src.join("notes.md").is_file());

        let dest = root.path().join("dest");
        CliService::copy_dir_contents(&src, &dest).unwrap();

        assert_eq!(
            std::fs::read_to_string(dest.join("notes.md")).unwrap(),
            "correct notes",
            "valid relative symlink target must resolve from the link's directory"
        );
    }

    #[test]
    #[cfg(unix)]
    fn copy_dir_contents_does_not_resolve_symlink_target_against_cwd() {
        let fixture_rel = format!(".copy-cwd-fixture-{}.txt", std::process::id());
        let fixture = std::env::current_dir().unwrap().join(&fixture_rel);
        std::fs::write(&fixture, "wrong file from cwd").unwrap();

        let root = tempfile::tempdir().unwrap();
        let src = root.path().join("demo");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(src.join("SKILL.md"), "# Demo").unwrap();
        std::os::unix::fs::symlink(&fixture_rel, src.join("link.txt")).unwrap();

        let dest = root.path().join("dest");
        let result = CliService::copy_dir_contents(&src, &dest);
        let _ = std::fs::remove_file(&fixture);
        result.unwrap();

        assert!(
            !dest.join("link.txt").exists(),
            "dangling-from-link-dir symlink must not copy a CWD-relative file"
        );
    }

    #[test]
    fn copy_dir_contents_rejects_excessive_nesting_depth() {
        let root = tempfile::tempdir().unwrap();
        let src = root.path().join("demo");
        let mut deep = src.clone();
        for i in 0..25 {
            deep = deep.join(format!("d{i}"));
        }
        std::fs::create_dir_all(&deep).unwrap();
        std::fs::write(src.join("SKILL.md"), "# Demo").unwrap();

        let dest = root.path().join("dest");
        let result = CliService::copy_dir_contents(&src, &dest);

        assert!(result.is_err(), "excessive nesting must fail with an error");
    }

    #[test]
    #[cfg(unix)]
    fn cli_discovery_skips_symlinked_skill_directories() {
        let repo = tempfile::tempdir().unwrap();
        let repo_root = repo.path().join("skills-repo");
        let skill_dir = repo_root.join("skills").join("demo");
        let agent_dir = repo_root.join(".agents");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::create_dir_all(&agent_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "# Demo").unwrap();
        std::os::unix::fs::symlink("../skills", agent_dir.join("skills")).unwrap();

        let discovered = CliService::discover_skills_in_tree(&repo_root);

        assert_eq!(discovered.len(), 1);
        assert_eq!(&discovered[0].2, &skill_dir);
        let destinations = discovered
            .iter()
            .map(|(name, _, _)| name.as_str())
            .collect::<Vec<_>>();
        CliService::ensure_install_destinations_available(
            &destinations,
            &repo.path().join("ssot"),
            &[],
        )
        .unwrap();
    }

    #[test]
    fn cli_discovery_stops_at_valid_root_skill() {
        let repo = tempfile::tempdir().unwrap();
        let repo_root = repo.path().join("skills-repo");
        let nested = repo_root.join("skills").join("child");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(
            repo_root.join("SKILL.md"),
            "---\nname: root-only\ndescription: Demo\n---\n",
        )
        .unwrap();
        std::fs::write(
            nested.join("SKILL.md"),
            "---\nname: child\ndescription: Demo\n---\n",
        )
        .unwrap();

        let discovered = CliService::discover_skills_in_tree(&repo_root);

        assert_eq!(discovered.len(), 1);
        assert_eq!(discovered[0].0, "skills-repo");
    }

    #[test]
    fn install_selection_root_key_does_not_match_nested_same_name() {
        let repo = tempfile::tempdir().unwrap();
        let repo_root = repo.path().join("identity-skill");
        let nested = repo_root.join("nested").join("identity-skill");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(repo_root.join("SKILL.md"), "# Root").unwrap();

        let discovered = vec![
            (
                "identity-skill".to_string(),
                String::new(),
                repo_root.clone(),
            ),
            ("identity-skill".to_string(), String::new(), nested.clone()),
        ];
        let requested = vec![".".to_string()];

        let selected =
            CliService::select_discovered_skills(&repo_root, &discovered, &requested, false);

        assert_eq!(selected.len(), 1);
        assert_eq!(&selected[0].2, &repo_root);
    }

    #[test]
    fn normalize_repo_skill_path_converts_windows_backslashes_to_forward_slashes() {
        assert_eq!(
            normalize_repo_skill_path("skills\\self-learning"),
            "skills/self-learning"
        );
        assert_eq!(
            normalize_repo_skill_path("skills\\self-learning\\SKILL.md"),
            "skills/self-learning"
        );
        assert_eq!(
            normalize_repo_skill_path("skills/self-learning"),
            "skills/self-learning"
        );
        assert_eq!(
            normalize_repo_skill_path("skills\\sub\\dir/self-learning\\SKILL.md"),
            "skills/sub/dir/self-learning"
        );
        assert_eq!(normalize_repo_skill_path("SKILL.md"), "");
        assert_eq!(normalize_repo_skill_path(""), "");
        assert_eq!(normalize_repo_skill_path("."), "");
        assert_eq!(normalize_repo_skill_path("./"), "");
        assert_eq!(normalize_repo_skill_path("./SKILL.md"), "");
        assert_eq!(normalize_repo_skill_path(".\\SKILL.md"), "");
    }

    #[test]
    fn root_path_variants_use_repository_tree_sha() {
        let tree = RepoTreeResponse {
            sha: "root-sha".to_string(),
            tree: Vec::new(),
        };

        for path in ["", ".", "SKILL.md", "./SKILL.md", ".\\SKILL.md"] {
            assert_eq!(
                CliService::get_folder_sha_from_tree(&tree, path).as_deref(),
                Some("root-sha")
            );
        }
    }

    #[test]
    fn install_selection_matches_windows_backslash_selector_for_nested_skill() {
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
    fn find_discovered_skill_for_update_uses_repo_root_for_root_lock_paths() {
        let repo = tempfile::tempdir().unwrap();
        let repo_root = repo.path().join("renamed-root-skill");
        std::fs::create_dir_all(&repo_root).unwrap();

        let discovered = vec![(
            "renamed-root-skill".to_string(),
            String::new(),
            repo_root.clone(),
        )];

        for lock_path in ["", ".", "./SKILL.md"] {
            let selected = CliService::find_discovered_skill_for_update(
                &repo_root,
                "old-root-name",
                Some(lock_path),
                &discovered,
            )
            .expect("selected root skill");

            assert_eq!(selected, &repo_root);
        }
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

        CliService::replace_skill_dir_with_rollback(&dest, &tmp, || Ok(())).unwrap();

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

        let result = CliService::replace_skill_dir_with_rollback(&dest, &missing_tmp, || Ok(()));

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
            force: false,
        }
    }

    fn test_update_tree(sha: &str) -> RepoTreeResponse {
        RepoTreeResponse {
            sha: "root".into(),
            tree: vec![TreeEntry {
                path: "skills/demo".into(),
                entry_type: "tree".into(),
                sha: sha.into(),
            }],
        }
    }

    #[test]
    fn update_rejects_a_different_downloaded_snapshot_before_writing() {
        let home = tempfile::tempdir().unwrap();
        config::with_test_home(home.path(), || {
            let dest = config::get_agents_skills_dir().join("demo");
            std::fs::create_dir_all(&dest).unwrap();
            std::fs::write(dest.join("SKILL.md"), "# original").unwrap();
            let update = test_known_update("demo", "owner/repo", "checked-A");
            SkillLock::update(|lock| {
                lock.skills.insert("demo".into(), update.entry.clone());
                Ok(())
            })
            .unwrap();
            let repo = home.path().join("downloaded");
            std::fs::create_dir_all(repo.join("skills/demo")).unwrap();
            std::fs::write(repo.join("skills/demo/SKILL.md"), "# downloaded-B").unwrap();
            let discovered = CliService::discover_skills_in_tree(&repo);
            let result = CliService::reinstall_skill_from_discovered(
                &update,
                "owner",
                "repo",
                &repo,
                &discovered,
                &test_update_tree("downloaded-B"),
            );
            assert!(
                result.is_err(),
                "must reject a changed snapshot rather than record the checked SHA"
            );
            assert_eq!(
                std::fs::read_to_string(dest.join("SKILL.md")).unwrap(),
                "# original"
            );
            assert_eq!(SkillLock::read().unwrap().skills["demo"], update.entry);
        });
    }

    #[test]
    fn archive_identity_is_read_from_the_same_file_that_is_extracted() {
        use std::io::Write;
        for comment in [
            "7fd1a60b01f91b314f59955a4e4d4e80d8edf11d",
            "",
            "not-a-commit",
        ] {
            let zip_file = tempfile::NamedTempFile::new().unwrap();
            let mut archive = zip::ZipWriter::new(zip_file.reopen().unwrap());
            archive.set_comment(comment).unwrap();
            archive
                .start_file(
                    "repo-main/skills/demo/SKILL.md",
                    zip::write::SimpleFileOptions::default(),
                )
                .unwrap();
            archive.write_all(b"# snapshot").unwrap();
            archive.finish().unwrap();
            let (_temp, root, commit) =
                CliService::extract_repo_zip(zip_file.path(), "repo").unwrap();
            assert_eq!(commit.as_deref(), (comment.len() == 40).then_some(comment));
            assert_eq!(
                std::fs::read_to_string(root.join("skills/demo/SKILL.md")).unwrap(),
                "# snapshot"
            );
        }
    }

    #[test]
    fn update_restores_content_when_lock_publication_fails() {
        let home = tempfile::tempdir().unwrap();
        config::with_test_home(home.path(), || {
            let dest = config::get_agents_skills_dir().join("demo");
            std::fs::create_dir_all(&dest).unwrap();
            std::fs::write(dest.join("SKILL.md"), "# original").unwrap();
            let update = test_known_update("demo", "owner/repo", "new");
            SkillLock::update(|lock| {
                lock.skills.insert("demo".into(), update.entry.clone());
                Ok(())
            })
            .unwrap();
            let lock_path = config::get_agent_lock_file();
            let original_lock = std::fs::read(&lock_path).unwrap();
            let tmp_path = lock_path.with_file_name(format!(
                "{}.tmp",
                lock_path.file_name().unwrap().to_str().unwrap()
            ));
            std::fs::create_dir(&tmp_path).unwrap();
            let repo = home.path().join("downloaded");
            let source = repo.join("skills/demo");
            std::fs::create_dir_all(&source).unwrap();
            std::fs::write(source.join("SKILL.md"), "# replacement").unwrap();
            let discovered = CliService::discover_skills_in_tree(&repo);
            let result = CliService::reinstall_skill_from_discovered(
                &update,
                "owner",
                "repo",
                &repo,
                &discovered,
                &test_update_tree("new"),
            );
            assert!(result.is_err(), "a failed lock write must fail the update");
            assert_eq!(
                std::fs::read_to_string(dest.join("SKILL.md")).unwrap(),
                "# original"
            );
            assert_eq!(std::fs::read(&lock_path).unwrap(), original_lock);
        });
    }

    #[test]
    fn update_rechecks_edits_made_after_preflight_before_replacement() {
        let home = tempfile::tempdir().unwrap();
        config::with_test_home(home.path(), || {
            let dest = config::get_agents_skills_dir().join("demo");
            std::fs::create_dir_all(&dest).unwrap();
            std::fs::write(dest.join("SKILL.md"), "# original").unwrap();
            let mut update = test_known_update("demo", "owner/repo", "new");
            update.entry.skill_folder_hash =
                Some(crate::services::lock::compute_skill_folder_hash(&dest).unwrap());
            SkillLock::update(|lock| {
                lock.skills.insert("demo".into(), update.entry.clone());
                Ok(())
            })
            .unwrap();
            assert!(!crate::services::lock::skill_folder_drifted(
                &dest,
                &update.entry
            ));

            let repo = home.path().join("downloaded");
            let source = repo.join("skills/demo");
            std::fs::create_dir_all(&source).unwrap();
            std::fs::write(source.join("SKILL.md"), "# upstream").unwrap();
            std::fs::write(dest.join("SKILL.md"), "# saved during download").unwrap();
            let discovered = CliService::discover_skills_in_tree(&repo);
            let baseline = update.entry.skill_folder_hash.clone();
            assert_eq!(
                CliService::reinstall_skill_from_discovered(
                    &update,
                    "owner",
                    "repo",
                    &repo,
                    &discovered,
                    &test_update_tree("new")
                )
                .unwrap(),
                ReinstallOutcome::SkippedDrifted
            );
            assert_eq!(
                std::fs::read_to_string(dest.join("SKILL.md")).unwrap(),
                "# saved during download"
            );
            assert_eq!(
                SkillLock::read().unwrap().skills["demo"].skill_folder_hash,
                baseline
            );
            update.force = true;
            assert_eq!(
                CliService::reinstall_skill_from_discovered(
                    &update,
                    "owner",
                    "repo",
                    &repo,
                    &discovered,
                    &test_update_tree("new")
                )
                .unwrap(),
                ReinstallOutcome::Updated
            );
            assert_eq!(
                std::fs::read_to_string(dest.join("SKILL.md")).unwrap(),
                "# upstream"
            );
            let saved = &SkillLock::read().unwrap().skills["demo"];
            assert_eq!(saved.commit_sha.as_deref(), Some("new"));
            assert!(!crate::services::lock::skill_folder_drifted(&dest, saved));
        });
    }

    fn test_lock_entry(
        source: &str,
        skill_path: Option<&str>,
        commit_sha: Option<&str>,
    ) -> SkillLockEntry {
        SkillLockEntry {
            extra: Default::default(),
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

    #[test]
    fn archive_limits_reject_ratio_bomb() {
        let err = CliService::check_archive_limits(1024, 10 * 1024 * 1024, 3, 4, 1024 * 1024, 100)
            .unwrap_err();
        assert!(err.to_string().contains("decompresses to"));
    }

    #[test]
    fn archive_limits_reject_entry_flood() {
        let err = CliService::check_archive_limits(1024, 500, 6, 4, 0, 5).unwrap_err();
        assert!(err.to_string().contains("entries"));
    }

    #[test]
    fn archive_limits_accept_normal_and_floor_boundary() {
        CliService::check_archive_limits(1024 * 1024, 3 * 1024 * 1024, 10, 4, 1024 * 1024, 100)
            .unwrap();
        CliService::check_archive_limits(0, 1024 * 1024, 1, 4, 1024 * 1024, 100).unwrap();
        assert!(
            CliService::check_archive_limits(0, 1024 * 1024 + 1, 1, 4, 1024 * 1024, 100).is_err()
        );
    }

    fn in_memory_zip(entry_sizes: &[usize]) -> (zip::ZipArchive<std::io::Cursor<Vec<u8>>>, u64) {
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default();
        for (i, size) in entry_sizes.iter().enumerate() {
            writer.start_file(format!("file-{i}.txt"), options).unwrap();
            std::io::Write::write_all(&mut writer, &vec![b'x'; *size]).unwrap();
        }
        let cursor = writer.finish().unwrap();
        let zip_len = cursor.get_ref().len() as u64;
        let archive = zip::ZipArchive::new(cursor).unwrap();
        (archive, zip_len)
    }

    #[test]
    fn validate_archive_scale_accepts_normal_archive() {
        let (mut archive, zip_len) = in_memory_zip(&[10, 20, 30]);
        CliService::validate_archive_scale(&mut archive, zip_len, 4, 1024 * 1024, 100).unwrap();
    }

    #[test]
    fn validate_archive_scale_rejects_real_ratio_bomb() {
        let (mut archive, zip_len) = in_memory_zip(&[1024 * 1024]);
        let err = CliService::validate_archive_scale(&mut archive, zip_len, 4, 0, 100).unwrap_err();
        assert!(err.to_string().contains("decompresses to"));

        let (mut archive, zip_len) = in_memory_zip(&[1024 * 1024]);
        CliService::validate_archive_scale(&mut archive, zip_len, 2000, 0, 100).unwrap();
    }

    #[test]
    fn validate_archive_scale_rejects_entry_flood() {
        let (mut archive, zip_len) = in_memory_zip(&[1, 2, 3]);
        let err = CliService::validate_archive_scale(&mut archive, zip_len, 4, 0, 2).unwrap_err();
        assert!(err.to_string().contains("entries"));
    }
}

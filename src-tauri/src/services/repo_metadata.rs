use crate::config;
use crate::error::{classify_download_error, AppError, CommandError};
use crate::persistence::atomic_write;
use crate::services::cli::CliService;
use crate::services::github;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

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

pub fn minimal_discover_repo(owner: String, name: String, branch: Option<String>) -> DiscoverRepo {
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

const REPO_METADATA_CACHE_TTL: u64 = 7 * 86400;
const REPO_README_CACHE_TTL: u64 = 7 * 86400;
const REPO_METADATA_CACHE_FILE: &str = "repo-metadata-cache.json";
const REPO_README_CACHE_FILE: &str = "repo-readme-cache.json";

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RepoMetadataCacheEntry {
    pub data: DiscoverRepo,
    pub fetched_at: u64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct RepoReadmeCacheEntry {
    content: String,
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

fn load_json_cache<T: DeserializeOwned>(file_name: &str) -> HashMap<String, T> {
    let path = config::get_app_config_dir().join(file_name);
    let content = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return HashMap::new(),
    };
    serde_json::from_str(&content).unwrap_or_default()
}

fn save_json_cache<T: Serialize>(file_name: &str, cache: &HashMap<String, T>) {
    let path = config::get_app_config_dir().join(file_name);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(cache) {
        let _ = atomic_write(&path, json);
    }
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn fresh(fetched_at: u64, ttl: u64) -> bool {
    now_secs().saturating_sub(fetched_at) < ttl
}

pub async fn get_repo_metadata(
    owner: &str,
    name: &str,
    force: bool,
) -> Result<DiscoverRepo, CommandError> {
    let mut cache: HashMap<String, RepoMetadataCacheEntry> =
        load_json_cache(REPO_METADATA_CACHE_FILE)
            .into_iter()
            .map(|(key, entry)| (key, normalize_repo_metadata_cache_entry(entry)))
            .collect();
    let key = format!("{owner}/{name}");
    let stale = cache.get(&key).map(|entry| entry.data.clone());

    if !force
        && cache
            .get(&key)
            .is_some_and(|e| fresh(e.fetched_at, REPO_METADATA_CACHE_TTL))
    {
        return Ok(cache.get(&key).unwrap().data.clone());
    }

    match fetch_github_repo_metadata(owner, name).await {
        Ok(data) => {
            cache.insert(
                key,
                RepoMetadataCacheEntry {
                    data: data.clone(),
                    fetched_at: now_secs(),
                },
            );
            save_json_cache(REPO_METADATA_CACHE_FILE, &cache);
            Ok(data)
        }
        Err(e) => {
            if let Some(data) = stale {
                eprintln!("metadata fetch failed for {owner}/{name}, using stale cache: {e}");
                return Ok(data);
            }
            Err(CommandError::from(e))
        }
    }
}

pub async fn get_repo_readme(
    owner: &str,
    name: &str,
    branch: Option<&str>,
    force: bool,
) -> Result<String, CommandError> {
    let mut cache: HashMap<String, RepoReadmeCacheEntry> = load_json_cache(REPO_README_CACHE_FILE);
    let key = format!("{owner}/{name}/{}", repo_ref_cache_key(branch));
    let stale = cache.get(&key).map(|entry| entry.content.clone());

    if !force
        && cache
            .get(&key)
            .is_some_and(|e| fresh(e.fetched_at, REPO_README_CACHE_TTL))
    {
        return Ok(cache.get(&key).unwrap().content.clone());
    }

    match fetch_repo_readme(owner, name, branch).await {
        Ok(content) => {
            cache.insert(
                key,
                RepoReadmeCacheEntry {
                    content: content.clone(),
                    fetched_at: now_secs(),
                },
            );
            save_json_cache(REPO_README_CACHE_FILE, &cache);
            Ok(content)
        }
        Err(e) => {
            if let Some(content) = stale {
                eprintln!("README fetch failed for {owner}/{name}, using stale cache: {e}");
                return Ok(content);
            }

            match read_cached_repo_readme_from_zip(owner, name, branch) {
                Ok(content) => {
                    cache.insert(
                        key,
                        RepoReadmeCacheEntry {
                            content: content.clone(),
                            fetched_at: 0,
                        },
                    );
                    save_json_cache(REPO_README_CACHE_FILE, &cache);
                    Ok(content)
                }
                Err(()) => Err(CommandError::from(e)),
            }
        }
    }
}

fn repo_ref_cache_key(branch: Option<&str>) -> &str {
    branch.unwrap_or("default")
}

async fn fetch_github_repo_metadata(owner: &str, name: &str) -> Result<DiscoverRepo, AppError> {
    let url = format!("https://api.github.com/repos/{owner}/{name}");
    let client = config::http_client();

    match github::github_get(client, &url)
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
            Err(github::response_error(&resp, &format!("{owner}/{name}"))
                .unwrap_or_else(|| AppError::DownloadUnavailable(format!("{owner}/{name}"))))
        }
        Err(e) => Err(classify_download_error(format!("{owner}/{name}"), e)),
    }
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

    let resp = github::github_get(client, &url)
        .send()
        .await
        .map_err(|e| classify_download_error(format!("{owner}/{name}"), e))?;
    if let Some(error) = github::response_error(&resp, &format!("{owner}/{name}")) {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn write_test_zip(entries: &[(&str, &str)]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let file = std::fs::File::create(dir.path().join("repo.zip")).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        for (name, content) in entries {
            zip.start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            use std::io::Write;
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
}
